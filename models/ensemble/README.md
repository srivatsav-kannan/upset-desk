# Ensemble (ratings + polls + fundamentals + news)

**The model we submit.** It combines four kinds of evidence for every race:
- **Fundamentals:** the 2024 vote on the 2026 lines, the national swing and incumbency, from [`uniform_swing`](../uniform_swing/).
- **Expert ratings:** up to 11 published ratings per race.
- **Senate polls.**
- **News layer:** researched candidate-quality and late-news scores.

The first three are combined by a regression fit on every House and Senate race from 2010 to 2022. Each piece is kept only if it improves the leave-one-cycle-out backtest. That test is why a flat "Democrats are overstated" correction is **not** applied (see [The Democrat correction](#the-democrat-correction-tested-not-applied)).

| Out-of-sample, 2010–2022 | Log loss | Brier | Wrong calls |
|---|---|---|---|
| House, `uniform_swing` v2 | 0.139 | 0.038 | 131 of 2,655 |
| **House, ensemble** | **0.080** | **0.024** | **92 of 2,655** |
| Senate, fundamentals only | 0.229 | 0.068 | 20 of 242 |
| **Senate, ensemble** | **0.126** | **0.043** | **18 of 242** |

Run it with `python3 forecast.py --model ensemble`. That also reruns `uniform_swing` first, because the ensemble reads its outputs.

## Method

For each race, four inputs:

| Input | 2026 source | Backtest source (2010–2022) |
|---|---|---|
| **Fundamentals:** previous presidential margin in the seat + generic-ballot swing, and incumbency (incumbent running ±1, open seat held by ±1) | [`uniform_swing`](../uniform_swing/) results (Downballot, Wikipedia incumbents) | Same recipe: `uniform_swing`'s House backtest; for the Senate, 538's statewide presidential results and generic-ballot averages, with incumbents read from the ratings tables |
| **Expert ratings:** mean of every rater, Safe R = −3 … Toss-up = 0 … Safe D = +3 | Wikipedia's 2026 House ratings page (143 seats, 10 raters) and Senate predictions table (35 races, 11 raters: Cook, Inside Elections, Sabato, The Economist, Split Ticket, DDHQ, FiftyPlusOne, Fox, Silver Bulletin, RCP, NBC) | The same Wikipedia tables for every cycle |
| **Senate polls:** each pollster's latest poll from the last 28 days (likely voters where there's a choice), weighted by recency (half-life 14 days), √sample size (capped at 2,000) and half weight for partisan sponsors | Wikipedia race pages (155 polls in the window) | 538's archive of final-weeks polls (`raw_polls.csv`), keeping only polls of the deciding matchup (see [Backtest](#backtest)) |
| **News layer:** candidate quality and late news | Researched for 105 competitive races ([protocol](news_protocol.md)), frozen in [`data/raw/llm_news/`](../../data/raw/llm_news/) | Not backtestable (see below) |

**Stack.** A least-squares regression of the actual margin on the inputs gives a projected margin. Each pattern has its own coefficients:
- House;
- Senate with polls;
- Senate without polls;
- independent races.

Races where the main challenger is an independent (NE, MT, SD and ID for the Senate; AK-AL) drop the fundamentals terms, because a Trump-margin lean says little about an Osborn-style candidate. A Student-t fit by likelihood on the same races turns the margin into a win probability. The fit picks the tail: df 30 for the House, and normal tails for every Senate pattern. All weights are in [`results/parameters.csv`](results/parameters.csv). House races are dominated by the ratings: each rating step is worth about 6 points of margin, against 0.39 for each point of lean.

**Unrated seats.** Raters only list competitive seats, so an unlisted seat counts as Safe for its favorite. That is the incumbent running, but only within 10 points of hostile lean. Every unrated crossover incumbent of 2010–2022 sat within 6.5 points. On the 2026 mid-decade maps, some incumbents run in seats 20 or more points the other way (CA-01), and raters leave those unlisted because they're safe *for the other party*.

**News layer.**
- **Scores.** Each researched race has `quality_edge` and `news_edge` scores from −2 to +2. They are centred on their mean across all researched races, then converted to points: 0.5 × (1.5 × quality + 1.0 × news).
- **Why centre them.** The raw scores leaned Democratic (mean quality +0.29). Centring means the layer can only move races relative to each other. It can't shift the national environment, which is the generic ballot's job.
- **Size.** Adjustments range from −1.0 to +1.8 points. The layer changes two calls: KS-SEN moves to Hamilton (D), 61%, and TX-35 tips to R, 51%.
- **Kept for comparison.** The probabilities before the layer are kept in `results/race_components.csv` (`p_d_stack`).

**Simulation.** 20,000 elections are simulated with seed 2026. Each one draws a single national error shared by every race (sd 2.20 points, the RMS of the backtest's chamber-cycle mean residuals), plus a separate error for each race. It produces seat distributions only: `predictions.csv` keeps the exact calibrated probabilities.

## Backtest

Every parameter is refit without the held-out cycle. [`results/backtest_scores.csv`](results/backtest_scores.csv) has every variant by chamber, by cycle and for midterms; the test suite checks that scrambling a held-out cycle's results doesn't change its forecasts.

| Variant | House | House midterms | Senate | Senate midterms |
|---|---|---|---|---|
| Fundamentals only | 0.140 | 0.160 | 0.229 | 0.245 |
| + ratings | **0.080** | **0.085** | 0.137 | 0.133 |
| + ratings + polls (**chosen**) | **0.080** | **0.085** | **0.126** | **0.121** |
| + generic-ballot D correction | 0.082 | 0.088 | 0.127 | 0.122 |
| + intercept (flat D correction) | 0.083 | 0.089 | 0.129 | 0.122 |
| + rating curve (rating³) | 0.090 | 0.099 | 0.129 | 0.126 |

*Log loss, lower is better. House = 2,655 contested races, Senate = 242.*

- **Expert ratings are the big win.** They cut log loss by 42% in the House and 40% in the Senate. Ratings carry what fundamentals can't see: candidate quality, money, scandals and local polls.
- **Senate polls help on top of ratings:** 0.137 → 0.126 overall and 0.133 → 0.121 in midterms. Raters read the same polls, so the gain is modest.
- **Polls must be of the deciding matchup.** 538's archive polled the Democrat, not the winning independent, in Maine 2012 and 2018 (Dill and Ringelstein, not King), Florida 2010 and Alaska 2016. It polled McAdams (D) against Miller in Alaska 2010, which Murkowski (R) won as a write-in; 538 lists her ballot party as `W`, so [`data/overrides/senate_candidate_party.csv`](../../data/overrides/senate_candidate_party.csv) records her as a Republican. A poll now counts only if its two candidates are the race's strongest non-Republican and strongest Republican (by 538 candidate id). Before this fix, those races alone made up about a quarter of the Senate's log loss. They made polls look slightly harmful (0.180 against 0.178 without them) and pushed the Senate tail to a Student-t with df 4.
- **Calibration.** In every probability bin the observed upset rate falls inside the 95% interval ([`results/backtest_calibration.csv`](results/backtest_calibration.csv)). For example, House races given a 3–10% upset chance had 10 upsets against 8.0 expected.

### The Democrat correction: tested, not applied

In 5 of 7 cycles the final generic ballot overstated Democrats, by 2.0 points on average (actual House vote minus the final 538 average). Three ways of correcting for it were tested out of sample:
1. Shift the swing by the leave-one-out mean miss.
2. Fit a free intercept.
3. The first with a rating curve.

**All three made every score worse.** Once ratings are in, the per-cycle errors show no consistent Democratic overstatement ([`results/backtest_national_error.csv`](results/backtest_national_error.csv): House mean −0.6, Senate −0.5, with signs flipping from cycle to cycle). In midterms the generic ballot's average miss was only −1.3. The bias in the Senate polls also flips sign (from −3.7 to +5.8 by cycle).

So the risk lives in the **variance**, as the shared national error, not in a shifted mean. Two options remain:
- **Stress-test scenario.** The simulation reports what happens if Democrats are overstated by the historical average (below).
- **Flag.** `--ensemble-d-correction` applies the generic-ballot correction to the forecast if we decide to anyway.

### Blending in the deterministic baseline: tested, not applied

The obvious next move is to average the stack's probability with a plain deterministic model: `uniform_swing` v2 for the House, the fundamentals-only fit for the Senate (v2 has no Senate backtest). [`results/backtest_blend.csv`](results/backtest_blend.csv) scores that average out of sample at several weights:

| Weight on the baseline | 0 (chosen) | 0.1 | 0.2 | 0.3 | 0.5 | 1 |
|---|---|---|---|---|---|---|
| House log loss | **0.080** | 0.083 | 0.086 | 0.089 | 0.098 | 0.139 |
| Senate log loss | **0.126** | 0.131 | 0.136 | 0.142 | 0.157 | 0.229 |

**Every weight is worse.** The stack already has the fundamentals as an input, and its regression picked their weight out of sample. Averaging them in again counts them twice. On the Nov 1 prices, a 20% blend would flip 29 House picks. Almost all of those flips come from v2's wider tails, which make underdogs look likelier than the backtest supports. They don't reflect real information about those races.

## 2026 forecast

Data snapshot: Wikipedia ratings and polls and the generic ballot (mean of 5 aggregators: D+8.9), retrieved 2026-10-30. Kalshi retrieved 2026-11-01, 7:10pm PT.

| | Central | If the generic ballot overstates D by 2.0 |
|---|---|---|
| House, D seats (median, 90% range) | **235** (226–244) | 231 (222–240) |
| P(D House majority) | 99.9% | 99.1% |
| Senate, non-R seats incl. holdovers | **52** (49–55) | 51 (48–54) |
| P(non-R Senate majority, 51+) | 77% | 50% |

*Senate seats count independents (Osborn, Bodnar, Bengs, King, Sanders) as non-R; whether they caucus with Democrats is not modelled.*

**Senate.**
- **Closest:** AK (D 39%), IA (D 39%), KS (D 61%).
- **Leaning D:** TX (Talarico 76%), OH (Brown 65%), ME (D 86%).
- **NE-SEN:** Osborn (I) 24%.

**House.** Democrats are favoured in 235 seats. The closest are FL-22, ME-02, MT-01, TX-15, TX-35, VA-01 and WI-01. 12 calls differ from `uniform_swing` v2, nearly all because the ratings disagree with lean plus incumbency (e.g. IA-01, PA-08, WI-03 to D; AL-02 to R).

**Against Kalshi (Nov 1 snapshot):**

| Strategy | Underdog picks | E[points], by our model | E[points], if Kalshi is right |
|---|---|---|---|
| Kalshi favorite everywhere | 0 | 48.8 | 43.2 |
| Our favorite | 5 | 53.4 | 43.8 |
| **Expected-points rule** | **33** | **59.4** | **48.7** |

The ensemble agrees with the market far more than v2 did. v2 made 222 underdog picks, 20 of them Senate long shots resting on a House-fitted tail. The ensemble makes 33, 5 of them in the Senate (AK, KS, OH and TX for R; NE for Osborn). Its Senate tail is fit on the Senate, and it is thin: the long shots the rule picked under the df-4 tail (CO, GA, NC, NH and VA for R) now have model probabilities below 1%, under their Kalshi prices.

Its biggest bets against the market:
- **TX-15:** De La Cruz (R), 56% for us against 11% on Kalshi. ([`house_polls`](../house_polls/) brings this down to 25% with the district polls.)
- **AK-SEN:** R, 61% vs 29%.
- **TX-23:** Herrera (R), 80% vs 50%.
- **TX-35:** R, 51% vs 25%.
- **FL-22:** R, 47% vs 28%.

Submission files are in [`submission/`](submission/):
- `ev_*.csv` uses the expected-points rule.
- `favorite_*.csv` picks our most likely winner.

## Files

| File | What it is |
|---|---|
| `predictions.csv` | 470 races, shared format |
| `results/race_components.csv` | Every input, the stacked margin, the news adjustment and the final probability per race, with v2's for comparison |
| `results/race_explain.csv` | The same, in words, for the map's tooltip |
| `results/senate_polls_2026.csv` | Every poll used, with its date, sample and margin |
| `results/parameters.csv` | Fitted weights and Student-t parameters per pattern (`normal` = normal tails) |
| `results/backtest_*.csv` | Scores, calibration, per-cycle national error, per-race out-of-sample forecasts, the baseline-blend test |
| `results/simulation_summary.csv`, `results/seat_distribution.csv` | Seat distributions, central and stress-test scenarios |
| `news_protocol.md` | The exact brief the news researchers followed, and how the scores are used |

## Limits

- **The news layer is not backtested.** A language model asked about 2018 already knows who won, so there is no honest historical test. It's kept small (at most a few points, centred), and the pre-news probabilities are published alongside. Each row has sources and a confidence level. Several rows were researched after the shared web-search budget ran out and are marked low confidence (FL-07, FL-09, WA, WI).
- **Wikipedia is the source** for ratings, polls and incumbents. The backtest shows the historical tables are usable, but a 2026 table edited minutes before a snapshot could hold an error. Raw snapshots are dated and kept.
- **No House district polls.** The ratings carry most of that signal.
- **Specials, runoffs and ranked-choice:** GA's 2020 races are scored on the deciding contest (the runoff) with November ratings and polls. Alaska and Maine use the final round.
- **The simulation's local errors are approximate** (shrunk so national + local roughly matches each race's calibrated spread). Per-race probabilities come from the exact Student-t, not the simulation.
- **Independents** are modelled as "the strongest non-Republican". Whom they would caucus with is outside the model.
