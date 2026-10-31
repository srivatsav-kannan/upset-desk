"""House polls: the ensemble, plus House district polls in the races that have them.

For every 2026 race:
  1. Inputs. The ensemble's 2026 inputs (results/race_components.csv: fundamentals,
     incumbency, rating mean, news adjustment), plus, for House races, an average of the
     district's general-election polls from the last 28 days (Wikipedia's state House pages),
     weighted as the ensemble weights Senate polls.
  2. Stack. A House race with polls is forecast by the "House with polls" weights, fit on the
     2010-2022 House races that had polls (backtest.py); the news adjustment is added as in the
     ensemble. Every other race (no district polls, and every Senate race) is the ensemble's
     forecast, copied unchanged: its weights are the same.
  3. Simulation. SIMS seeded elections, each with one national error shared by every race (the
     backtest's chamber-cycle RMS), write every race's simulated winner to
     results/simulated_outcomes.csv. decide.py scores pick strategies against them (the spread
     of the total score, not just its mean); this model never sees the market.
"""

import datetime as dt
import math
import random
import re
from pathlib import Path

from common import (ELECTION_DAY, MODELS, PREDICTION_FIELDS, cdf, fetch_house_ratings, fetch_house_state_page,
                    load_ratings, load_template, load_wiki_house_polls, read_rows, write_csv)
from models.ensemble import backtest as ens

from . import backtest

DIR = Path(__file__).resolve().parent
RESULTS = DIR / "results"
ENSEMBLE = MODELS / "ensemble"
DEPENDS_ON = ["ensemble"]  # reads its 2026 inputs and predictions
# Party committees and PACs that Wikipedia does not mark "(D)"/"(R)".
SPONSOR = {"D": re.compile(r"\((D|DFL)\)|\b(DCCC|DSCC|House Majority)\b"),
           "R": re.compile(r"\(R\)|\b(NRCC|NRSC|Congressional Leadership Fund)\b")}
SIMS, SEED = 4000, 2026
FIXED = 1e-6  # races this close to certain are not simulated (their winner is fixed)


def simulate(races: list, national_sd: float) -> list:
    """SIMS seeded elections: for each race, a string with "1" where the non-R candidate wins.

    One national error per election is shared by every race; a race's own error is shrunk so
    that national + local roughly matches its calibrated spread (as in the ensemble).
    """
    rng = random.Random(SEED)
    live = [i for i, r in enumerate(races) if FIXED < r["p_d"] < 1 - FIXED]
    local = {i: math.sqrt(max(races[i]["scale"] ** 2 - national_sd ** 2, 0.25 * races[i]["scale"] ** 2)) for i in live}
    wins = {i: [] for i in live}
    for _ in range(SIMS):
        nat = rng.gauss(0.0, national_sd)
        for i in live:
            r = races[i]
            z = rng.gauss(0.0, 1.0)
            if r["df"] is not None:
                z /= math.sqrt(rng.gammavariate(r["df"] / 2, 2.0) / r["df"])  # chi-square(df) / df
            wins[i].append("1" if r["m"] + nat + local[i] * z > 0 else "0")
    return ["".join(wins[i]) if i in wins else ("1" if r["p_d"] > 0.5 else "0") * SIMS for i, r in enumerate(races)]


def house_polls_2026(refresh: bool) -> dict:
    """{race_id: [poll]} for 2026 House races, from the state pages of every state with a rated seat.

    Raters list every seat they consider competitive; general-election polls of other seats are
    rare, so states with no rated seat are not fetched. Each fetched page must have a section
    for every one of the state's districts, or this fails.
    """
    day = dt.date.fromisoformat(ELECTION_DAY[2026])
    seats = [t["race_id"] for t in load_template("full_congress_track_template.csv") if t["chamber"] == "House"]
    rated = load_ratings(fetch_house_ratings(2026, refresh), "House")
    out = {}
    for st in sorted({k[:2] for k in rated}):
        mine = [s for s in seats if s[:2] == st]
        at_large = mine == [f"{st}-AL"]
        by_district = load_wiki_house_polls(fetch_house_state_page(2026, st, at_large, refresh), 2026)
        found = {f"{st}-{d}" for d in by_district}
        assert found == set(mine), f"{st}: House page sections {sorted(found ^ set(mine))} do not match the template"
        for d, polls in by_district.items():
            out[f"{st}-{d}"] = []
            for p in polls:
                sponsor = next((s for s, rx in SPONSOR.items() if rx.search(p["pollster"])), "")
                out[f"{st}-{d}"].append(dict(p, days=(day - p["end"]).days, sponsor=sponsor,
                                             partisan=p["partisan"] or bool(sponsor)))
    return out


def run(args) -> None:
    bt = backtest.run_backtest(args.refresh)
    params = bt["params"]
    comp = {r["race_id"]: r for r in read_rows(ENSEMBLE / "results" / "race_components.csv")}
    ens_pred = {r["race_id"]: r for r in read_rows(ENSEMBLE / "predictions.csv")}
    ens_explain = {r["race_id"]: r for r in read_rows(ENSEMBLE / "results" / "race_explain.csv")}
    polls = house_polls_2026(args.refresh)

    preds, changes, poll_rows, explain, sim = [], [], [], [], []
    for t in load_template("full_congress_track_template.csv"):
        rid, c, e = t["race_id"], comp[t["race_id"]], ens_pred[t["race_id"]]
        x = ens_explain[rid]
        ch, kind, polled = c["pattern"].split("/")
        df, scale = params[(ch, kind == "independent", polled == "polls")][1]
        s = {"m": float(c["projected_margin"]), "df": df, "scale": scale, "p_d": float(e["p_d"])}
        if t["chamber"] == "House":
            r = {"chamber": "House", "pred": float(c["fundamentals_margin"]), "x_run": int(c["incumbent_running"]),
                 "x_open": int(c["open_seat_held_by"]), "ind": c["non_r_party"] == "I", "poll": None,
                 "rating": float(c["rating_mean"]) if c["rating_mean"] else None, "gb_correction": 0.0}
            # The weights without polls are the ensemble's: its pre-news forecast must come back.
            _, p_check = ens.predict(r, backtest.SPEC, params)
            assert abs(p_check - float(c["p_d_stack"])) < 1e-3, f"{rid}: {p_check} vs ensemble {c['p_d_stack']}"
            avg, n = ens.poll_average(backtest.treat(polls.get(rid, []), bt["lean"], *bt["treatment"]))
            if avg is not None:
                r["poll"] = avg
                m_stack, _ = ens.predict(r, backtest.SPEC, params)
                df, scale = params[ens.pattern(r, backtest.SPEC)][1]
                m = m_stack + float(c["news_adjustment"])
                p_d = cdf(m / scale, df)
                s = {"m": m, "df": df, "scale": scale, "p_d": p_d}
                party = c["non_r_party"] if p_d > 0.5 else "R"
                e = {"race_id": rid, "chamber": "House", "projected_margin": round(m, 2), "p_d": p_d,
                     "predicted_winner_party": party, "win_probability": round(max(p_d, 1 - p_d), 4)}
                recent = [p for p in polls[rid] if 0 <= p["days"] <= ens.POLL_WINDOW]
                changes.append({"race_id": rid, "poll_average": round(avg, 2), "pollsters": n,
                                "rating_mean": c["rating_mean"], "fundamentals_margin": c["fundamentals_margin"],
                                "ensemble_margin": c["projected_margin"], "ensemble_p_d": round(float(c["p_d"]), 4),
                                "projected_margin": round(m, 2), "p_d": round(p_d, 4),
                                "call_changed": (p_d > 0.5) != (float(c["p_d"]) > 0.5)})
                poll_rows += [{"race_id": rid, "pollster": p["pollster"], "end": p["end"].isoformat(), "days": p["days"],
                               "sample": p["n"], "population": p["pop"], "sponsor": p["sponsor"],
                               "non_r_party": p["non_r_party"], "margin": p["margin"]} for p in recent]
                x = dict(x, Polls=f"{c['non_r_party'] if avg > 0 else 'R'}+{abs(avg):.1f} ({n} pollsters, last 4 weeks)")
        preds.append({k: e[k] for k in PREDICTION_FIELDS})
        explain.append(x)
        sim.append(s)

    write_csv(DIR / "predictions.csv", preds, PREDICTION_FIELDS)
    outcomes = simulate(sim, bt["national_sd"])
    write_csv(RESULTS / "simulated_outcomes.csv",
              [{"race_id": p["race_id"], "p_d": round(float(p["p_d"]), 4), "p_d_simulated": round(o.count("1") / SIMS, 4),
                "non_r_wins": o} for p, o in zip(preds, outcomes)],
              ["race_id", "p_d", "p_d_simulated", "non_r_wins"])
    write_csv(RESULTS / "race_changes.csv", changes, list(changes[0].keys()))
    write_csv(RESULTS / "house_polls_2026.csv", poll_rows, list(poll_rows[0].keys()))
    write_csv(RESULTS / "race_explain.csv", explain, list(explain[0].keys()))
    prm = []
    for (ch, ind, pol), (w, (df, scale)) in sorted(params.items()):
        cols = ([] if ind else ["fundamentals_margin", "incumbent_running", "open_seat"]) + ["rating_mean"]
        cols += ["poll_average"] if pol else []
        prm.append({"chamber": ch, "independent": ind, "polls": pol, "student_t_df": df if df else "normal",
                    "student_t_scale": round(scale, 3), **{f"w_{k}": round(v, 4) for k, v in zip(cols, w)}})
    keys = []
    for p in prm:
        keys += [k for k in p if k not in keys]
    write_csv(RESULTS / "parameters.csv", prm, keys)

    print(f"house_polls backtest: {sum(r['chamber'] == 'House' and r['poll'] is not None for r in bt['races'])} "
          f"polled House races, 2010-2022, leave-one-cycle-out")
    backtest.report(bt)
    flips = [ch["race_id"] for ch in changes if ch["call_changed"]]
    print(f"2026: {len(changes)} House races with district polls; calls changed vs ensemble: {len(flips)} {flips}")
    print(f"simulated outcomes: {SIMS} elections (seed {SEED}), shared national error sd {bt['national_sd']:.2f} pts")
