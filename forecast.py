"""Model Citizens 2026 forecast pipeline (single file, standard library only).

Run:  python3 forecast.py            # use cached raw data
      python3 forecast.py --refresh  # re-download raw data first

      python3 forecast.py --swing 0  # override the national swing (0 = pure 2024 replay)

Baseline v1 ("2024 on the 2026 map + generic ballot swing"):
  Each race is predicted from the 2024 presidential margin inside its 2026 boundaries,
  plus a uniform national swing. House districts use The Downballot's 2024 presidential
  results recomputed on the lines used in 2026; Senate races use the statewide 2024
  presidential margin (sum of a state's districts).
  Swing = (mean of the published generic-ballot averages listed on Wikipedia, D minus R)
          - (2024 national presidential margin, summed from all 435 districts).
  Win probability = Phi(margin / SIGMA), where SIGMA is the RMS change in district
  presidential margin from 2020 to 2024 on identical lines (estimated from the data).
"""

import argparse
import csv
import datetime as dt
import io
import json
import math
import re
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
RESULTS = ROOT / "results"
SUBMISSION = ROOT / "submission"
TEMPLATES = SUBMISSION / "templates"

SWING_GRID = [-2, 0, 2, 4, 6, 8, 10, 12]

SHEET_URL = "https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}"
SOURCES = {
    # The Downballot: 2020 & 2024 presidential results by congressional district.
    # https://www.the-downballot.com/p/the-downballots-calculations-of-presidential
    "downballot_2026_lines": ("1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0", "1491069057"),
    "downballot_2024_lines": ("1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo", "1491069057"),
}

WIKI_API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=parse&page="
GENERIC_BALLOT_PAGE = "2026_United_States_House_of_Representatives_elections"
GENERIC_BALLOT_SECTION = "Generic congressional ballot aggregate polls"
USER_AGENT = "model-citizens-forecast/0.1 (https://github.com/srivatsav-kannan/election-prediction)"

KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"
# Series that hold 2026 congressional winner markets (one event per race).
KALSHI_SERIES = re.compile(r"^(KX)?SENATE[A-Z]{2}S?$|^KXHOUSERACE$|^(KX)?HOUSE[A-Z]{2}(\d{1,2}|AL)$")
KALSHI_FLOOR = 0.01  # scoring floors Kalshi's probability at 1%

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN",
    "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

RACE_ID = re.compile(r"^[A-Z]{2}-(\d{2}|AL)$")


# ---------------------------------------------------------------- ingest

def http_get(url: str) -> bytes:
    """GET with exponential backoff on HTTP 429 (Kalshi rate-limits aggressively)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"rate-limited too many times: {url}")


def cached(folder: str, name: str, ext: str, refresh: bool, download) -> Path:
    """Return the newest cached raw file for a source, calling download() if needed."""
    d = RAW / folder
    d.mkdir(parents=True, exist_ok=True)
    hits = sorted(d.glob(f"{name}_*.{ext}"))
    if hits and not refresh:
        return hits[-1]
    path = d / f"{name}_{dt.date.today().isoformat()}.{ext}"
    path.write_bytes(download())
    return path


def fetch(name: str, refresh: bool) -> Path:
    sheet_id, gid = SOURCES[name]
    return cached("downballot", name, "csv", refresh,
                  lambda: http_get(SHEET_URL.format(id=sheet_id, gid=gid)))


def fetch_generic_ballot(refresh: bool) -> Path:
    """Wikipedia's table of generic-ballot aggregator averages (wikitext + revision id)."""
    def download() -> bytes:
        sections = json.loads(http_get(WIKI_API + GENERIC_BALLOT_PAGE + "&prop=sections"))
        idx = next(s["index"] for s in sections["parse"]["sections"] if s["line"] == GENERIC_BALLOT_SECTION)
        return http_get(WIKI_API + GENERIC_BALLOT_PAGE + f"&prop=wikitext|revid&section={idx}")
    return cached("wikipedia", "generic_ballot", "json", refresh, download)


def load_generic_ballot(path: Path) -> list:
    """Parse the aggregator rows into [{source, dem, rep, margin}] (our own average, not theirs)."""
    page = json.loads(path.read_text())["parse"]
    rows = []
    for block in page["wikitext"].split("|-")[1:]:
        source = re.search(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", block)
        pcts = [float(x) for x in re.findall(r"([\d.]+)%", block)]
        if not source or "Average" in block or len(pcts) < 2:
            continue
        rep, dem = pcts[0], pcts[1]  # column order: Republicans, Democrats, Other, Margin
        rows.append({"source": source.group(1), "dem": dem, "rep": rep, "margin": round(dem - rep, 2),
                     "wikipedia_revid": page["revid"]})
    assert len(rows) >= 3, f"{path.name}: expected several generic-ballot aggregators, got {len(rows)}"
    return rows


KALSHI_MARKET_FIELDS = ["ticker", "yes_sub_title", "rules_primary", "status", "yes_bid_dollars",
                        "yes_ask_dollars", "last_price_dollars", "volume_fp", "open_interest_fp"]


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


def to_int(s: str) -> int:
    return int(s.replace(",", "")) if s.strip() else 0


def load_districts(path: Path) -> dict:
    """Parse a Downballot 'Vote totals' tab into {race_id: row}."""
    rows = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8"))))
    header = next(r for r in rows if "Harris" in r)
    h, t, tot = header.index("Harris"), header.index("Trump"), header.index("Total")
    b = header.index("Biden")
    out = {}
    for r in rows:
        if not RACE_ID.match(r[0]):
            continue
        d = {
            "race_id": r[0],
            "state": r[0][:2],
            "incumbent": r[1].strip(),
            "incumbent_party": r[2].strip("() "),
            "harris": to_int(r[h]),
            "trump": to_int(r[t]),
            "total": to_int(r[tot]),
            "biden": to_int(r[b]),
            "trump20": to_int(r[b + 1]),
            "total20": to_int(r[b + 2]),
        }
        d["margin24"] = 100 * (d["harris"] - d["trump"]) / d["total"]
        d["margin20"] = 100 * (d["biden"] - d["trump20"]) / d["total20"] if d["total20"] else None
        out[r[0]] = d
    assert len(out) == 435, f"{path.name}: expected 435 districts, got {len(out)}"
    return out


def load_template(name: str) -> list:
    with open(TEMPLATES / name, newline="") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- model

def estimate_sigma(old_lines: dict) -> float:
    """RMS 2020->2024 change in district presidential margin on unchanged (2024) lines."""
    diffs = [d["margin24"] - d["margin20"] for d in old_lines.values() if d["margin20"] is not None]
    return math.sqrt(sum(x * x for x in diffs) / len(diffs))


def win_prob_d(margin: float, sigma: float) -> float:
    return statistics.NormalDist().cdf(margin / sigma)


def predict(margin: float, sigma: float) -> tuple:
    p_d = win_prob_d(margin, sigma)
    return ("D", p_d) if margin > 0 else ("R", 1 - p_d)


def national_margin(districts: dict) -> float:
    h = sum(d["harris"] for d in districts.values())
    t = sum(d["trump"] for d in districts.values())
    return 100 * (h - t) / sum(d["total"] for d in districts.values())


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


def state_margins(districts: dict) -> dict:
    agg = {}
    for d in districts.values():
        a = agg.setdefault(d["state"], [0, 0, 0])
        a[0] += d["harris"]
        a[1] += d["trump"]
        a[2] += d["total"]
    return {s: 100 * (h - t) / tot for s, (h, t, tot) in agg.items()}


# ---------------------------------------------------------------- outputs

def write_csv(path: Path, rows: list, fields: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def validate_submission(path: Path, template: list) -> None:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    ids = [r["race_id"] for r in rows]
    assert ids == [t["race_id"] for t in template], f"{path.name}: race_ids differ from template"
    for r in rows:
        assert r["predicted_winner_party"] in {"D", "R", "I"}, r
        assert 0.0 <= float(r["win_probability"]) <= 1.0, r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download raw data")
    ap.add_argument("--swing", type=float, help="override the national swing to D, in points")
    args = ap.parse_args()

    new = load_districts(fetch("downballot_2026_lines", args.refresh))
    old = load_districts(fetch("downballot_2024_lines", args.refresh))
    sigma = estimate_sigma(old)

    # National environment: our own mean of the published generic-ballot averages,
    # expressed as a swing from the 2024 presidential national margin.
    gb = load_generic_ballot(fetch_generic_ballot(args.refresh))
    gb_margin = statistics.mean(r["margin"] for r in gb)
    pres_margin = national_margin(new)
    swing_to_d = args.swing if args.swing is not None else gb_margin - pres_margin
    env = gb + [
        {"source": "MEAN of aggregators", "margin": round(gb_margin, 2)},
        {"source": "2024 presidential national margin", "margin": round(pres_margin, 2)},
        {"source": "APPLIED swing to D", "margin": round(swing_to_d, 2)},
    ]
    write_csv(RESULTS / "national_environment.csv", env, ["source", "dem", "rep", "margin", "wikipedia_revid"])

    # House: one row per 2026 district, compared with the same-numbered 2024 district.
    house = []
    for rid in sorted(new):
        n, o = new[rid], old[rid]
        margin = n["margin24"] + swing_to_d
        party, prob = predict(margin, sigma)
        house.append({
            "race_id": rid,
            "state": n["state"],
            "incumbent": n["incumbent"],
            "incumbent_party": n["incumbent_party"],
            "margin_2024_old_lines": round(o["margin24"], 2),
            "margin_2024_new_lines": round(n["margin24"], 2),
            "lines_changed": (n["harris"], n["trump"]) != (o["harris"], o["trump"]),
            "old_lines_winner": "D" if o["margin24"] > 0 else "R",
            "new_lines_winner": "D" if n["margin24"] > 0 else "R",
            "projected_margin": round(margin, 2),
            "predicted_party": party,
            "win_probability": round(prob, 4),
        })
    for h in house:
        h["notional_flip"] = h["old_lines_winner"] != h["new_lines_winner"]
        h["crossover"] = h["incumbent_party"] in {"D", "R"} and h["incumbent_party"] != h["new_lines_winner"]
        h["flips_with_swing"] = h["predicted_party"] != h["new_lines_winner"]

    # Senate: statewide 2024 presidential margin (identical on any district map).
    st_new, st_old = state_margins(new), state_margins(old)
    for s in st_new:
        assert abs(st_new[s] - st_old[s]) < 0.5, f"{s}: statewide totals disagree across maps"
    senate = []
    for t in load_template("senate_track_template.csv"):
        s = t["race_id"][:2]
        margin = st_new[s] + swing_to_d
        party, prob = predict(margin, sigma)
        senate.append({"race_id": t["race_id"], "state": s, "margin_2024": round(st_new[s], 2),
                       "projected_margin": round(margin, 2), "predicted_party": party,
                       "win_probability": round(prob, 4),
                       "flips_with_swing": party != ("D" if st_new[s] > 0 else "R")})

    hf = list(house[0].keys())
    write_csv(RESULTS / "house_2024_on_2026_map.csv", house, hf)
    write_csv(RESULTS / "senate_2024_baseline.csv", senate, list(senate[0].keys()))

    # Redistricting impact by state (only states whose lines changed).
    by_state = []
    for s in sorted({h["state"] for h in house if h["lines_changed"]}):
        hs = [h for h in house if h["state"] == s]
        by_state.append({
            "state": s,
            "seats": len(hs),
            "districts_changed": sum(h["lines_changed"] for h in hs),
            "trump_seats_old": sum(h["old_lines_winner"] == "R" for h in hs),
            "trump_seats_new": sum(h["new_lines_winner"] == "R" for h in hs),
            "net_r_change": sum(h["new_lines_winner"] == "R" for h in hs) - sum(h["old_lines_winner"] == "R" for h in hs),
        })
    write_csv(RESULTS / "redistricting_by_state.csv", by_state, list(by_state[0].keys()))

    # Seat totals under a uniform national swing.
    swing = []
    for x in SWING_GRID:
        swing.append({
            "swing_to_d": x,
            "house_d_old_lines": sum(old[r]["margin24"] + x > 0 for r in old),
            "house_d_new_lines": sum(new[r]["margin24"] + x > 0 for r in new),
            "senate_d_of_35": sum(st_new[r["race_id"][:2]] + x > 0 for r in senate),
        })
    write_csv(RESULTS / "seats_by_national_swing.csv", swing, list(swing[0].keys()))

    # Market comparison and the expected-points pick (Kalshi enters only here).
    retrieved, market = load_kalshi(fetch_kalshi(args.refresh))
    preds = {r["race_id"]: r for r in house} | {r["race_id"]: r for r in senate}
    compare = []
    for t in load_template("full_congress_track_template.csv"):
        rid, mk = t["race_id"], market.get(t["race_id"])
        p_d = win_prob_d(preds[rid]["projected_margin"], sigma)
        row = {"race_id": rid, "chamber": t["chamber"], "projected_margin": preds[rid]["projected_margin"],
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
    write_csv(RESULTS / "model_vs_kalshi.csv", compare, fields)

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
    write_csv(RESULTS / "strategy_summary.csv", summary, list(summary[0].keys()))

    # Submissions in the official template format: model favorite (baseline_*) and EV rule (ev_*).
    picks = {r["race_id"]: r for r in compare}
    for tmpl, track in [("senate_track_template.csv", "senate"), ("full_congress_track_template.csv", "full_congress")]:
        template = load_template(tmpl)
        for prefix, choose in [("baseline", "model_favorite"), ("ev", "pick")]:
            rows = []
            for t in template:
                r, mk = picks[t["race_id"]], market.get(t["race_id"])
                party = r[choose]
                p_model = r["model_p_r"] if party == "R" else 1 - r["model_p_r"]
                name = mk["cands"].get(party, {}).get("name", "") if mk else ""
                rows.append({**t, "predicted_winner_party": party, "candidate_name": name,
                             "win_probability": round(p_model, 4)})
            out = SUBMISSION / f"{prefix}_{track}.csv"
            write_csv(out, rows, list(template[0].keys()))
            validate_submission(out, template)

    d_new = sum(h["new_lines_winner"] == "D" for h in house)
    d_old = sum(h["old_lines_winner"] == "D" for h in house)
    d_pred = sum(h["predicted_party"] == "D" for h in house)
    d_exp = sum(win_prob_d(h["projected_margin"], sigma) for h in house)
    print(f"sigma (RMS 2020->2024 district shift): {sigma:.2f} pts")
    print(f"generic ballot (mean of {len(gb)} averages): D{gb_margin:+.2f};  2024 pres: D{pres_margin:+.2f};  "
          f"swing applied: D{swing_to_d:+.2f}{' (override)' if args.swing is not None else ''}")
    print(f"House, 2024 replay: old lines D {d_old} / R {435 - d_old};  2026 lines D {d_new} / R {435 - d_new}")
    print(f"House, with swing: D {d_pred} / R {435 - d_pred} (expected D seats {d_exp:.1f}); "
          f"{sum(h['flips_with_swing'] for h in house)} seats flip from the replay")
    print(f"districts with changed lines: {sum(h['lines_changed'] for h in house)}")
    print(f"crossover seats (incumbent party != 2024 winner on new lines): {sum(h['crossover'] for h in house)}")
    print(f"Senate, with swing: D {sum(r['predicted_party'] == 'D' for r in senate)} of 35 "
          f"(2024 replay: {sum(st_new[r['race_id'][:2]] > 0 for r in senate)})")
    print(f"Kalshi snapshot {retrieved}: markets for {len(market)} of 470 races")
    for r in summary:
        print(f"  {r['scope']:6} {r['strategy']:21} underdog picks {r['underdog_picks']:3}  "
              f"E[pts] model {r['expected_points_model']:6.2f}  if Kalshi right {r['expected_points_if_kalshi_right']:6.2f}")
    print(f"wrote {RESULTS.relative_to(ROOT)}/ and {SUBMISSION.relative_to(ROOT)}/{{baseline,ev}}_*.csv")


if __name__ == "__main__":
    main()
