"""Backtest of House district polls on top of the ensemble's stack, 2010-2022, leave-one-cycle-out.

The ensemble's regression (models/ensemble/backtest.py) already gives each pattern (chamber,
independent, has polls) its own weights, but it never gives House races polls. Here every
House race with general-election polls in the last 28 days gets the same weighted average the
ensemble uses for the Senate, from 538's archive, so polled House races get their own weights
(fundamentals, incumbency, rating mean and poll average). Every other race keeps the
ensemble's pattern, so its forecast is unchanged.

A poll counts only if it is of the deciding matchup: its candidates must be the seat's
strongest Democrat and strongest Republican (538 candidate ids), as for the Senate.

Partisan polls lean toward their sponsor. The sponsor correction subtracts each side's mean
lean (D-sponsored, R-sponsored), measured against nonpartisan polls of the same cycle, from
that side's polls. It is estimated without the held-out cycle, like every other parameter.
"""

from pathlib import Path

from common import (MIDTERMS, fetch_fte, load_house_results, load_raw_polls, rms, wilson, write_csv)
from models.ensemble import backtest as ens

RESULTS = Path(__file__).resolve().parent / "results"
SPEC = ens.VARIANTS[ens.FINAL]
# Poll treatments, each scored out of sample: (subtract the sponsor's lean, half weight for partisan polls).
VARIANTS = {"ensemble": None, "+house polls": (False, True), "+house polls, sponsor-corrected": (True, True),
            "+house polls, sponsor-corrected, full weight": (True, False)}
# Chosen on the out-of-sample scores of the polled House races (midterms weighted). The sponsor
# lean is real (about 5 points each way, the same in every fold), but subtracting it made the
# scores worse, with or without the half weight, so it is reported and not applied.
FINAL = "+house polls"


def history(refresh: bool) -> list:
    """The ensemble's races; each House race carries its deciding-matchup polls ("house_polls")."""
    races = ens.history(refresh)
    house = load_house_results(fetch_fte("election_results_house", refresh), fetch_fte("races", refresh),
                               set(ens.CYCLES))
    keys = {(r["cycle"], r["key"]) for r in races if r["chamber"] == "House"}
    matchup = {}
    for (cy, st, n), c in house.items():
        rid = f"{st}-{n:02d}" if (cy, f"{st}-{n:02d}") in keys else f"{st}-AL"
        top = {p: max((x for x in c["cands"] if x["party"] == p), key=lambda x: x["votes"], default=None) for p in "DR"}
        if top["D"] and top["R"]:
            matchup[(cy, rid)] = (top["D"]["cid"], top["R"]["cid"])
    polls = {}
    for p in load_raw_polls(fetch_fte("raw_polls", refresh)):
        if p["type"] == "House" and (p["non_r_id"], p["r_id"]) == matchup.get(p["key"]):
            polls.setdefault(p["key"], []).append(dict(p, margin=p["margin_poll"]))
    for r in races:
        if r["chamber"] == "House":
            r["house_polls"] = polls.get((r["cycle"], r["key"]), [])
    return races


def sponsor_lean(polls: list) -> dict:
    """{"D": lean, "R": lean}: mean (poll - result) of each side's polls minus that of the same
    cycle's nonpartisan polls, in points toward the non-R candidate, over polls in the window."""
    polls = [p for p in polls if 0 <= p["days"] <= ens.POLL_WINDOW]
    by_cycle = {}
    for p in polls:
        if not p["sponsor"]:
            by_cycle.setdefault(p["cycle"], []).append(p["margin_poll"] - p["margin_actual"])
    base = {c: sum(e) / len(e) for c, e in by_cycle.items()}
    out = {}
    for side in ("D", "R"):
        e = [p["margin_poll"] - p["margin_actual"] - base[p["cycle"]] for p in polls
             if p["sponsor"] == side and p["cycle"] in base]
        out[side] = sum(e) / len(e) if e else 0.0
    return out


def treat(polls: list, lean: dict, corrected: bool, half_weight: bool) -> list:
    """Polls with the sponsor's lean subtracted (if corrected) and partisan half weight on or off."""
    return [dict(p, margin=p["margin"] - (lean.get(p["sponsor"], 0.0) if corrected else 0.0),
                 partisan=p["partisan"] and half_weight) for p in polls]


def with_polls(races: list, variant: str, lean: dict) -> list:
    """Races with each House race's poll average under one variant (None if no poll in the window)."""
    out = []
    for r in races:
        if r["chamber"] == "House":
            avg, n = (None, 0) if VARIANTS[variant] is None else ens.poll_average(treat(r["house_polls"], lean, *VARIANTS[variant]))
            r = dict(r, poll=avg, polls=n)
        out.append(r)
    return out


def all_polls(races: list, cycles: set) -> list:
    return [p for r in races if r["chamber"] == "House" and r["cycle"] in cycles for p in r["house_polls"]]


def run_backtest(refresh: bool) -> dict:
    """Score every variant out of sample, then fit the chosen one on all of 2010-2022."""
    races = history(refresh)
    leans = {}
    for v in VARIANTS:
        for y in ens.CYCLES:
            leans[y] = sponsor_lean(all_polls(races, set(ens.CYCLES) - {y}))
            rs = with_polls(races, v, leans[y])
            params = ens.fit([r for r in rs if r["cycle"] != y], SPEC, {ens.pattern(r, SPEC) for r in rs})
            for r, out in zip(rs, races):
                if r["cycle"] == y:
                    out[f"m_{v}"], out[f"p_{v}"] = ens.predict(r, SPEC, params)
                    if v == FINAL:
                        out["poll"], out["polls"] = r["poll"], r["polls"]

    house = [r for r in races if r["chamber"] == "House"]
    polled = [r for r in house if r["poll"] is not None]
    scopes = [("House", house), ("House midterms", [r for r in house if r["cycle"] in MIDTERMS]),
              ("House, polled", polled), ("House, polled midterms", [r for r in polled if r["cycle"] in MIDTERMS]),
              ("House rated (competitive)", [r for r in house if r["rating"] is not None]),
              ("Senate", [r for r in races if r["chamber"] == "Senate"])]
    scopes += [(f"House, polled {y}", [r for r in polled if r["cycle"] == y]) for y in ens.CYCLES]
    rows = [{"scope": s, "variant": v, **ens.score(rs, f"p_{v}")} for s, rs in scopes for v in VARIANTS]
    write_csv(RESULTS / "backtest_scores.csv", rows, ["scope", "variant", "races", "log_loss", "brier", "wrong_calls"])

    col = f"p_{FINAL}"
    calib = []
    for lo, hi in zip(ens.UPSET_BINS, ens.UPSET_BINS[1:]):
        b = [r for r in polled if lo <= min(r[col], 1 - r[col]) < hi]
        k = sum((r[col] > 0.5) != (r["sign"] > 0) for r in b)
        ci = wilson(k, len(b))
        calib.append({"scope": "House, polled", "upset_p_from": lo, "upset_p_to": min(hi, 0.5), "races": len(b),
                      "expected_upsets": round(sum(min(r[col], 1 - r[col]) for r in b), 2),
                      "observed_upsets": k, "observed_ci95_lo": round(ci[0], 4), "observed_ci95_hi": round(ci[1], 4)})
    write_csv(RESULTS / "backtest_calibration.csv", calib, list(calib[0].keys()))

    lean_rows = [{"held_out_cycle": y, "d_sponsored_lean": round(leans[y]["D"], 2),
                  "r_sponsored_lean": round(leans[y]["R"], 2)} for y in ens.CYCLES]
    full_lean = sponsor_lean(all_polls(races, set(ens.CYCLES)))
    lean_rows.append({"held_out_cycle": "none (2026 forecast)", "d_sponsored_lean": round(full_lean["D"], 2),
                      "r_sponsored_lean": round(full_lean["R"], 2)})
    write_csv(RESULTS / "sponsor_lean.csv", lean_rows, list(lean_rows[0].keys()))

    fields = ["cycle", "key", "pred", "x_run", "x_open", "rating", "raters", "poll", "polls", "actual", "sign"]
    fields += [f"{p}_{v}" for v in VARIANTS for p in ("m", "p")]
    write_csv(RESULTS / "backtest_polled_house_races.csv",
              [{k: round(r[k], 4) if isinstance(r[k], float) else r[k] for k in fields} for r in polled], fields)

    # Shared (national) error of the chosen variant, for the simulation: RMS of chamber-cycle mean residuals.
    national = [sum(r["actual"] - r[f"m_{FINAL}"] for r in rs) / len(rs)
                for ch in ("House", "Senate") for y in ens.CYCLES
                for rs in [[r for r in races if r["chamber"] == ch and r["cycle"] == y and abs(r["actual"]) < ens.CLIP]]]

    # Full-sample fit (2010-2022): the weights carried into 2026.
    full = with_polls(races, FINAL, full_lean)
    params = ens.fit(full, SPEC, {(ch, ind, pol) for ch in ("House", "Senate") for ind in (False, True)
                                  for pol in (False, True)})
    return {"races": races, "scores": rows, "calibration": calib, "params": params, "lean": full_lean,
            "treatment": VARIANTS[FINAL], "national_sd": rms(national)}


def report(bt: dict) -> None:
    for row in bt["scores"]:
        if not row["scope"].startswith("House, polled 2"):
            print(f"  {row['scope']:26} {row['variant']:44} log loss {row['log_loss']:.4f}  Brier {row['brier']:.4f}  "
                  f"wrong calls {row['wrong_calls']:3} of {row['races']}")
    print(f"  sponsor lean (2010-2022, vs nonpartisan polls): D-sponsored {bt['lean']['D']:+.2f}, "
          f"R-sponsored {bt['lean']['R']:+.2f} pts toward the non-R candidate;  "
          f"shared national error {bt['national_sd']:.2f} pts;  chosen: {FINAL}")
