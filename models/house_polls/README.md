# House polls (ensemble + district polls)

The [`ensemble`](../ensemble/) with one more input: **House district polls**. The ensemble forecasts House races from fundamentals, incumbency and expert ratings only. This model adds each district's recent general-election polls wherever there are any, and is otherwise the ensemble, race for race. It also writes simulated elections, so [`decide.py`](../../decide.py) can pick by the spread of the score, not just its mean.

| Out-of-sample, 2010–2022 | Log loss | Brier | Wrong calls |
|---|---|---|---|
| House, `ensemble` | 0.0804 | 0.0244 | 92 of 2,655 |
| **House, `house_polls`** | **0.0769** | **0.0233** | **88 of 2,655** |
| House races with polls, `ensemble` | 0.295 | 0.090 | 63 of 506 |
| **House races with polls, `house_polls`** | **0.276** | **0.084** | **59 of 506** |

Senate scores are unchanged (0.126): Senate races are the ensemble's.

Run it with `python3 forecast.py --model house_polls`. That reruns `uniform_swing` and `ensemble` first, because this model reads the ensemble's outputs.

## Method

**Polls.** For every House race, the polls are each pollster's latest general-election poll from the last 28 days. They are weighted exactly as the ensemble weights Senate polls: recency (half-life 14 days), √sample size (capped at 2,000) and half weight for partisan sponsors.
- **2026:** Wikipedia's state House pages, one section per district, for every state with at least one rated seat (35 states; California's two sub-pages included). 57 districts have polls in the window. Every page must have a section for each of the state's districts, or the run fails.
- **Backtest:** 538's archive (`raw_polls.csv`). A poll counts only if it is of the deciding matchup: its candidates must be the seat's strongest Democrat and strongest Republican, matched by 538 candidate id (the same rule as the ensemble's Senate polls).

**Stack.** The ensemble's regression gives each pattern (chamber, independent, has polls) its own weights. A House race with polls gets the "House with polls" weights, fit on the 506 House races of 2010–2022 that had polls. Every other race keeps the ensemble's pattern, so its weights, and its forecast, are the ensemble's; the run checks this for every House race. The ensemble's news adjustment is added on top, as in the ensemble.

| Weights, polled House races | Fundamentals margin | Incumbent running | Open seat | Rating mean | Poll average | Student-t |
|---|---|---|---|---|---|---|
| Without polls (the ensemble's) | 0.39 | 0.81 | −0.17 | 5.97 | | df 30, scale 6.8 |
| With polls | 0.22 | −0.09 | 0.91 | 3.69 | 0.35 | df 3, scale 3.5 |

Where there are polls, they take weight from the ratings (about 3.7 points of margin per rating step instead of 6.0), and the forecast gets tighter.

## Backtest

Every parameter, including the sponsor lean below, is refit without the held-out cycle. [`results/backtest_scores.csv`](results/backtest_scores.csv) has every variant by scope and cycle.

| Variant (log loss) | House | House midterms | Polled House races | Polled midterms |
|---|---|---|---|---|
| Ensemble (no House polls) | 0.0804 | 0.0845 | 0.295 | 0.280 |
| **+ House polls (chosen)** | **0.0769** | **0.0789** | **0.276** | **0.255** |
| + House polls, sponsor-corrected | 0.0777 | 0.0803 | 0.281 | 0.261 |
| + House polls, sponsor-corrected, full weight | 0.0772 | 0.0796 | 0.278 | 0.258 |

- **Polls help in 5 of 7 cycles** (on polled races; 2012 and 2022 are worse) and in every scope above.
- **Calibration:** in every probability bin of the polled races, the observed upset rate falls inside the 95% interval ([`results/backtest_calibration.csv`](results/backtest_calibration.csv)).

### Partisan polls: the lean is real, but correcting it is worse

Measured against nonpartisan polls of the same cycle, Democratic-sponsored House polls lean 5.4 points toward the Democrat and Republican-sponsored ones 5.4 points toward the Republican. The lean has the same sign and size in every leave-one-out fold ([`results/sponsor_lean.csv`](results/sponsor_lean.csv)).

Subtracting it from each side's polls made the out-of-sample scores **worse**, both at half weight and at full weight (table above). It helped in 2010, 2014, 2016 and 2020 and hurt in 2012, 2018 and 2022. The half weight and the regression's poll weight (0.35, well below 1) already absorb most of the lean. So, like the ensemble's Democrat correction, it is reported and not applied (`FINAL` in [`backtest.py`](backtest.py)).

## Pick strategies against simulated elections

The expected-points rule maximises the **mean** score, but its underdog picks are correlated: they share one national environment. So this model also writes 4,000 seeded simulated elections ([`results/simulated_outcomes.csv`](results/simulated_outcomes.csv): each race's winner in each one). Every election draws one national error shared by every race (sd 2.22 points, the backtest's chamber-cycle RMS) plus a local error per race. The simulated win rates match `p_d` (a test checks).

[`decide.py`](../../decide.py), the only code that sees the market, scores a family of strategies in every simulated election: the expected-points rule keeping an underdog only when its expected points beat the favorite's by at least 0%, 10%, 25%, 50%, 100% or 200%, plus Kalshi's favorite and our favorite everywhere. [`results/portfolio_summary.csv`](results/portfolio_summary.csv) has each strategy's mean, spread and chance of beating a rival entry. Oct 30 Kalshi snapshot:

| Full Congress (461 races with a market) | Underdogs | Mean | 10th–90th percentile | P(beat rival) |
|---|---|---|---|---|
| Kalshi favorite everywhere | 0 | 51.1 | 48.5–53.5 | 0 |
| Our favorite | 5 | 53.5 | 50.1–56.7 | 0.06 |
| Expected points (edge ≥ 0%) | 36 | 58.2 | 47.7–70.3 | 0.53 |
| **Expected points, edge ≥ 25% (chosen)** | **24** | **58.3** | **48.8–68.2** | **0.55** |
| Expected points, edge ≥ 100% | 13 | 56.6 | 50.0–63.6 | 0.49 |

*The rival picks every Kalshi favorite and scores 5 points more in the same election (1 point on the Senate track): a stand-in for the best of a field that mostly picks favorites.*

- **Dropping the thinnest 12 underdog picks costs almost nothing in mean** (58.3 vs 58.2) and narrows the downside, so it raises the chance of beating the rival.
- **The choice depends on the rival you assume** (`RIVAL_LEAD` in `decide.py`). To beat an all-favorites entry by any margin, our favorite everywhere is best (88%). For a rival 2.5–5 points ahead, edge ≥ 25%. For a rival 10–15 points ahead, edge ≥ 10% (more upsets).
- **Senate track:** edge ≥ 25% too (2 underdogs, AK-SEN and OH-SEN for R; P(beat rival) 0.70 against 0.36 for the plain rule).

`submission/portfolio_*.csv` holds the chosen strategy's picks; `ev_*.csv` and `favorite_*.csv` are written as for every model.

## 2026 changes from the ensemble

57 House races have polls; 2 calls change: **TX-15** to Pulido (D), 75% (the ensemble had 44%), and **ME-02** to D, 59% (was 40%). The polls mostly move races toward the Democrat, and so toward the market: much of the ensemble's Republican lean against Kalshi in close House races came from not seeing district polls. Largest moves: TX-15, MI-10 (D 75% → 50%), MT-01 (55% → 75%), ME-02, OH-07 (66% → 85%), PA-08 (76% → 88%). Every change is in [`results/race_changes.csv`](results/race_changes.csv), every poll in [`results/house_polls_2026.csv`](results/house_polls_2026.csv).

## Files

| File | What it is |
|---|---|
| `predictions.csv` | 470 races, shared format |
| `results/race_changes.csv` | Each polled House race: poll average, ensemble and new probability, whether the call changed |
| `results/house_polls_2026.csv` | Every 2026 district poll used, with its sponsor |
| `results/race_explain.csv` | The ensemble's tooltip lines, with district polls filled in |
| `results/parameters.csv` | Fitted weights and Student-t parameters per pattern |
| `results/backtest_*.csv`, `results/sponsor_lean.csv` | Scores, calibration, per-race forecasts of polled races, sponsor lean per fold |
| `results/simulated_outcomes.csv` | Each race's winner in each of 4,000 simulated elections |
| `results/portfolio_summary.csv` | Pick strategies scored against them (written by `decide.py`) |

## Limits

- **Few polls per race.** Most polled 2026 districts have one or two polls in the window, many of them partisan. TX-15's move rests on one poll (Texas Southern University, D+7).
- **Only states with a rated seat are read.** Polls of a seat no rater lists are rare, but would be missed.
- **Wikipedia is the 2026 source**, as for the ensemble's ratings and Senate polls. Snapshots are dated and kept in `data/raw/wikipedia/house_state_2026_*`.
- **The portfolio's rival is an assumption.** Nobody knows the field; the table above shows how the choice moves with it. Races without a Kalshi market are left out (they score the same for every strategy until the organizers say what *p* is for them).
- **It reuses the ensemble's code** (`models/ensemble/backtest.py`) for the stack, so a change there changes this model too; the run fails loudly if the ensemble's forecasts no longer come back for unpolled races.
