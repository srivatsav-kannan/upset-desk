"""Decision step: compare a model's predictions with Kalshi and make the expected-points pick.

This is the only place Kalshi prices are used, so every model's probabilities stay an
independent opinion. Input: models/<name>/predictions.csv. Output, in the same folder:
results/model_vs_kalshi.csv, results/strategy_summary.csv, and submission/favorite_*.csv
(the model favorite) plus submission/ev_*.csv (the expected-points rule) in template format.
"""

import datetime as dt
import json
import math
import re
import time
from pathlib import Path

from common import STATES, cached, http_get, load_template, validate_predictions, validate_submission, write_csv

KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"
# Series that hold 2026 congressional winner markets (one event per race).
KALSHI_SERIES = re.compile(r"^(KX)?SENATE[A-Z]{2}S?$|^KXHOUSERACE$|^(KX)?HOUSE[A-Z]{2}(\d{1,2}|AL)$")
KALSHI_FLOOR = 0.01  # scoring floors Kalshi's probability at 1%
KALSHI_MARKET_FIELDS = ["ticker", "yes_sub_title", "rules_primary", "status", "yes_bid_dollars",
                        "yes_ask_dollars", "last_price_dollars", "volume_fp", "open_interest_fp"]


# ---------------------------------------------------------------- Kalshi ingest

def fetch_kalshi(refresh: bool) -> Path:
    """Snapshot every open 2026 House/Senate winner event (markets trimmed to pricing fields)."""
    def get(url: str) -> dict:
        time.sleep(0.35)
        return json.loads(http_get(url))

    def download() -> bytes:
        series = get(f"{KALSHI_API}/series?category=Elections")["series"]
        events = []
        for t in sorted(x["ticker"] for x in series if KALSHI_SERIES.match(x["ticker"])):
            cursor = ""
            while True:
                page = get(f"{KALSHI_API}/events?series_ticker={t}&status=open"
                           f"&with_nested_markets=true&limit=200&cursor={cursor}")
                for e in page["events"]:
                    if "-26" in e["event_ticker"]:
                        e["markets"] = [{k: m.get(k) for k in KALSHI_MARKET_FIELDS} for m in e["markets"]]
                        events.append({k: e[k] for k in ("event_ticker", "series_ticker", "title", "markets")})
                cursor = page.get("cursor") or ""
                if not cursor or not page["events"]:
                    break
        snap = {"retrieved_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "events": events}
        return json.dumps(snap, indent=1, ensure_ascii=False).encode()
    return cached("kalshi", "kalshi", "json", refresh, download)


def kalshi_race_id(title: str):
    """Map an event title to a template race_id. Titles, not tickers: SENATELA-26 is Kentucky."""
    m = re.match(r"^([A-Z]{2})-(\d{2}|AL) House winner\?", title)
    if m:
        return f"{m[1]}-{m[2]}"
    m = re.match(r"^(.+?) House winner\?$", title)  # at-large seats, e.g. "Alaska House winner?"
    if m and m[1] in STATES:
        return f"{STATES[m[1]]}-AL"
    m = re.match(r"^(.+?) Senate winner\?", title)
    if m and m[1] in STATES:
        return f"{STATES[m[1]]}-SEN"
    return None


def kalshi_party(market: dict) -> str:
    code = market["ticker"].rsplit("-", 1)[-1]
    return {"D": "D", "DEM": "D", "R": "R", "GOP": "R"}.get(code, "I")


def price(market: dict) -> float:
    """Bid/ask midpoint when the book is two-sided, else the last trade."""
    bid, ask = float(market["yes_bid_dollars"] or 0), float(market["yes_ask_dollars"] or 0)
    return (bid + ask) / 2 if bid > 0 and ask > 0 else float(market["last_price_dollars"] or 0)


def load_kalshi(path: Path) -> tuple:
    """Return (retrieved_utc, {race_id: {event, volume, cands: {party: {name, p}}}}).

    Probabilities are normalised to sum to 1 within a race. When a race has several events
    (e.g. a party market and a candidate market) the one with the most volume wins.
    """
    snap = json.loads(path.read_text())
    races = {}
    for e in snap["events"]:
        rid = kalshi_race_id(e["title"] or "")
        live = [m for m in e["markets"] if m["status"] == "active"]
        if not rid or not live:
            continue
        volume = sum(float(m["volume_fp"] or 0) for m in live)
        if rid in races and races[rid]["volume"] >= volume:
            continue
        total = sum(price(m) for m in live)
        cands = {}
        for m in live:
            party = kalshi_party(m)
            p = price(m) / total
            if party not in cands or p > cands[party]["p"]:  # one entry per party: its strongest
                cands[party] = {"name": m["yes_sub_title"], "p": p}
        races[rid] = {"event": e["event_ticker"], "volume": volume, "cands": cands}
    return snap["retrieved_utc"], races


# ---------------------------------------------------------------- scoring + pick

def points(p_kalshi: float) -> float:
    return -math.log2(max(p_kalshi, KALSHI_FLOOR))


def decide(p_d_model: float, market) -> dict:
    """Expected-points pick: argmax over candidates of P_model(c) * -log2(max(p_Kalshi(c), 1%)).

    The model only knows R vs not-R, so the not-R probability goes to the market's strongest
    non-R candidate (the Democrat, or an independent such as Osborn in NE-SEN).
    """
    p_r = 1 - p_d_model
    fav = "R" if p_r > 0.5 else "D"
    if market is None:
        return {"pick": fav, "pick_model_p": max(p_r, 1 - p_r), "model_favorite": fav}
    cands = market["cands"]
    non_r = max((c for c in cands if c != "R"), key=lambda c: cands[c]["p"], default="D")
    model = {"R": p_r, non_r: 1 - p_r}
    fav = "R" if p_r > 0.5 else non_r
    ev = {c: model.get(c, 0.0) * points(cands[c]["p"]) for c in cands}
    pick = max(ev, key=ev.get)
    kalshi_fav = max(cands, key=lambda c: cands[c]["p"])
    return {
        "pick": pick, "pick_model_p": model.get(pick, 0.0), "model_favorite": fav,
        "kalshi_favorite": kalshi_fav, "pick_kalshi_p": cands[pick]["p"],
        "points_if_right": points(cands[pick]["p"]), "ev_pick": ev[pick],
        "ev_model_favorite": ev.get(fav, 0.0), "ev_kalshi_favorite": ev[kalshi_fav],
        "underdog_pick": pick != kalshi_fav, "pick_name": cands[pick]["name"],
    }


def run(model_dir: Path, refresh: bool) -> dict:
    """Run the decision step for one model folder and return (snapshot time, coverage, summary)."""
    preds = validate_predictions(model_dir / "predictions.csv")
    retrieved, market = load_kalshi(fetch_kalshi(refresh))
    compare = []
    for p in preds:
        rid, mk = p["race_id"], market.get(p["race_id"])
        p_d = float(p["p_d"])
        margin = float(p["projected_margin"]) if p["projected_margin"] else ""
        row = {"race_id": rid, "chamber": p["chamber"], "projected_margin": margin,
               "model_p_r": round(1 - p_d, 4), "kalshi_event": mk["event"] if mk else "",
               "kalshi_p_r": round(mk["cands"].get("R", {"p": 0.0})["p"], 4) if mk else ""}
        if mk:
            row["model_minus_kalshi_r"] = round(row["model_p_r"] - row["kalshi_p_r"], 4)
        row.update({k: round(v, 4) if isinstance(v, float) else v for k, v in decide(p_d, mk).items()})
        compare.append(row)
    fields = ["race_id", "chamber", "projected_margin", "model_p_r", "kalshi_event", "kalshi_p_r",
              "model_minus_kalshi_r", "model_favorite", "kalshi_favorite", "pick", "pick_name",
              "pick_model_p", "pick_kalshi_p", "points_if_right", "ev_pick", "ev_model_favorite",
              "ev_kalshi_favorite", "underdog_pick"]
    write_csv(model_dir / "results" / "model_vs_kalshi.csv", compare, fields)

    # Expected score of three pick strategies over races with a market, judged two ways:
    # by our model's probabilities and by Kalshi's own (if the market is right, what do we get?).
    strategies = {"model favorite": "model_favorite", "Kalshi favorite": "kalshi_favorite", "expected-points rule": "pick"}
    summary = []
    for scope, chambers in [("Senate", {"Senate"}), ("House", {"House"}), ("All", {"Senate", "House"})]:
        rows = [r for r in compare if r["chamber"] in chambers and r["kalshi_event"]]
        for label, col in strategies.items():
            ev_model = ev_market = 0.0
            for r in rows:
                cands = market[r["race_id"]]["cands"]
                c = r[col]
                p_model = r["model_p_r"] if c == "R" else 1 - r["model_p_r"]
                ev_model += p_model * points(cands[c]["p"])
                ev_market += cands[c]["p"] * points(cands[c]["p"])
            summary.append({"scope": scope, "races_with_market": len(rows), "strategy": label,
                            "underdog_picks": sum(r[col] != r["kalshi_favorite"] for r in rows),
                            "expected_points_model": round(ev_model, 2),
                            "expected_points_if_kalshi_right": round(ev_market, 2)})
    write_csv(model_dir / "results" / "strategy_summary.csv", summary, list(summary[0].keys()))

    # Submissions in the official template format: model favorite (favorite_*) and EV rule (ev_*).
    picks = {r["race_id"]: r for r in compare}
    for tmpl, track in [("senate_track_template.csv", "senate"), ("full_congress_track_template.csv", "full_congress")]:
        template = load_template(tmpl)
        for prefix, choose in [("favorite", "model_favorite"), ("ev", "pick")]:
            rows = []
            for t in template:
                r, mk = picks[t["race_id"]], market.get(t["race_id"])
                party = r[choose]
                p_model = r["model_p_r"] if party == "R" else 1 - r["model_p_r"]
                name = mk["cands"].get(party, {}).get("name", "") if mk else ""
                rows.append({**t, "predicted_winner_party": party, "candidate_name": name,
                             "win_probability": round(p_model, 4)})
            out = model_dir / "submission" / f"{prefix}_{track}.csv"
            write_csv(out, rows, list(template[0].keys()))
            validate_submission(out, template)
    return {"retrieved": retrieved, "markets": len(market), "summary": summary}
