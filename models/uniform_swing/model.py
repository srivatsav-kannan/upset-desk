"""Uniform swing (Baseline v2): the 2024 vote on the 2026 map, a generic-ballot swing, incumbency.

Each race is predicted from the 2024 presidential margin inside its 2026 boundaries, plus a
uniform national swing. House districts use The Downballot's 2024 presidential results
recomputed on the lines used in 2026; Senate races use the statewide 2024 presidential margin
(sum of a state's districts).
  Swing = (mean of the published generic-ballot averages listed on Wikipedia, D minus R)
          - (2024 national presidential margin, summed from all 435 districts).
  v2 margin = 2024 margin + swing + B_RUN * (incumbent running: +1 D / -1 R)
                                  + B_OPEN * (open seat: +1 if D held it / -1 if R held it)
  v2 win probability = Student-t CDF(margin / scale, df).
  B_RUN, B_OPEN, df and scale are fit on the 2010-2022 House backtest (backtest.py), which
  also shows them calibrated out of sample. Incumbents come from Wikipedia's 2026 House and
  Senate tables. The Senate reuses the House fit (not backtested on the Senate yet).
  v1 (normal CDF, sigma = RMS 2020->2024 district shift, no incumbency) is kept in results/
  for comparison. --swing 0 replays 2024 with no national swing.
"""

import math
import statistics
from pathlib import Path

from common import (PREDICTION_FIELDS, SENATE_PAGE, SENATE_SECTIONS, fetch, fetch_generic_ballot, fetch_wiki,
                    load_districts, load_generic_ballot, load_house_incumbents_2026, load_senate_incumbents_2026,
                    load_template, national_margin, state_margins, write_csv)

from . import backtest

DIR = Path(__file__).resolve().parent
RESULTS = DIR / "results"
SWING_GRID = [-2, 0, 2, 4, 6, 8, 10, 12]


def add_arguments(ap) -> None:
    ap.add_argument("--swing", type=float, help="uniform_swing: override the national swing to D, in points")


def estimate_sigma(old_lines: dict) -> float:
    """RMS 2020->2024 change in district presidential margin on unchanged (2024) lines."""
    diffs = [d["margin24"] - d["margin20"] for d in old_lines.values() if d["margin20"] is not None]
    return math.sqrt(sum(x * x for x in diffs) / len(diffs))


def win_prob_d(margin: float, sigma: float) -> float:
    return statistics.NormalDist().cdf(margin / sigma)


def predict(margin: float, sigma: float) -> tuple:
    p_d = win_prob_d(margin, sigma)
    return ("D", p_d) if margin > 0 else ("R", 1 - p_d)


SIGN = {"D": 1, "R": -1}


def house_incumbency(members: list) -> tuple:
    """(running, open) for a 2026 district, coded as in backtest.incumbency_features."""
    running = max(-1, min(1, sum(SIGN.get(m["party"], 0) for m in members if m["running"])))
    if any(m["running"] for m in members):
        return running, 0
    held = {m["party"] for m in members}
    return 0, SIGN.get(held.pop(), 0) if len(held) == 1 else 0


def run(args) -> None:
    new = load_districts(fetch("downballot_2026_lines", args.refresh))
    old = load_districts(fetch("downballot_2024_lines", args.refresh))
    sigma = estimate_sigma(old)

    # v2 parameters: fit on every 2010-2022 House race (the backtest also scores them out of sample).
    bt = backtest.run_backtest(args.refresh, sigma)
    (b_run, b_open), (t_df, t_scale) = bt["betas_ro"], bt["t_ro"]

    def p_d_v2(margin: float) -> float:
        return backtest.cdf(margin / t_scale, t_df)

    house_inc = load_house_incumbents_2026(
        fetch_wiki("house_2026", "2026_United_States_House_of_Representatives_elections", [], args.refresh))
    senate_inc = load_senate_incumbents_2026(fetch_wiki("senate_2026", SENATE_PAGE, SENATE_SECTIONS, args.refresh))

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
        x_run, x_open = house_incumbency(house_inc[rid])
        margin_v1 = n["margin24"] + swing_to_d
        margin = margin_v1 + b_run * x_run + b_open * x_open
        p_d = p_d_v2(margin)
        party, prob = ("D", p_d) if margin > 0 else ("R", 1 - p_d)
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
            "incumbent_running": x_run,
            "open_seat_held_by": x_open,
            "margin_v1": round(margin_v1, 2),
            "p_d_v1": round(win_prob_d(margin_v1, sigma), 4),
            "projected_margin": round(margin, 2),
            "p_d": p_d,
            "predicted_party": party,
            "win_probability": round(prob, 4),
        })
    for h in house:
        h["notional_flip"] = h["old_lines_winner"] != h["new_lines_winner"]
        h["crossover"] = h["incumbent_party"] in {"D", "R"} and h["incumbent_party"] != h["new_lines_winner"]
        h["flips_with_swing"] = h["predicted_party"] != h["new_lines_winner"]
        h["flips_vs_v1"] = h["predicted_party"] != ("D" if h["margin_v1"] > 0 else "R")

    # Senate: statewide 2024 presidential margin (identical on any district map).
    st_new, st_old = state_margins(new), state_margins(old)
    for s in st_new:
        assert abs(st_new[s] - st_old[s]) < 0.5, f"{s}: statewide totals disagree across maps"
    senate = []
    for t in load_template("senate_track_template.csv"):
        s = t["race_id"][:2]
        inc = senate_inc[s]
        x_run = SIGN.get(inc["party"], 0) if inc["running"] else 0
        x_open = 0 if inc["running"] else SIGN.get(inc["party"], 0)
        margin_v1 = st_new[s] + swing_to_d
        margin = margin_v1 + b_run * x_run + b_open * x_open
        p_d = p_d_v2(margin)
        party, prob = ("D", p_d) if margin > 0 else ("R", 1 - p_d)
        senate.append({"race_id": t["race_id"], "state": s, "margin_2024": round(st_new[s], 2),
                       "incumbent_party": inc["party"], "incumbent_running": x_run, "open_seat_held_by": x_open,
                       "margin_v1": round(margin_v1, 2), "p_d_v1": round(win_prob_d(margin_v1, sigma), 4),
                       "projected_margin": round(margin, 2), "p_d": p_d, "predicted_party": party,
                       "win_probability": round(prob, 4),
                       "flips_with_swing": party != ("D" if st_new[s] > 0 else "R"),
                       "flips_vs_v1": party != ("D" if margin_v1 > 0 else "R")})

    def rounded(rows: list) -> list:
        return [{**r, "p_d": round(r["p_d"], 4)} for r in rows]

    write_csv(RESULTS / "house_2024_on_2026_map.csv", rounded(house), list(house[0].keys()))
    write_csv(RESULTS / "senate_2024_baseline.csv", rounded(senate), list(senate[0].keys()))

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

    # Predictions in the shared format that decide.py reads (one row per race, template order).
    by_race = {r["race_id"]: r for r in house} | {r["race_id"]: r for r in senate}
    preds = []
    for t in load_template("full_congress_track_template.csv"):
        r = by_race[t["race_id"]]
        preds.append({"race_id": t["race_id"], "chamber": t["chamber"], "projected_margin": r["projected_margin"],
                      "p_d": r["p_d"],
                      "predicted_winner_party": r["predicted_party"], "win_probability": r["win_probability"]})
    write_csv(DIR / "predictions.csv", preds, PREDICTION_FIELDS)

    d_new = sum(h["new_lines_winner"] == "D" for h in house)
    d_old = sum(h["old_lines_winner"] == "D" for h in house)
    d_pred = sum(h["predicted_party"] == "D" for h in house)
    d_exp = sum(h["p_d"] for h in house)
    print(f"v2: incumbent running {b_run:+.2f} pts, open seat {b_open:+.2f} pts, Student-t df {t_df} scale {t_scale:.2f} "
          f"(v1 normal sigma {sigma:.2f});  House incumbents running {sum(h['incumbent_running'] != 0 for h in house)}, "
          f"open seats {sum(h['open_seat_held_by'] != 0 for h in house)};  "
          f"calls changed vs v1: House {sum(h['flips_vs_v1'] for h in house)}, Senate {sum(r['flips_vs_v1'] for r in senate)}")
    print(f"generic ballot (mean of {len(gb)} averages): D{gb_margin:+.2f};  2024 pres: D{pres_margin:+.2f};  "
          f"swing applied: D{swing_to_d:+.2f}{' (override)' if args.swing is not None else ''}")
    print(f"House, 2024 replay: old lines D {d_old} / R {435 - d_old};  2026 lines D {d_new} / R {435 - d_new}")
    print(f"House, with swing: D {d_pred} / R {435 - d_pred} (expected D seats {d_exp:.1f}); "
          f"{sum(h['flips_with_swing'] for h in house)} seats flip from the replay")
    print(f"districts with changed lines: {sum(h['lines_changed'] for h in house)}")
    print(f"crossover seats (incumbent party != 2024 winner on new lines): {sum(h['crossover'] for h in house)}")
    print(f"Senate, with swing: D {sum(r['predicted_party'] == 'D' for r in senate)} of 35 "
          f"(2024 replay: {sum(st_new[r['race_id'][:2]] > 0 for r in senate)})")

    backtest.report(bt)
