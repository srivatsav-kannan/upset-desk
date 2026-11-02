# Uniform swing (baseline)

The simplest model we trust: the 2024 presidential vote on the 2026 district map, shifted by one national swing from the generic ballot, plus incumbency, with Student-t win probabilities. It is the baseline the other models have to beat, and its projected margin is the "how the place votes" input to [`ensemble`](../ensemble/).

[`model.py`](model.py) writes [`predictions.csv`](predictions.csv) and the diagnostics in [`results/`](results/); [`backtest.py`](backtest.py) replays the same recipe on the 2010–2022 House.

```bash
python3 forecast.py --model uniform_swing            # from the repo root
python3 forecast.py --model uniform_swing --swing 0  # a pure 2024 replay, with no national swing
```

## Method

> margin = 2024 presidential margin on the 2026 lines + swing + **5.1** × (incumbent running: +1 D, −1 R) + **1.3** × (open seat: +1 if a Democrat held it, −1 if a Republican did)
>
> P(D) = Student-t CDF(margin / **5.56**, df **3**)

- **Swing:** the mean of five published generic-ballot averages (Decision Desk HQ, FiftyPlusOne, NBC, RealClearPolitics, Silver Bulletin), read from Wikipedia at a pinned revision, minus the 2024 presidential national margin. On October 30 that is D+8.9 against D−1.7, a swing of D+10.5.
- **Fitted values:** the four bold numbers are fit by maximum likelihood on all 2,655 contested House races from 2010 to 2022.
- **Incumbency comes in two parts** because many members are retiring in 2026. A sitting member on the ballot is worth about four times an open seat held by the same party. In the backtest, incumbents running are traced through 538's politician IDs, which survives redistricting renumbering. For 2026 they come from Wikipedia's House and Senate election tables: 351 House incumbents are running and 69 seats are open.
- **Senate** races use the state's 2024 presidential margin with the same swing and incumbency terms.

**2026 result:** Democrats favored in 231 House seats to 204, and in 15 of the 35 Senate races.

## What redistricting changes

The 2024 vote inside the old and new lines (The Downballot's calculations), counting seats Trump carried:

| State | Seats | Districts redrawn | Trump seats, old → new lines | Net R |
|---|---|---|---|---|
| FL | 28 | 21 | 20 → 24 | +4 |
| TX | 38 | 37 | 27 → 30 | +3 |
| AL / LA / OH / TN | 7 / 6 / 15 / 9 | 4 / 6 / 14 / 8 | | +1 each |
| NC | 14 | 2 | 11 → 11 | 0 (NC-01 made redder) |
| UT | 4 | 4 | 4 → 3 | −1 |
| CA | 52 | 49 | 11 → 5 | −6 |
| **Total** | 435 | 145 | **230 → 234** | **+4 R** |

The new maps cost Democrats more as the environment moves toward them, because they turn marginal Trump seats into safer ones:

| Uniform swing to D | House D seats, 2024 lines | House D seats, 2026 lines | Cost to D |
|---|---|---|---|
| 0 (2024 replay) | 205 | 201 | −4 |
| +4 | 221 | 215 | −6 |
| +8 | 237 | 225 | −12 |

Missouri stays on its 2022 lines, which the courts kept in force for 2026.

## Backtest

Each House cycle from 2010 to 2022 is predicted from information available before its Election Day (the previous presidential margin on that cycle's lines, and 538's final generic-ballot average), with every parameter refit leave-one-cycle-out. 2,655 contested races are scored.

| Variant | Log loss | Brier | Midterms log loss |
|---|---|---|---|
| Normal curve, σ = 7.24 | 0.197 | 0.0498 | 0.214 |
| Student-t, refit | 0.177 | 0.0493 | 0.186 |
| Student-t + one incumbency term | 0.149 | 0.0413 | 0.165 |
| **Student-t + incumbent running and open seat (this model)** | **0.139** | **0.0382** | **0.154** |

A normal curve has the wrong shape: it is too thin in the far tail and too wide in the 10–50% range, and refitting σ barely helps. A Student-t with 3 degrees of freedom is calibrated in every band:

| Chance we give the underdog | Races | Upsets expected | Upsets observed |
|---|---|---|---|
| under 0.25% | 657 | 0.8 | 1 |
| 0.25–1% | 706 | 3.8 | 7 |
| 1–3% | 505 | 9.1 | 9 |
| 3–10% | 417 | 24.2 | 24 |
| 10–25% | 214 | 34.3 | 33 |
| 25–50% | 156 | 57.0 | 57 |

**The fat tail comes from crossover incumbents,** members holding seats that lean to the other party, such as the Blue Dog Democrats who survived 2010 in McCain seats. Among races a lean-only model calls safe, the favored party's own seats flipped 3 times in 1,779 (0.17%), while crossover incumbents lost 16 times in 109 (15%). That is why incumbency enters the margin before the fat tail is applied.

The final generic ballot missed the actual House vote by 2.6 points (root mean square) from 2010 to 2022, and overstated Democrats in 5 of the 7 cycles. That is why the later models simulate one shared national error in every election.

## Files

| File | What it is |
|---|---|
| `predictions.csv` | 470 races in the shared format |
| `results/house_2024_on_2026_map.csv` | Every district's 2024 margin on both maps, incumbency, and the projection |
| `results/senate_2024_baseline.csv` | The same for the Senate |
| `results/national_environment.csv` | The generic-ballot averages and the swing, with the Wikipedia revision |
| `results/redistricting_by_state.csv`, `results/seats_by_national_swing.csv` | The redistricting tables above |
| `results/backtest_*.csv` | Per-cycle scores, calibration bands, and every backtested race |
| `results/model_vs_kalshi.csv`, `results/strategy_summary.csv`, `submission/` | Written by `decide.py`, as for every model |

**Data:** [The Downballot](https://www.the-downballot.com/p/the-downballots-calculations-of-presidential) for presidential results by district on each map, and [538's archives](https://github.com/fivethirtyeight/election-results), pinned to commits, for House results, incumbents and generic-ballot averages.
