"""Leave-one-cycle-out backtest of the ensemble on the 2010-2022 House and Senate.

Every past race gets the same inputs the 2026 forecast uses, built only from information
published before that Election Day:
  fundamentals  the previous presidential margin in the seat plus the generic-ballot swing
                (pred), and incumbency (x_run: incumbent running, x_open: open seat held by
                a party), as in uniform_swing v2
  ratings       mean final expert rating, -3 Safe R .. +3 Safe D (Wikipedia ratings tables)
  polls         Senate only: recency- and size-weighted average of the final 28 days of
                polls, one poll per pollster (538's archive of final-weeks polls)
The stack is a least-squares regression of the actual margin on those inputs. Its intercept
is the "D-overstatement correction": generic ballots and polls overstated Democrats in most
past cycles, and the intercept learns by how much. Win probabilities are a Student-t of the
stacked margin, fit by likelihood. Every parameter is refit without the held-out cycle.

The House inputs are read from uniform_swing's committed backtest (same seats, leans and
incumbency coding), so forecast.py runs uniform_swing first.
"""

import math
from pathlib import Path

from common import (MIDTERMS, MODELS, cdf, fetch_fte, fetch_house_ratings, fetch_senate_page, fit_t,
                    load_generic_ballot_history, load_ratings, load_raw_polls, load_senate_results,
                    national_vote_margins, read_rows, rms, state_pres_margins, wilson, write_csv)

RESULTS = Path(__file__).resolve().parent / "results"
BASELINE = MODELS / "uniform_swing" / "results"
CYCLES = [2010, 2012, 2014, 2016, 2018, 2020, 2022]
POLL_WINDOW = 28      # days before Election Day
POLL_HALF_LIFE = 14   # days; a poll's weight halves every two weeks
POLL_N_CAP = 2000     # sample sizes above this get no extra weight
SAFE_CROSSOVER = 10.0  # points of hostile lean within which an unrated incumbent's seat is safe for them
CLIP = 40.0           # landslide margins are clipped when fitting the stack (they carry no win information)
SIGN = {"D": 1, "I": 1, "R": -1}
UPSET_BINS = [0.0, 0.0025, 0.01, 0.03, 0.10, 0.25, 0.5000001]

# Stack variants, each adding one component. FINAL is the one the 2026 forecast uses.
VARIANTS = {
    "fundamentals": {"ratings": False, "polls": False, "gb_correction": False, "intercept": False},
    "+ratings": {"ratings": True, "polls": False, "gb_correction": False, "intercept": False},
    "+ratings+polls": {"ratings": True, "polls": True, "gb_correction": False, "intercept": False},
    "+ratings+polls+gb_corr": {"ratings": True, "polls": True, "gb_correction": True, "intercept": False},
    "+ratings+polls+intercept": {"ratings": True, "polls": True, "gb_correction": False, "intercept": True},
    "+ratings+polls+gb_corr+curve": {"ratings": True, "polls": True, "gb_correction": True, "intercept": False,
                                     "curve": True},
}
# Chosen on the out-of-sample scores (midterms weighted): every form of D-overstatement
# correction and the rating curve made them worse, so they are reported but not used. The
# correction can still be switched on (CORRECTED) with forecast.py --ensemble-d-correction.
FINAL = "+ratings+polls"
CORRECTED = "+ratings+polls+gb_corr"


def prev_pres(year: int) -> int:
    return year - 2 if year % 4 == 2 else year - 4


def poll_average(polls: list) -> tuple:
    """(margin, pollsters) from polls [{pollster, partisan, days, n, margin, pop?}], or (None, 0).

    Keeps each pollster's latest poll in the window (likely-voter version where a poll reports
    several), weighting by recency, sqrt(sample size) and half weight for partisan sponsors.
    """
    latest = {}
    for p in polls:
        if 0 <= p["days"] <= POLL_WINDOW:
            cur = latest.get(p["pollster"])
            if cur is None or p["days"] < cur[0]["days"]:
                latest[p["pollster"]] = [p]
            elif p["days"] == cur[0]["days"]:
                cur.append(p)
    num = den = 0.0
    for group in latest.values():
        group = [p for p in group if p.get("pop") == "LV"] or group
        p = group[0]
        w = 0.5 ** (p["days"] / POLL_HALF_LIFE) * math.sqrt(min(p["n"] or 600.0, POLL_N_CAP)) * (0.5 if p["partisan"] else 1.0)
        num += w * sum(q["margin"] for q in group) / len(group)
        den += w
    return (num / den, len(latest)) if den else (None, 0)


def safe_side(r: dict) -> int:
    """Side an unrated seat is safe for: the running incumbent's party, else the lean's sign.

    Raters only list competitive seats; an unlisted seat is rated Safe for the favored party.
    An incumbent counts only within SAFE_CROSSOVER points of hostile lean: every unrated
    crossover incumbent of 2010-2022 sat within 6.5 points, while mid-decade maps put some
    2026 incumbents in seats 20+ points the other way (CA-01), which raters leave unlisted
    because they are safe for the other party. The constant is set from the leans alone, not
    from outcomes, and changes no backtest race.
    """
    lean = 1 if r["pred"] > 0 else -1
    if r["x_run"] and (r["x_run"] == lean or abs(r["pred"]) <= SAFE_CROSSOVER):
        return r["x_run"]
    return lean


def features(r: dict, spec: dict) -> list:
    """Regressors for one race under a variant. Independents drop the fundamentals terms."""
    pred = r["pred"] + (r["gb_correction"] if spec["gb_correction"] else 0.0)
    xs = [] if r["ind"] else [pred, r["x_run"], r["x_open"]]
    if spec["ratings"] or r["ind"]:
        rating = r["rating"] if r["rating"] is not None else 3.0 * safe_side(r)
        xs.append(rating)
        if spec.get("curve"):
            xs.append(rating ** 3 / 9.0)
    if spec["polls"] and r["poll"] is not None:
        xs.append(r["poll"])
    if spec["intercept"]:
        xs.append(1.0)
    return xs


def pattern(r: dict, spec: dict) -> tuple:
    """Races sharing a pattern share coefficients: chamber, independent, has polls."""
    return (r["chamber"], r["ind"], bool(spec["polls"] and r["poll"] is not None))


def solve(rows: list, ridge: float = 1e-6) -> list:
    """Least squares by the normal equations (Gaussian elimination); rows = [(xs, y)]."""
    k = len(rows[0][0])
    a = [[sum(x[i] * x[j] for x, _ in rows) + (ridge if i == j else 0.0) for j in range(k)] for i in range(k)]
    b = [sum(x[i] * y for x, y in rows) for i in range(k)]
    for c in range(k):
        piv = max(range(c, k), key=lambda i: abs(a[i][c]))
        a[c], a[piv], b[c], b[piv] = a[piv], a[c], b[piv], b[c]
        for i in range(c + 1, k):
            f = a[i][c] / a[c][c]
            for j in range(c, k):
                a[i][j] -= f * a[c][j]
            b[i] -= f * b[c]
    w = [0.0] * k
    for i in reversed(range(k)):
        w[i] = (b[i] - sum(a[i][j] * w[j] for j in range(i + 1, k))) / a[i][i]
    return w


def training_rows(train: list, pat: tuple, spec: dict) -> list:
    """Rows that fit one pattern's coefficients.

    An independent's pattern is fit on every race of its chamber (with the fundamentals
    terms dropped), since independents alone are too few. A no-polls pattern is fit on every
    race of its chamber, ignoring polls, so it uses all the data.
    """
    chamber, ind, polled = pat
    rows = [r for r in train if r["chamber"] == chamber]
    if polled:
        rows = [r for r in rows if r["poll"] is not None]
    return [dict(r, ind=ind) for r in rows]


def fit(train: list, spec: dict, pats: set) -> dict:
    """{pattern: (weights, (df, scale))} fit on training races."""
    out = {}
    for pat in pats:
        rows = training_rows(train, pat, spec)
        nopoll = dict(spec, polls=spec["polls"] and pat[2])
        w = solve([(features(r, nopoll), max(-CLIP, min(CLIP, r["actual"]))) for r in rows])
        for r in rows:
            r["m"] = sum(a * b for a, b in zip(w, features(r, nopoll)))
        out[pat] = (w, fit_t(rows, "m"))
    return out


def predict(r: dict, spec: dict, params: dict) -> tuple:
    """(stacked margin, p_d) for one race."""
    pat = pattern(r, spec)
    w, (df, scale) = params[pat]
    m = sum(a * b for a, b in zip(w, features(r, dict(spec, polls=spec["polls"] and pat[2]))))
    return m, cdf(m / scale, df)


def history(refresh: bool) -> list:
    """Every scored (contested D/R or non-R/R) House and Senate race, 2010-2022, with its inputs."""
    races = []
    # House: seats, leans, incumbency and v2's out-of-sample probability from uniform_swing.
    for y_ratings in [(y, load_ratings(fetch_house_ratings(y, refresh), "House")) for y in CYCLES]:
        y, ratings = y_ratings
        for r in read_rows(BASELINE / "backtest_house_races.csv"):
            if int(r["cycle"]) != y or r["scored"] != "True" or r["pred"] == "":
                continue
            rt = ratings.get(r["race_id"])
            races.append({"chamber": "House", "cycle": y, "key": r["race_id"], "pred": float(r["pred"]),
                          "x_run": int(float(r["x_run"])), "x_open": int(float(r["x_open"])),
                          "rating": sum(rt["scores"]) / len(rt["scores"]) if rt else None,
                          "raters": len(rt["scores"]) if rt else 0, "poll": None, "polls": 0, "ind": False,
                          "actual": float(r["actual_margin"]), "sign": 1 if r["winner"] == "D" else -1,
                          "p_d_v2": float(r["p_d_t_ro"])})
    # Senate: built here from 538's results and polls plus Wikipedia's ratings tables.
    results = load_senate_results(fetch_fte("election_results_senate", refresh), set(CYCLES))
    pres = state_pres_margins(fetch_fte("election_results_presidential", refresh))
    pres_nat = national_vote_margins(fetch_fte("election_results_presidential", refresh))
    gb = load_generic_ballot_history(fetch_fte("generic_topline_historical", refresh),
                                     fetch_fte("generic_ballot_averages_old_model", refresh))
    polls = {}
    for p in load_raw_polls(fetch_fte("raw_polls", refresh)):
        if p["type"] == "Senate":
            polls.setdefault(p["key"], []).append(dict(p, margin=p["margin_poll"]))
    for y in CYCLES:
        swing = gb[y]["margin"] - pres_nat[prev_pres(y)]
        for (st, special), rt in load_ratings(fetch_senate_page(y, refresh), "Senate").items():
            c = results.get((y, st, special))
            if c is None or not c["contested"] or (prev_pres(y), st) not in pres:
                continue
            inc = SIGN.get(rt["inc_party"], 0)
            avg, n = poll_average(polls.get((y, st, special), []))
            races.append({"chamber": "Senate", "cycle": y, "key": f"{st}-SEN{'-special' if special else ''}",
                          "pred": pres[(prev_pres(y), st)] + swing,
                          "x_run": inc if rt["inc_running"] else 0, "x_open": 0 if rt["inc_running"] else inc,
                          "rating": sum(rt["scores"]) / len(rt["scores"]), "raters": len(rt["scores"]),
                          "poll": avg, "polls": n, "ind": c["non_r_party"] == "I",
                          "actual": c["margin"], "sign": 1 if c["winner"] == "D" else -1, "p_d_v2": None})
    return races


def score(rs: list, col: str) -> dict:
    ll = -sum(math.log(max(r[col] if r["sign"] > 0 else 1 - r[col], 1e-300)) for r in rs) / len(rs)
    brier = sum((r[col] - (r["sign"] > 0)) ** 2 for r in rs) / len(rs)
    wrong = sum((r[col] > 0.5) != (r["sign"] > 0) for r in rs)
    return {"races": len(rs), "log_loss": round(ll, 4), "brier": round(brier, 4), "wrong_calls": wrong}


def run_backtest(refresh: bool, d_correction: bool = False) -> dict:
    """Score every variant out of sample, then fit the 2026 variant on all of 2010-2022."""
    races = history(refresh)
    # Generic-ballot miss per cycle (actual House vote - final generic-ballot average), from
    # uniform_swing's backtest. Its leave-one-out mean shifts every race's swing: the
    # "D-overstatement correction" (negative = the generic ballot overstated Democrats).
    gb_error = {int(c["cycle"]): float(c["polling_error"]) for c in read_rows(BASELINE / "backtest_cycles.csv")
                if c["cycle"].isdigit() and c["polling_error"]}
    pats = {v: {pattern(r, spec) for r in races} for v, spec in VARIANTS.items()}
    # Out of sample: refit every variant without the held-out cycle.
    for y in CYCLES:
        corr = sum(e for c, e in gb_error.items() if c != y) / (len(gb_error) - 1)
        for r in races:
            r["gb_correction"] = corr
        train = [r for r in races if r["cycle"] != y]
        for v, spec in VARIANTS.items():
            params = fit(train, spec, pats[v])
            for r in races:
                if r["cycle"] == y:
                    r[f"m_{v}"], r[f"p_{v}"] = predict(r, spec, params)

    rows = []
    scopes = [("House", lambda r: r["chamber"] == "House"), ("Senate", lambda r: r["chamber"] == "Senate"),
              ("Senate, polled", lambda r: r["chamber"] == "Senate" and r["poll"] is not None),
              ("House midterms", lambda r: r["chamber"] == "House" and r["cycle"] in MIDTERMS),
              ("Senate midterms", lambda r: r["chamber"] == "Senate" and r["cycle"] in MIDTERMS),
              ("House rated (competitive)", lambda r: r["chamber"] == "House" and r["rating"] is not None)]
    scopes += [(f"{ch} {y}", lambda r, ch=ch, y=y: r["chamber"] == ch and r["cycle"] == y)
               for ch in ("House", "Senate") for y in CYCLES]
    for scope, keep in scopes:
        rs = [r for r in races if keep(r)]
        for v in VARIANTS:
            rows.append({"scope": scope, "variant": v, **score(rs, f"p_{v}")})
        if rs and rs[0]["chamber"] == "House":
            rows.append({"scope": scope, "variant": "uniform_swing v2", **score(rs, "p_d_v2")})
    write_csv(RESULTS / "backtest_scores.csv", rows, ["scope", "variant", "races", "log_loss", "brier", "wrong_calls"])

    # Calibration of the final variant: binned by the model's probability that its pick loses.
    calib = []
    for scope, keep in scopes[:2]:
        rs = [r for r in races if keep(r)]
        for lo, hi in zip(UPSET_BINS, UPSET_BINS[1:]):
            b = [r for r in rs if lo <= min(r["p_" + FINAL], 1 - r["p_" + FINAL]) < hi]
            k = sum((r["p_" + FINAL] > 0.5) != (r["sign"] > 0) for r in b)
            ci = wilson(k, len(b))
            calib.append({"scope": scope, "upset_p_from": lo, "upset_p_to": min(hi, 0.5), "races": len(b),
                          "expected_upsets": round(sum(min(r["p_" + FINAL], 1 - r["p_" + FINAL]) for r in b), 2),
                          "observed_upsets": k, "observed_ci95_lo": round(ci[0], 4), "observed_ci95_hi": round(ci[1], 4)})
    write_csv(RESULTS / "backtest_calibration.csv", calib, list(calib[0].keys()))

    # Shared (national) error: mean out-of-sample residual of each chamber-cycle.
    national = []
    for ch in ("House", "Senate"):
        for y in CYCLES:
            rs = [r for r in races if r["chamber"] == ch and r["cycle"] == y and abs(r["actual"]) < CLIP]
            national.append({"chamber": ch, "cycle": y, "races": len(rs),
                             "mean_error_" + FINAL: round(sum(r["actual"] - r["m_" + FINAL] for r in rs) / len(rs), 2),
                             "senate_poll_bias": round(sum(r["poll"] - r["actual"] for r in rs if r["poll"] is not None)
                                                       / max(1, sum(r["poll"] is not None for r in rs)), 2) if ch == "Senate" else ""})
    write_csv(RESULTS / "backtest_national_error.csv", national, list(national[0].keys()))

    fields = ["chamber", "cycle", "key", "pred", "x_run", "x_open", "rating", "raters", "poll", "polls", "ind", "actual",
              "sign", "p_d_v2"] + [f"{p}_{v}" for v in VARIANTS for p in ("m", "p")]
    write_csv(RESULTS / "backtest_races.csv",
              [{k: round(v, 4) if isinstance(v, float) else v for k, v in r.items()} for r in races], fields)

    # Full-sample fit (2010-2022): the parameters carried into 2026.
    variant = CORRECTED if d_correction else FINAL
    correction = sum(gb_error.values()) / len(gb_error)
    for r in races:
        r["gb_correction"] = correction
    params = fit(races, VARIANTS[variant], {(ch, ind, pol) for ch in ("House", "Senate") for ind in (False, True)
                                            for pol in (False, True) if not (ch == "House" and pol)})
    return {"races": races, "scores": rows, "calibration": calib, "params": params, "variant": variant,
            "spec": VARIANTS[variant], "gb_correction": correction,
            "national_sd": rms([n["mean_error_" + FINAL] for n in national])}


def report(bt: dict) -> None:
    races = bt["races"]
    print(f"ensemble backtest: {sum(r['chamber'] == 'House' for r in races)} House and "
          f"{sum(r['chamber'] == 'Senate' for r in races)} Senate races, {CYCLES[0]}-{CYCLES[-1]}, leave-one-cycle-out")
    for row in bt["scores"]:
        if row["scope"] in ("House", "Senate", "Senate, polled", "House midterms", "Senate midterms"):
            print(f"  {row['scope']:16} {row['variant']:29} log loss {row['log_loss']:.4f}  Brier {row['brier']:.4f}  "
                  f"wrong calls {row['wrong_calls']:3} of {row['races']}")
    print(f"  shared national error (RMS of chamber-cycle mean residuals): {bt['national_sd']:.2f} pts;  "
          f"generic-ballot miss, 2010-2022 mean: {bt['gb_correction']:+.2f} pts;  2026 variant: {bt['variant']}")
