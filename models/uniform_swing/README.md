# Uniform swing (Baseline v2)

> **Data note.** The committed outputs use the Oct 30 generic ballot (D+8.9, swing D+10.5) and Kalshi snapshot: House D 231 / R 204, Senate 15 D, 222 underdog picks, 74.3 expected points if Kalshi is right. Figures written below come from the Oct 21 snapshots. The submission model is now [`ensemble`](../ensemble/), which uses this model as its fundamentals input.

The 2024 presidential vote on the 2026 district map, shifted by one national swing from the generic ballot, plus incumbency, with Student-t win probabilities ([v2](#baseline-v2-student-t--incumbency)). [`model.py`](model.py) writes [`predictions.csv`](predictions.csv) and the diagnostics in [`results/`](results/). [`backtest.py`](backtest.py) replays the same recipe on the 2010–2024 House. The shared [`decide.py`](../../decide.py) turns the predictions into [`results/model_vs_kalshi.csv`](results/model_vs_kalshi.csv) and the CSVs in [`submission/`](submission/).

```bash
python3 forecast.py --model uniform_swing            # from the repo root
python3 forecast.py --model uniform_swing --swing 0  # Baseline v0: pure 2024 replay
```

## Baseline v0: 2024 replayed on the 2026 map

**Method.** Each House race is predicted from the 2024 presidential margin (Harris − Trump) inside its **2026** boundaries. The Downballot recomputed these for the 10 states that redrew: AL, CA, FL, LA, MO, NC, OH, TN, TX and UT. Their sheet keeps Missouri on its 2022 lines. Each Senate race uses the state's 2024 presidential margin. Win probability is Φ(margin / σ), where σ = 7.24 points: the root-mean-square change in district presidential margin from 2020 to 2024 on identical lines. There is no fitting and no randomness.

**What redistricting changes** (Trump-won seats, 2024 vote, old lines → 2026 lines):

| State | Seats | Districts redrawn | Trump seats old → new | Net R |
|---|---|---|---|---|
| FL | 28 | 21 | 20 → 24 | +4 |
| TX | 38 | 37 | 27 → 30 | +3 |
| AL / LA / OH / TN | 7 / 6 / 15 / 9 | 4 / 6 / 14 / 8 | | +1 each |
| NC | 14 | 2 | 11 → 11 | 0 (NC-01 made redder) |
| UT | 4 | 4 | 4 → 3 | −1 |
| CA | 52 | 49 | 11 → 5 | −6 |
| **Total** | 435 | 145 | **230 → 234** | **+4 R** |

**The redistricting effect grows as the environment moves toward Democrats.** The new Republican maps pack seats that were marginal Trump seats into safer ones:

| Uniform swing to D | House D seats, 2024 lines | House D seats, 2026 lines | Cost to D |
|---|---|---|---|
| 0 (2024 replay) | 205 | 201 | −4 |
| +4 | 221 | 215 | −6 |
| +8 | 237 | 225 | −12 |

**Senate.** A straight 2024 replay gives Democrats 12 of the 35 races. GA, MI and NC go R because Trump carried them. Kalshi currently has Democrats favored in about 18. That gap is the national environment and candidate effects, which this baseline deliberately leaves out.

### Baseline v1: adding the national environment

**Method.** Every race's 2024 margin is shifted by one uniform national swing:

> swing = (mean of the published generic-ballot averages) − (2024 presidential national margin)

The generic-ballot averages come from Decision Desk HQ, FiftyPlusOne, NBC, RealClearPolitics and Silver Bulletin. Their values are read from [Wikipedia's aggregate table](https://en.wikipedia.org/wiki/2026_United_States_House_of_Representatives_elections#Generic_congressional_ballot_aggregate_polls) and pinned to a revision ID in [`results/national_environment.csv`](results/national_environment.csv). We compute the mean ourselves. The 2024 presidential national margin is summed from all 435 districts.

As of Oct 21, 2026, the generic ballot is **D+8.72** and the 2024 presidential margin was **D−1.65**, so the applied swing is **D+10.37**.

| | 2024 replay | With D+10.4 swing |
|---|---|---|
| House D seats (2026 lines) | 201 | **237** (expected value 246) |
| Seats that flip from the replay | | 36 (25 R-held, 11 D-held) |
| House races within 3 points | | 33 |
| Senate D wins of 35 | 12 | **15** (GA, MI, NC flip) |

Even at D+10, the closest Senate seats all stay narrowly R: OH −0.8, FL −2.7, AK −2.8, IA −2.9, TX −3.3. Kalshi currently has Democrats favored in OH, AK and TX. Those gaps are candidate effects that a uniform swing can't see, and they are the races where the decision rule will matter most.

**Known limits.** No candidates or incumbency. A uniform swing assumes every district moves the same amount, but midterm swings are larger in suburban and educated districts. The generic ballot still has 7% undecided, and a raw D−R margin treats undecideds as splitting evenly. σ comes from presidential-to-presidential shifts, so it misses House candidate effects. Comparing districts by number across maps is crude where districts were renumbered, so state-level totals are the reliable comparison.

### Model vs Kalshi, and the expected-points pick

**Kalshi ingest.** [`decide.py`](../../decide.py) snapshots every open 2026 House and Senate winner market from Kalshi's public API into `data/raw/kalshi/`. It maps each event to a race from the event *title*, because tickers can't be trusted: `SENATELA-26` is actually the Kentucky race.
- **Price:** the bid/ask midpoint when both sides are quoted, otherwise the last trade, normalised to sum to 1 within each race.
- **Coverage:** 461 of 470 races. The 9 missing ones are California top-two races, likely same-party, where the party pick is certain.

**Decision rule.** For each race we pick the candidate with the highest `P_model × −log₂(max(p_Kalshi, 1%))`. The model only knows "R vs not-R", so the not-R probability goes to the market's strongest non-Republican (e.g. Bodnar (I) in MT-SEN). There are two pairs of submission files: `submission/favorite_*.csv` picks the model favorite, and `submission/ev_*.csv` applies the rule.

**Expected score over the 461 races with markets** (snapshot of Oct 22, 2026):

| Strategy | Underdog picks | E[points], by our model | E[points], if Kalshi is right |
|---|---|---|---|
| Kalshi favorite | 0 | 41.9 | 44.1 |
| Model favorite | 19 | 60.8 | 47.0 |
| **Expected-points rule** | **180** | 109.4 | **71.4** |

**How to read this.** The rule wins even if Kalshi is perfectly calibrated, because the payout is asymmetric (see [Scoring](../../README.md#scoring-and-why-it-changes-the-strategy)). Only 16 of the 169 House underdog picks are races where our model actually favors the underdog. The rest are long-shot picks: the model gives the underdog more than the tiny break-even probability, e.g. 0.9% for a 3% Kalshi underdog.

**Caveats:**
- These long-shot picks depend entirely on how well calibrated our probabilities are in the tails. They are driven by σ = 7.24. The [backtest](#backtest-is-σ-calibrated-in-the-tails) shows the normal shape is wrong and that incumbency is what matters in the tails.
- Prediction markets usually *overprice* long shots.
- The outcomes are correlated, so they will hit or miss together.
- 180 underdog picks may look like "always pick the underdog" to the judges.

**Before this rule goes in a final submission:**
- Fix the tail calibration. The [backtest](#backtest-is-σ-calibrated-in-the-tails) says to use a Student-t plus incumbency.
- Decide how much variance we want.

**Biggest disagreements with the market.** These are almost all candidate effects that a uniform swing misses:
- **Senate:** ME (Collins), OH (Brown), TX (Talarico vs. Paxton) and AK.
- **House:** PA-01 (Fitzpatrick), NY-17 (Lawler), TX-15/28/34 (South Texas Latino shift) and NY-01.

Outputs:
- [`results/model_vs_kalshi.csv`](results/model_vs_kalshi.csv): per race, model vs market, pick, points if right, expected value
- [`results/strategy_summary.csv`](results/strategy_summary.csv)
- [`results/national_environment.csv`](results/national_environment.csv)
- [`results/house_2024_on_2026_map.csv`](results/house_2024_on_2026_map.csv)
- [`results/redistricting_by_state.csv`](results/redistricting_by_state.csv)
- [`results/seats_by_national_swing.csv`](results/seats_by_national_swing.csv)
- [`results/senate_2024_baseline.csv`](results/senate_2024_baseline.csv)
- [`predictions.csv`](predictions.csv): the model's output in the shared format, which `decide.py` reads
- [`submission/`](submission/): `favorite_*.csv` and `ev_*.csv` in the official template format

Data: [The Downballot's presidential results by congressional district](https://www.the-downballot.com/p/the-downballots-calculations-of-presidential), for both the 2026 lines and the 2024 lines.

> The tables above describe v1. The current model is v2, below.

## Baseline v2: Student-t + incumbency

**Method.** v2 adds incumbency to the v1 margin and replaces the normal curve with a Student-t, as the [backtest](#backtest-is-σ-calibrated-in-the-tails) recommended:

> margin = 2024 margin on the 2026 lines + swing + **5.1** × (incumbent running: +1 D / −1 R) + **1.3** × (open seat: +1 if a Democrat held it / −1 if a Republican did)
>
> P(D) = Student-t CDF(margin / **5.56**, df **3**)

The four bold numbers are fit by maximum likelihood on all 2,655 contested House races from 2010 to 2022.

**Why two incumbency terms, not one.** Herui's single +4.4-point bonus followed 538's `incumbent_party`, which marks the party that *holds* the seat, so open seats count too. In 2026 many members are retiring, so the effect is split in two:
- **Incumbent running:** a sitting member is on the ballot. In the backtest, these are derived from 538's politician IDs: the previous cycle's winners, plus special-election winners, who appear on this cycle's ballot. This survives redistricting renumbering.
- **Open seat:** no sitting member is running, so the party that held the seat gets the smaller open-seat term instead.

An incumbent running is worth about 4× an open seat held by the same party.

**2026 incumbents** come from Wikipedia's [2026 House](https://en.wikipedia.org/wiki/2026_United_States_House_of_Representatives_elections) and [2026 Senate](https://en.wikipedia.org/wiki/2026_United_States_Senate_elections) tables, cached with the revision ID in `data/raw/wikipedia/`. A member counts as running when the status reads "Incumbent renominated", "advanced to general" or "appointee nominated". Statuses mentioning retiring, losing, resigning or withdrawing don't count.
- **House:** 351 incumbents are running and 69 seats are open. 14 are new or vacant seats with no incumbency term. 7 districts list two members because of redistricting pairings.
- **Senate:** all 35 races parsed.

**Backtest, out-of-sample (LOCO):**

| Variant | Log loss | Brier | Midterms log loss |
|---|---|---|---|
| v1: normal, σ = 7.24 | 0.197 | 0.0498 | 0.214 |
| Student-t + one incumbency term (+4.4) | 0.149 | 0.0413 | 0.165 |
| **v2: Student-t + incumbent running / open seat** | **0.139** | **0.0382** | **0.154** |

v2 is calibrated in every bin. Upsets, expected → observed, 2010–2022:

| Model's P(predicted loser wins) | Races | Expected | Observed |
|---|---|---|---|
| < 0.25% | 657 | 0.8 | 1 |
| 0.25–1% | 706 | 3.8 | 7 |
| 1–3% | 505 | 9.1 | 9 |
| 3–10% | 417 | 24.2 | 24 |
| 10–25% | 214 | 34.3 | 33 |
| 25–50% | 156 | 57.0 | 57 |

**2026 result** (generic ballot D+8.72, swing D+10.37, Kalshi snapshot of Oct 22):
- **House:** D 230 / R 205, with 234.7 expected D seats (v1: 237). 17 calls change from v1, all because of incumbents:
  - **Incumbents now favored to hold:** Cuellar TX-28, Castor FL-14, Kaptur OH-09, Davis NC-01, Figures AL-02, Van Orden WI-03, LaLota NY-01, Miller-Meeks IA-01, Bresnahan PA-08, Wagner MO-02, Turner OH-10 and others.
  - **Open R-held seats that tip D:** IA-02 and NC-11.
- **Senate:** 15 of 35 D, no call changes. Incumbents running widen the R margins in OH (Husted −6.0), AK (Sullivan −7.9) and FL (Moody −7.8). Collins's Maine falls from D+17 to D+12.

**Expected score over the 461 races with markets:**

| Strategy | Underdog picks | E[points], by our model | E[points], if Kalshi is right |
|---|---|---|---|
| Kalshi favorite | 0 | 44.1 | 44.1 |
| Model favorite | 16 | 63.5 | 46.5 |
| Expected-points rule | 222 | 88.4 | 73.4 |

**Caveats before trusting the `ev_*` picks:**
- **The Senate tail is not validated.** The House-fitted t (df 3) still gives a 25-point Senate race about a 1% upset chance. That's above the break-even for a 98–99% Kalshi favorite, so the rule picks underdogs in 20 of 35 Senate races, including CO, DE, OR, RI and WY. Statewide races probably have thinner tails than districts, so a Senate backtest has to come before these picks are used.
- **Safe-seat long shots barely matter in expectation.** In a 97%+ seat, the favorite and the underdog are both worth about 0.03–0.05 expected points. The long-shot picks add variance, not much expected value.
- **The Kalshi snapshot is from Oct 22.** Refresh it with `--refresh` before the Nov 1 pull, which also refreshes the generic ballot and incumbents.

## Backtest: is σ calibrated in the tails?

**Method.** The v1 recipe is replayed on every House cycle from 2010 to 2022. Each one uses only information available before that Election Day:

> predicted margin = previous presidential margin on *that cycle's* district lines + (538's final generic-ballot average − previous presidential national margin)

The prediction is scored against the actual winner. Every fitted parameter is refit **leave-one-cycle-out (LOCO)**, so each cycle is scored by a model that never saw it.
- **What's scored:** 2,655 contested D-vs-R races. One-party seats (unopposed, or same-party top-two) are counted but not scored, because 2026 can treat those as locked.
- **2024:** there's no archived generic-ballot average, so 2024 appears only in the "actual national vote" check.
- **Missing states:** The Downballot never computed 2008 on California's 2012 lines or 2012 on Florida's 2016 lines, so CA is skipped in 2012 and FL in 2016.

**The normal curve has the wrong shape, not the wrong σ.** It is too thin in the far tail and too wide in the 10–50% range. Refitting σ (maximum likelihood gives 9.3) barely helps. A Student-t with 2–3 degrees of freedom is calibrated in every bin:

Upsets, expected → observed, 2010–2022:

| Model's P(predicted loser wins) | v1 normal, σ = 7.24 | Student-t (LOCO) |
|---|---|---|
| < 0.25% | 1,371 races: 0.3 → **11** | 201 races: 0.3 → 1 |
| 0.25–1% | 217 races: 1.2 → **7** | 721 races: 4.2 → 5 |
| 1–3% | 206 races: 3.9 → 6 | 705 races: 12.6 → 14 |
| 3–10% | 285 races: 17.0 → 15 | 538 races: 30.4 → 31 |
| 10–25% | 286 races: 48.7 → **34** | 286 races: 47.5 → 44 |
| 25–50% | 290 races: 106.7 → **96** | 204 races: 74.4 → 74 |

**Scores, all out-of-sample** (log loss and Brier, lower is better):

| Variant | Fitted (2010–2022) | Log loss | Brier | Midterms log loss |
|---|---|---|---|---|
| v1: normal | σ = 7.24 (not fitted) | 0.197 | 0.0498 | 0.214 |
| Normal, refit | σ = 9.3 | 0.196 | 0.0515 | 0.211 |
| Student-t, refit | df 2, scale 4.2 | 0.177 | 0.0493 | 0.186 |
| Student-t + incumbency, refit | +4.4 pts to the incumbent's party, df 3, scale 5.8 | 0.149 | 0.0413 | 0.165 |
| **Student-t + incumbent running / open seat (v2)** | **+5.1 running, +1.3 open**, df 3, scale 5.56 | **0.139** | **0.0382** | **0.154** |

**Where the fat tail comes from: crossover incumbents.** These are members holding seats that lean to the other party. Two groups account for almost all of the deep-tail upsets: Blue Dog Democrats who survived 2010 in McCain seats (Ross, Boren, Matheson, Rahall, Chandler) and Peterson in 2018. The 2020 South Florida shift (FL-26, FL-27) adds two more. Among races the lean-only t model calls safe (upset chance under 3%):

| Who held the seat | Upset rate |
|---|---|
| The favored party | 3 / 1,779 = **0.17%** |
| A crossover incumbent | 16 / 109 = **15%** |
| Open seat | 1 / 22 |

**What this means for the expected-points pick:**
1. **The current long-shot picks overrate underdogs where the favored party already holds the seat.** 135 of the 169 House underdog picks are long shots in seats held by the Kalshi favorite's party (per The Downballot's incumbent column, which doesn't yet mark retirements). In that kind of seat, v1 overstated upsets by 2–3× in every bin: its 25–50% races flipped 14% of the time, and its 10–25% races 6%. Repricing each pick at the backtest's observed rates makes the favorite the better pick in 61 of the 135. The remaining long shots still edge out the favorites in total (19.7 vs 16.9 expected points), because the payout is asymmetric.
2. **Switching to a lean-only t would make things worse.** Its fat tail gives *every* safe seat an upset chance of about 1–2%. That's above the break-even for a 97% Kalshi favorite (0.86%), so it would recommend even more long shots. The tail belongs to crossover incumbents, so incumbency has to come in before the t does.
3. **National polls have leaned toward Democrats.** The final generic ballot missed the actual House vote by 2.6 points RMS, and it overstated Democrats in 5 of 7 cycles (2.0 points on average). Applied to 2026's D+8.7, that is a real correlated risk. Every race's margin moves together, so the planned simulation should draw one shared national error per run.

Outputs:
- [`results/backtest_cycles.csv`](results/backtest_cycles.csv): per cycle, the generic-ballot miss, the swing, the fitted parameters and the scores of each variant
- [`results/backtest_calibration.csv`](results/backtest_calibration.csv): expected vs observed upsets per bin, with 95% Wilson intervals, for all cycles and for midterms only
- [`results/backtest_house_races.csv`](results/backtest_house_races.csv): every seat-cycle, with lean, prediction, result and each variant's P(D)

Data:
- House results, incumbent party and national House vote: [538's `election-results` archive](https://github.com/fivethirtyeight/election-results).
- Final generic-ballot averages: [538's `data` archive](https://github.com/fivethirtyeight/data). Both archives are pinned to commits.
- District lean: The Downballot's historical sheets, on the lines used in each cycle.
