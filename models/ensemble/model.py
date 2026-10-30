"""Ensemble: fundamentals + expert ratings + Senate polls, stacked and backtested, plus a news layer.

For every 2026 race:
  1. Inputs. Fundamentals from uniform_swing (2024 presidential margin on the 2026 lines plus
     the generic-ballot swing, and incumbency); the mean of up to 11 expert ratings
     (Wikipedia's ratings tables; a seat no rater lists counts as Safe for its favorite); for
     the Senate, an average of the last 28 days of polls (Wikipedia race pages).
  2. Stack. A regression of the actual margin on those inputs, fit on 2010-2022 House and
     Senate races (backtest.py), gives the margin; a Student-t fit on the same races gives the
     win probability. Independents (NE, MT, SD, ID Senate; AK-AL) drop the fundamentals terms.
  3. News layer. Researched candidate-quality and late-news scores (news_protocol.md, frozen
     in data/raw/llm_news/) move the margin by at most 2.5 points. The scores are centred on
     their mean first, so the layer re-ranks races but cannot shift the national environment.
     It is not backtested (see README); the pre-news probability is kept in results/.
  4. Simulation. 20,000 seeded elections with one shared national error per run give seat
     distributions and a stress test in which the generic ballot overstates Democrats by its
     2010-2022 average.
"""

import datetime as dt
import math
import random
from pathlib import Path

from common import (ELECTION_DAY, MODELS, PREDICTION_FIELDS, RAW, cdf, fetch_house_ratings, fetch_senate_page,
                    fetch_senate_race_page, load_ratings, load_template, load_wiki_polls, read_rows, write_csv)

from . import backtest

DIR = Path(__file__).resolve().parent
RESULTS = DIR / "results"
BASELINE = MODELS / "uniform_swing" / "results"
DEPENDS_ON = ["uniform_swing"]  # reads its 2026 fundamentals and its House backtest
NEWS = RAW / "llm_news"
NEWS_SHRINK, QUALITY_PTS, NEWS_PTS = 0.5, 1.5, 1.0  # adjustment = 0.5 * (1.5 * quality + 1.0 * news)
SIMS, SEED = 20000, 2026
SENATE_DEM_CAUCUS_NOW = 47  # 45 D + 2 I (King, Sanders) in the 119th Congress
FIXED = 1e-6  # races this close to certain are not simulated (their winner is fixed)


def add_arguments(ap) -> None:
    ap.add_argument("--ensemble-d-correction", action="store_true",
                    help="ensemble: shift the generic-ballot swing by its 2010-2022 mean miss (worse in the backtest)")


def load_news() -> dict:
    """{race_id: row} from the newest frozen research file, with the centred point adjustment."""
    path = sorted(NEWS.glob("news_*.csv"))[-1]
    rows = {r["race_id"]: r for r in read_rows(path)}
    q_mean = sum(int(r["quality_edge"]) for r in rows.values()) / len(rows)
    n_mean = sum(int(r["news_edge"]) for r in rows.values()) / len(rows)
    for r in rows.values():
        r["adjustment"] = NEWS_SHRINK * (QUALITY_PTS * (int(r["quality_edge"]) - q_mean)
                                         + NEWS_PTS * (int(r["news_edge"]) - n_mean))
    return rows, path.name, q_mean, n_mean


def senate_polls(state: str, refresh: bool) -> tuple:
    """(average, pollsters, non-R party, polls) for one 2026 Senate race, from Wikipedia."""
    day = dt.date.fromisoformat(ELECTION_DAY[2026])
    polls = load_wiki_polls(fetch_senate_race_page(2026, state, state in ("OH", "FL"), refresh), 2026)
    polls = [dict(p, days=(day - p["end"]).days) for p in polls]
    recent = [p for p in polls if p["days"] <= backtest.POLL_WINDOW]
    avg, n = backtest.poll_average(polls)
    parties = [p["non_r_party"] for p in recent]
    return avg, n, max(set(parties), key=parties.count) if parties else "D", recent


EXPLAIN_FIELDS = ["race_id", "Fundamentals", "Expert ratings", "Polls", "Candidates & news", "Baseline v2"]


def lead(margin: float, non_r: str = "D") -> str:
    return f"{non_r if margin > 0 else 'R'}+{abs(margin):.1f}"


def rating_words(score: float, non_r: str) -> str:
    level = next(w for cut, w in ((2.5, "Safe"), (1.5, "Likely"), (0.75, "Lean"), (0.25, "Tilt"), (0, "Toss-up"))
                 if abs(score) >= cut)
    return level if level == "Toss-up" else f"{level} {non_r if score > 0 else 'R'}"


def explain(r: dict, nw: dict) -> dict:
    """One line per input for the visualizer's tooltip (results/race_explain.csv)."""
    inc = {1: ", D incumbent running", -1: ", R incumbent running"}.get(r["x_run"], ", open seat" if r["x_open"] else "")
    rating = (f"{rating_words(r['rating'], r['non_r'])} (mean of {r['raters']} raters)" if r["rating"] is not None
              else "Not rated: safe for the favorite")
    polls = f"{lead(r['poll'], r['non_r'])} ({r['polls']} pollsters, last 4 weeks)" if r["poll"] is not None else ""
    news = f"{r['news_adjustment']:+.1f} pts. {nw.get('summary', '')}".strip() if nw else ""
    fund = "independent race: not used" if r["ind"] else f"{lead(r['pred'])} (2024 vote + national swing{inc})"
    return {"race_id": r["race_id"], "Fundamentals": fund, "Expert ratings": rating, "Polls": polls,
            "Candidates & news": news, "Baseline v2": f"{100 * max(r['p_d_v2'], 1 - r['p_d_v2']):.0f}% "
                                                     f"{'R' if r['p_d_v2'] < 0.5 else 'D'}"}


def t_draw(rng: random.Random, df) -> float:
    z = rng.gauss(0.0, 1.0)
    return z if df is None else z / math.sqrt(sum(rng.gauss(0.0, 1.0) ** 2 for _ in range(df)) / df)


def simulate(races: list, national_sd: float, shift: float = 0.0) -> dict:
    """Seat counts over SIMS seeded elections, each with one national error shared by every race.

    A race's own error is shrunk so that national + local roughly matches its calibrated
    spread; predictions.csv keeps the exact (analytic) probabilities, this is for seat totals.
    """
    rng = random.Random(SEED)
    live = [r for r in races if FIXED < r["p_d"] < 1 - FIXED]
    fixed = {ch: sum(r["p_d"] >= 1 - FIXED for r in races if r["chamber"] == ch) for ch in ("House", "Senate")}
    for r in live:
        r["local_scale"] = math.sqrt(max(r["scale"] ** 2 - national_sd ** 2, 0.25 * r["scale"] ** 2))
    seats = {"House": [], "Senate": []}
    for _ in range(SIMS):
        nat = rng.gauss(shift, national_sd)
        won = dict(fixed)
        for r in live:
            won[r["chamber"]] += r["m"] + nat + r["local_scale"] * t_draw(rng, r["df"]) > 0
        for ch in seats:
            seats[ch].append(won[ch])
    return seats


def quantile(xs: list, q: float) -> int:
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


def run(args) -> None:
    d_corr = getattr(args, "ensemble_d_correction", False)
    bt = backtest.run_backtest(args.refresh, d_corr)
    spec, params = bt["spec"], bt["params"]
    news, news_file, q_mean, n_mean = load_news()

    base = {r["race_id"]: r for r in read_rows(BASELINE / "house_2024_on_2026_map.csv")}
    base |= {r["race_id"]: r for r in read_rows(BASELINE / "senate_2024_baseline.csv")}
    h_ratings = load_ratings(fetch_house_ratings(2026, args.refresh), "House")
    s_ratings = load_ratings(fetch_senate_page(2026, args.refresh), "Senate")

    races, poll_rows = [], []
    for t in load_template("full_congress_track_template.csv"):
        rid, chamber = t["race_id"], t["chamber"]
        b = base[rid]
        if chamber == "Senate":
            rt = s_ratings.get((rid[:2], rid[:2] in ("OH", "FL")))
            poll, n_polls, non_r, recent = senate_polls(rid[:2], args.refresh)
            poll_rows += [{"race_id": rid, "pollster": p["pollster"], "end": p["end"].isoformat(), "days": p["days"],
                           "sample": p["n"], "population": p["pop"], "partisan": p["partisan"],
                           "non_r_party": p["non_r_party"], "margin": p["margin"]} for p in recent]
        else:
            rt = h_ratings.get(rid)
            poll, n_polls = None, 0
            non_r = "I" if "(I" in news.get(rid, {}).get("dem_candidate", "") else "D"
        r = {"chamber": chamber, "race_id": rid, "pred": float(b["margin_v1"]), "x_run": int(b["incumbent_running"]),
             "x_open": int(b["open_seat_held_by"]), "rating": sum(rt["scores"]) / len(rt["scores"]) if rt else None,
             "raters": len(rt["scores"]) if rt else 0, "poll": poll, "polls": n_polls, "ind": non_r == "I",
             "gb_correction": bt["gb_correction"]}
        m_stack, p_stack = backtest.predict(r, spec, params)
        pat = backtest.pattern(r, spec)
        df, scale = params[pat][1]
        adj = news[rid]["adjustment"] if rid in news else 0.0
        m = m_stack + adj
        p_d = cdf(m / scale, df)
        r.update({"pattern": "/".join([chamber, "independent" if r["ind"] else "D-R", "polls" if pat[2] else "no polls"]),
                  "margin_stack": m_stack, "p_d_stack": p_stack, "news_adjustment": adj, "m": m, "p_d": p_d,
                  "df": df, "scale": scale, "p_d_v2": float(b["p_d"]), "margin_v2": float(b["projected_margin"]),
                  "non_r": non_r})
        races.append(r)

    # Predictions in the shared format (p_d unrounded).
    preds = []
    for r in races:
        party = (r["non_r"] if r["p_d"] > 0.5 else "R")
        preds.append({"race_id": r["race_id"], "chamber": r["chamber"], "projected_margin": round(r["m"], 2),
                      "p_d": r["p_d"], "predicted_winner_party": party,
                      "win_probability": round(max(r["p_d"], 1 - r["p_d"]), 4)})
    write_csv(DIR / "predictions.csv", preds, PREDICTION_FIELDS)

    comp = []
    for r in races:
        nw = news.get(r["race_id"], {})
        comp.append({"race_id": r["race_id"], "chamber": r["chamber"], "pattern": r["pattern"],
                     "fundamentals_margin": round(r["pred"], 2), "incumbent_running": r["x_run"],
                     "open_seat_held_by": r["x_open"],
                     "rating_mean": round(r["rating"], 3) if r["rating"] is not None else "", "raters": r["raters"],
                     "poll_average": round(r["poll"], 2) if r["poll"] is not None else "", "pollsters": r["polls"],
                     "margin_stack": round(r["margin_stack"], 2), "p_d_stack": round(r["p_d_stack"], 4),
                     "quality_edge": nw.get("quality_edge", ""), "news_edge": nw.get("news_edge", ""),
                     "news_adjustment": round(r["news_adjustment"], 2), "projected_margin": round(r["m"], 2),
                     "p_d": round(r["p_d"], 4), "margin_uniform_swing_v2": r["margin_v2"],
                     "p_d_uniform_swing_v2": r["p_d_v2"], "non_r_party": r["non_r"],
                     "candidates": " vs ".join(x for x in (nw.get("dem_candidate", ""), nw.get("other_candidate", ""),
                                                            nw.get("rep_candidate", "")) if x),
                     "news_summary": nw.get("summary", "")})
    write_csv(RESULTS / "race_components.csv", comp, list(comp[0].keys()))
    write_csv(RESULTS / "race_explain.csv", [explain(r, news.get(r["race_id"], {})) for r in races], EXPLAIN_FIELDS)
    write_csv(RESULTS / "senate_polls_2026.csv", poll_rows, list(poll_rows[0].keys()))

    names = {"House": ["pred", "x_run", "x_open", "rating", "intercept"], "Senate": ["pred", "x_run", "x_open", "rating"]}
    prm = []
    for (ch, ind, pol), (w, (df, scale)) in sorted(params.items()):
        cols = ([] if ind else ["fundamentals_margin", "incumbent_running", "open_seat"]) + ["rating_mean"]
        cols += ["poll_average"] if pol else []
        cols += ["intercept"] if spec["intercept"] else []
        prm.append({"chamber": ch, "independent": ind, "polls": pol, "student_t_df": df if df else "normal",
                    "student_t_scale": round(scale, 3), **{f"w_{c}": round(x, 4) for c, x in zip(cols, w)}})
    keys = []
    for p in prm:
        keys += [k for k in p if k not in keys]
    write_csv(RESULTS / "parameters.csv", prm, keys)

    # Seat distributions: central case, and the generic ballot overstating Democrats by its average miss.
    held_up = sum(r["chamber"] == "Senate" and base[r["race_id"]]["incumbent_party"] in ("D", "I") for r in races)
    holdover = SENATE_DEM_CAUCUS_NOW - held_up
    summary, dist = [], []
    for scenario, shift in [("central", 0.0), ("generic ballot overstates D by its 2010-2022 mean", bt["gb_correction"])]:
        seats = simulate(races, bt["national_sd"], shift)
        seats["Senate"] = [s + holdover for s in seats["Senate"]]
        for ch, need in (("House", 218), ("Senate", 51)):
            xs = seats[ch]
            summary.append({"scenario": scenario, "chamber": ch, "mean_non_r_seats": round(sum(xs) / len(xs), 1),
                            "p05": quantile(xs, 0.05), "median": quantile(xs, 0.5), "p95": quantile(xs, 0.95),
                            "p_non_r_majority": round(sum(x >= need for x in xs) / len(xs), 4),
                            "majority_needs": need, "simulations": SIMS, "seed": SEED})
            for s in sorted(set(xs)):
                dist.append({"scenario": scenario, "chamber": ch, "non_r_seats": s,
                             "probability": round(xs.count(s) / len(xs), 5)})
    write_csv(RESULTS / "simulation_summary.csv", summary, list(summary[0].keys()))
    write_csv(RESULTS / "seat_distribution.csv", dist, list(dist[0].keys()))

    backtest.report(bt)
    print(f"news layer: {news_file}, {len(news)} races researched; centred on mean quality {q_mean:+.2f}, "
          f"news {n_mean:+.2f}; adjustments {min(n['adjustment'] for n in news.values()):+.2f} .. "
          f"{max(n['adjustment'] for n in news.values()):+.2f} pts")
    for ch in ("House", "Senate"):
        rs = [r for r in races if r["chamber"] == ch]
        print(f"{ch}: non-R favored in {sum(r['p_d'] > 0.5 for r in rs)} of {len(rs)} "
              f"(expected {sum(r['p_d'] for r in rs):.1f}); calls changed vs uniform_swing v2: "
              f"{sum((r['p_d'] > 0.5) != (r['p_d_v2'] > 0.5) for r in rs)}; by the news layer: "
              f"{sum((r['p_d'] > 0.5) != (r['p_d_stack'] > 0.5) for r in rs)}")
    for s in summary:
        print(f"  {s['scenario'][:20]:20} {s['chamber']:6} non-R seats median {s['median']} "
              f"(90% {s['p05']}-{s['p95']}), P(non-R majority) {s['p_non_r_majority']:.3f}")
