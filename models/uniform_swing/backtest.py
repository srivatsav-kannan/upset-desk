"""House backtest of the uniform-swing recipe, 2010-2024.

Each past cycle is predicted from the previous presidential margin on that cycle's lines plus
(final pre-election generic ballot - previous presidential national margin), then scored
against the actual winner, with every parameter refit leave-one-cycle-out. Writes
models/uniform_swing/results/backtest_*.csv.
"""

import math
from pathlib import Path

from common import (MIDTERMS, fetch, fetch_fte, load_districts, load_generic_ballot_history,
                    load_house_results, load_pres_pct, national_vote_margins, write_csv)

RESULTS = Path(__file__).resolve().parent / "results"

BACKTEST = {
    2010: ("downballot_2006_lines", 2008), 2012: ("downballot_2012_lines", 2008),
    2014: ("downballot_2012_lines", 2012), 2016: ("downballot_2016_lines", 2012),
    2018: ("downballot_2018_lines", 2016), 2020: ("downballot_2020_lines", 2016),
    2022: ("downballot_2022_lines", 2020), 2024: ("downballot_2024_lines", 2020),
}
# Model probability that the predicted loser wins, binned for the tail-calibration table.
UPSET_BINS = [0.0, 0.0025, 0.01, 0.03, 0.10, 0.25, 0.5000001]

T_DF_GRID = [1, 2, 3, 4, 6, 10, 30, None]  # Student-t degrees of freedom tried; None = normal


def phi(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2))


def cdf(x: float, df=None) -> float:
    """Student-t CDF for integer df (closed form, Abramowitz & Stegun 26.7.3-4); df=None is the normal."""
    if df is None:
        return phi(x)
    th = math.atan(abs(x) / math.sqrt(df))
    c2 = math.cos(th) ** 2
    if df % 2:
        term = s = math.cos(th)
        for j in range(1, (df - 1) // 2):
            term *= c2 * 2 * j / (2 * j + 1)
            s += term
        a = 2 / math.pi * (th + (math.sin(th) * s if df > 1 else 0.0))
    else:
        term = s = 1.0
        for j in range(1, df // 2):
            term *= c2 * (2 * j - 1) / (2 * j)
            s += term
        a = math.sin(th) * s
    return 0.5 + 0.5 * a if x >= 0 else 0.5 - 0.5 * a


def log_loss(races: list, scale: float, key: str = "pred", df=None) -> float:
    """Mean negative log-likelihood (nats) of the actual winners under P(D) = F(margin / scale)."""
    return -sum(math.log(max(cdf(r["sign"] * r[key] / scale, df), 1e-300)) for r in races) / len(races)


def fit_sigma(races: list, key: str = "pred", df=None) -> float:
    """Maximum-likelihood scale (golden-section search on log scale; the likelihood is unimodal)."""
    lo, hi = math.log(0.5), math.log(60.0)
    g = (math.sqrt(5) - 1) / 2
    for _ in range(36):
        a, b = hi - g * (hi - lo), lo + g * (hi - lo)
        if log_loss(races, math.exp(a), key, df) < log_loss(races, math.exp(b), key, df):
            hi = b
        else:
            lo = a
    return math.exp((lo + hi) / 2)


def fit_t(races: list, key: str = "pred") -> tuple:
    """(df, scale) with the best likelihood over T_DF_GRID."""
    fits = [(df, fit_sigma(races, key, df)) for df in T_DF_GRID]
    return min(fits, key=lambda f: log_loss(races, f[1], key, f[0]))


def incumbency_bonus(races: list) -> float:
    """Least-squares points added to the incumbent's party (no intercept), from contested margins."""
    inc = [(1 if r["incumbent"] == "D" else -1, r["actual_margin"] - r["pred"]) for r in races if r["incumbent"]]
    return sum(i * e for i, e in inc) / len(inc)


def wilson(k: int, n: int, z: float = 1.96) -> tuple:
    if n == 0:
        return 0.0, 1.0
    p, den = k / n, 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, c - h), min(1.0, c + h)


def rms(xs: list) -> float:
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else float("nan")


def run_backtest(refresh: bool, sigma_v1: float) -> dict:
    """Replay the v1 recipe on the 2010-2024 House and measure how well sigma is calibrated.

    Forecast mode (2010-2022) uses only pre-election information: the previous presidential
    margin on that cycle's lines and 538's final generic-ballot average. "Oracle" mode swaps in
    the actual national House vote, isolating the district-level error (2024 too).
    Scored races are contested D-vs-R seats won by a D or R; one-party seats (unopposed,
    same-party top-two) are reported but not scored, since 2026 can treat them as locked.
    """
    house = load_house_results(fetch_fte("election_results_house", refresh), fetch_fte("races", refresh), set(BACKTEST))
    pres_nat = national_vote_margins(fetch_fte("election_results_presidential", refresh))
    house_nat = national_vote_margins(fetch_fte("election_results_generichouse", refresh))
    summed = {}
    for (cy, _, _), c in house.items():
        s = summed.setdefault(cy, [0, 0, 0])
        for i in range(3):
            s[i] += c["votes"][i]
    for cy, (d, rep, total) in summed.items():
        if cy in house_nat:  # 538's national House vote ends in 2022; check our sum agrees, then fill gaps
            assert abs(house_nat[cy] - 100 * (d - rep) / total) < 1.0, f"{cy}: summed House vote disagrees with 538"
        house_nat.setdefault(cy, 100 * (d - rep) / total)
    gb = load_generic_ballot_history(fetch_fte("generic_topline_historical", refresh),
                                     fetch_fte("generic_ballot_averages_old_model", refresh))
    races, cycles = [], []
    for y, (sheet, pres_year) in BACKTEST.items():
        path = fetch(sheet, refresh)
        if sheet == "downballot_2024_lines":  # vote totals, already parsed by load_districts
            lean = {k: d["margin20"] for k, d in load_districts(path).items()}
        else:
            lean = load_pres_pct(path, pres_year)
        seats = {}
        for (cy, st, n), c in house.items():
            if cy == y:
                seats[f"{st}-AL" if f"{st}-AL" in lean else f"{st}-{n:02d}"] = c
        missing = sorted(set(lean) - set(seats))
        assert not missing, f"{y}: no House result for {missing[:10]}"
        swing_fc = gb[y]["margin"] - pres_nat[pres_year] if y in gb else None
        swing_or = house_nat[y] - pres_nat[pres_year]
        for rid in sorted(lean):
            c = seats[rid]
            races.append({
                "cycle": y, "race_id": rid, "incumbent": c["incumbent"], "lean": lean[rid],
                "pred": lean[rid] + swing_fc if swing_fc is not None else None,
                "pred_oracle": lean[rid] + swing_or, "actual_margin": c["margin"], "winner": c["winner"],
                "contested": c["contested"], "scored": c["contested"] and c["winner"] in ("D", "R"),
                "sign": 1 if c["winner"] == "D" else -1,
            })
        cycles.append({"cycle": y, "midterm": y in MIDTERMS, "pres_year": pres_year,
                       "generic_ballot_final": round(gb[y]["margin"], 2) if y in gb else "",
                       "generic_ballot_date": gb[y]["date"] if y in gb else "",
                       "house_national_margin": round(house_nat[y], 2),
                       "polling_error": round(house_nat[y] - gb[y]["margin"], 2) if y in gb else "",
                       "pres_national_margin": round(pres_nat[pres_year], 2),
                       "swing_forecast": round(swing_fc, 2) if swing_fc is not None else "",
                       "swing_actual": round(swing_or, 2)})

    scored = [r for r in races if r["scored"]]
    fc = [r for r in scored if r["pred"] is not None]
    fc_cycles = sorted({r["cycle"] for r in fc})

    def with_incumbency(rs: list, beta: float) -> None:
        for r in rs:
            r["pred_inc"] = r["pred"] + beta * {"D": 1, "R": -1}.get(r["incumbent"], 0)

    # Out-of-sample probabilities: every parameter is refit without the held-out cycle.
    loco = {}
    for y in fc_cycles:
        train = [r for r in fc if r["cycle"] != y]
        beta = incumbency_bonus(train)
        with_incumbency(train, beta)
        loco[y] = {"sigma": fit_sigma(train), "t": fit_t(train), "beta": beta, "t_inc": fit_t(train, "pred_inc")}
    for r in races:
        r["upset_v1"] = r["scored"] and r["pred"] is not None and (r["pred"] > 0) != (r["winner"] == "D")
        if r["pred"] is None:
            continue
        r["p_d_v1"] = phi(r["pred"] / sigma_v1)
        if r["cycle"] in loco:
            p = loco[r["cycle"]]
            with_incumbency([r], p["beta"])
            r["p_d_normal"] = phi(r["pred"] / p["sigma"])
            r["p_d_t"] = cdf(r["pred"] / p["t"][1], p["t"][0])
            r["p_d_t_inc"] = cdf(r["pred_inc"] / p["t_inc"][1], p["t_inc"][0])

    variants = {"v1: normal, sigma %.2f" % sigma_v1: "v1", "normal, refit sigma": "normal",
                "Student-t, refit": "t", "Student-t + incumbency, refit": "t_inc"}

    def score(rs: list) -> dict:
        out = {}
        for key in variants.values():
            col = f"p_d_{key}"
            ll = -sum(math.log(max(r[col] if r["sign"] > 0 else 1 - r[col], 1e-300)) for r in rs) / len(rs)
            out[key] = (ll, sum((r[col] - (r["sign"] > 0)) ** 2 for r in rs) / len(rs))
        return out

    def df_label(df) -> str:
        return "normal" if df is None else str(df)

    for c in cycles:
        y = c["cycle"]
        rs = [r for r in scored if r["cycle"] == y]
        c.update({"seats": sum(r["cycle"] == y for r in races), "scored": len(rs),
                  "one_party": sum(r["cycle"] == y and not r["contested"] for r in races),
                  "other_winner": sum(r["cycle"] == y and r["contested"] and not r["scored"] for r in races),
                  "rms_error_oracle": round(rms([r["actual_margin"] - r["pred_oracle"] for r in rs]), 2),
                  "sigma_fit_oracle": round(fit_sigma(rs, "pred_oracle"), 2)})
        if y in loco:
            s = score(rs)
            p = loco[y]
            c.update({"rms_error_forecast": round(rms([r["actual_margin"] - r["pred"] for r in rs]), 2),
                      "wrong_calls_v1": sum(r["upset_v1"] for r in rs), "sigma_fit_this_cycle": round(fit_sigma(rs), 2),
                      "sigma_loco": round(p["sigma"], 2), "t_df_loco": df_label(p["t"][0]),
                      "t_scale_loco": round(p["t"][1], 2), "incumbency_bonus_loco": round(p["beta"], 2),
                      "t_inc_df_loco": df_label(p["t_inc"][0]), "t_inc_scale_loco": round(p["t_inc"][1], 2)})
            for key, (ll, brier) in s.items():
                c[f"log_loss_{key}"], c[f"brier_{key}"] = round(ll, 4), round(brier, 4)
    pooled = {}
    for scope, keep in [("2010-2022", lambda y: True), ("midterms", lambda y: y in MIDTERMS)]:
        rs = [r for r in fc if keep(r["cycle"])]
        row = {"cycle": scope, "scored": len(rs), "wrong_calls_v1": sum(r["upset_v1"] for r in rs),
               "rms_error_forecast": round(rms([r["actual_margin"] - r["pred"] for r in rs]), 2),
               "sigma_fit_this_cycle": round(fit_sigma(rs), 2)}
        for key, (ll, brier) in score(rs).items():
            row[f"log_loss_{key}"], row[f"brier_{key}"] = round(ll, 4), round(brier, 4)
        pooled[scope] = row
        cycles.append(row)
    cfields = ["cycle", "midterm", "pres_year", "generic_ballot_final", "generic_ballot_date", "house_national_margin",
               "polling_error", "pres_national_margin", "swing_forecast", "swing_actual", "seats", "scored",
               "one_party", "other_winner", "wrong_calls_v1", "rms_error_forecast", "rms_error_oracle",
               "sigma_fit_this_cycle", "sigma_fit_oracle", "sigma_loco", "t_df_loco", "t_scale_loco",
               "incumbency_bonus_loco", "t_inc_df_loco", "t_inc_scale_loco"]
    cfields += [f"{m}_{k}" for m in ("log_loss", "brier") for k in variants.values()]
    write_csv(RESULTS / "backtest_cycles.csv", cycles, cfields)

    # Tail calibration: bin races by the model's probability that its predicted loser wins.
    calib = []
    for scope, keep in [("2010-2022", lambda y: True), ("midterms", lambda y: y in MIDTERMS)]:
        for label, key in variants.items():
            col = f"p_d_{key}"
            rs = [r for r in fc if keep(r["cycle"])]
            for lo, hi in zip(UPSET_BINS, UPSET_BINS[1:]):
                b = [r for r in rs if lo <= min(r[col], 1 - r[col]) < hi]
                k = sum((r[col] > 0.5) != (r["sign"] > 0) for r in b)
                exp = sum(min(r[col], 1 - r[col]) for r in b)
                ci = wilson(k, len(b))
                calib.append({"scope": scope, "variant": label, "model_upset_p_from": lo, "model_upset_p_to": min(hi, 0.5),
                              "races": len(b), "expected_upsets": round(exp, 2), "observed_upsets": k,
                              "model_rate": round(exp / len(b), 4) if b else "",
                              "observed_rate": round(k / len(b), 4) if b else "",
                              "observed_ci95_lo": round(ci[0], 4), "observed_ci95_hi": round(ci[1], 4)})
    write_csv(RESULTS / "backtest_calibration.csv", calib, list(calib[0].keys()))

    rfields = ["cycle", "race_id", "incumbent", "lean", "pred", "pred_oracle", "actual_margin", "winner",
               "contested", "scored", "upset_v1"] + [f"p_d_{k}" for k in variants.values()]
    write_csv(RESULTS / "backtest_house_races.csv",
              [{k: round(v, 6) if isinstance(v, float) else v for k, v in r.items()} for r in races], rfields)

    # Full-sample fits (2010-2022): what we would carry into 2026.
    beta = incumbency_bonus(fc)
    with_incumbency(fc, beta)
    t_df, t_scale = fit_t(fc)
    ti_df, ti_scale = fit_t(fc, "pred_inc")
    return {
        "races": len(races), "scored": len(fc), "cycles": fc_cycles, "pooled": pooled, "calibration": calib,
        "variants": variants, "sigma_all": fit_sigma(fc),
        "sigma_midterms": fit_sigma([r for r in fc if r["cycle"] in MIDTERMS]),
        "sigma_oracle": fit_sigma(scored, "pred_oracle"), "beta": beta,
        "t": (df_label(t_df), t_scale), "t_inc": (df_label(ti_df), ti_scale),
        "polling_rmse": rms([c["polling_error"] for c in cycles if isinstance(c.get("polling_error"), float)]),
    }


def report(bt: dict) -> None:
    print(f"backtest: {bt['scored']} contested House races, {bt['cycles'][0]}-{bt['cycles'][-1]} "
          f"(of {bt['races']} seat-cycles incl. 2024 and one-party seats)")
    print(f"  normal sigma: all {bt['sigma_all']:.2f}, midterms {bt['sigma_midterms']:.2f}, with actual national "
          f"vote {bt['sigma_oracle']:.2f};  Student-t df {bt['t'][0]} scale {bt['t'][1]:.2f};  + incumbency "
          f"({bt['beta']:+.1f} pts) df {bt['t_inc'][0]} scale {bt['t_inc'][1]:.2f};  "
          f"generic-ballot RMS miss {bt['polling_rmse']:.2f}")
    for scope, row in bt["pooled"].items():
        print(f"  {scope:9} log loss / Brier: " + ",  ".join(
            f"{k} {row['log_loss_' + k]:.4f} / {row['brier_' + k]:.4f}" for k in bt["variants"].values()))
    for c in bt["calibration"]:
        if c["scope"] == "2010-2022" and c["races"]:
            print(f"  {c['variant']:30} upset p {c['model_upset_p_from']:.4f}-{c['model_upset_p_to']:.4f}: "
                  f"{c['races']:4} races, expected {c['expected_upsets']:6.2f}, observed {c['observed_upsets']:3}")
