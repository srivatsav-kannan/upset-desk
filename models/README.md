# Models

Each model lives in its own folder and produces one file that everything else reads: `predictions.csv`.

| Folder | Phase | Status |
|---|---|---|
| [`ensemble/`](ensemble/) | 1–3 | **Done, submission model.** Fundamentals + expert ratings + Senate polls, stacked by a regression backtested on 2010–2022 House and Senate, a researched news layer, and a seeded seat simulation. Reads `uniform_swing`'s outputs (`DEPENDS_ON`). |
| [`house_polls/`](house_polls/) | 2–3 | **Done.** The ensemble plus House district polls (538 archive for the backtest, Wikipedia state pages for 2026): House log loss 0.0769 against the ensemble's 0.0804. Writes 4,000 correlated simulated elections, which `decide.py` uses to score pick strategies by the spread of the score (`portfolio_*.csv`). Reads `ensemble`'s outputs (`DEPENDS_ON`). |
| [`uniform_swing/`](uniform_swing/) | Baseline v2 | **Done.** The 2024 vote on the 2026 map, a generic-ballot swing and incumbency, with Student-t probabilities. Has a 2010–2024 House backtest. |
| [`expert_ratings/`](expert_ratings/) | 0b | Folded into `ensemble` (ratings are its strongest input). |
| [`fundamentals/`](fundamentals/) | 1 | Partly in `ensemble`; FEC money still to do. |
| [`polls_simulation/`](polls_simulation/) | 2 | Folded into `ensemble` (Senate polls and the correlated simulation). |
| [`upset_classifier/`](upset_classifier/) | 4 (optional) | Planned. Gradient-boosted classifier for "will the favorite lose?" |

## Folder layout

```
models/<name>/
  model.py          # defines run(args); may define add_arguments(parser) for its own flags
  README.md         # method, data, results, known limits
  predictions.csv   # written by run(): the model's output (format below)
  results/          # the model's own diagnostics and backtests, plus decide.py's model_vs_kalshi.csv / strategy_summary.csv
                    #   optional race_explain.csv: race_id + labelled columns, shown in the map's tooltip
  submission/       # written by decide.py: favorite_*.csv (model favorite) and ev_*.csv (expected-points rule)
```

A model may also write `results/simulated_outcomes.csv` (`race_id, p_d, p_d_simulated, non_r_wins`, where `non_r_wins` has one character per simulated election, `1` if the non-Republican wins). `decide.py` then scores pick strategies in every simulated election (`results/portfolio_summary.csv`) and writes the chosen one as `submission/portfolio_*.csv`. See [`house_polls`](house_polls/README.md#pick-strategies-against-simulated-elections).

`python3 forecast.py` finds every folder that has a `model.py`. A model that reads another model's outputs names it in `DEPENDS_ON = ["other"]`, and that model runs first. For each one, it runs the model and then [`decide.py`](../decide.py) on the model's `predictions.csv`. A folder with only a README is skipped.

The [visualizer](../visualizer/) maps every `predictions.csv` it finds, so a new model appears there with no extra work. It colors each race by `projected_margin`, falling back to `win_probability` when that's blank, and names the model after the first heading of its README.

## `predictions.csv` format

One row per race, in the order of [`submission/templates/full_congress_track_template.csv`](../submission/templates/full_congress_track_template.csv) (470 rows). `common.validate_predictions` checks it.

| Column | Meaning |
|---|---|
| `race_id` | Template ID: `XX-SEN`, `XX-NN` or `XX-AL` |
| `chamber` | `Senate` or `House` |
| `projected_margin` | Projected D − R margin in points. Leave it blank if the model has no margin. |
| `p_d` | **Unrounded** probability that the Democrat wins. Where the main non-Republican is an independent (e.g. NE-SEN), it's the probability that candidate wins. |
| `predicted_winner_party` | `D`, `R` or `I` |
| `win_probability` | Probability for `predicted_winner_party`, rounded to 4 places |

**Rules:**
- **No Kalshi prices.** A model never reads them. `decide.py` is the only code that sees the market.
- **Shared data code.** Downloads and parsers that more than one model can use go in [`common.py`](../common.py). Everything specific to one model stays in its folder.
- **Backtest before adopting.** A new model should beat [`ensemble`](ensemble/)'s out-of-sample scores (House log loss 0.080, Senate 0.126; the [`uniform_swing`](uniform_swing/) baseline is 0.139 for the House) before we rely on it.
