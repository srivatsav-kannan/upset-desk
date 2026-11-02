# Models

Each model lives in its own folder and produces one file that everything else reads: `predictions.csv`.

| Folder | What it is |
|---|---|
| [`house_polls/`](house_polls/) | **Submitted.** The ensemble plus House district polls (House log loss 0.077 against the ensemble's 0.080), with 4,000 correlated simulated elections that `decide.py` uses to score pick strategies. Reads `ensemble`'s outputs. |
| [`ensemble/`](ensemble/) | Vote history, expert ratings and Senate polls combined by a regression fit on every 2010–2022 House and Senate race, plus the candidate and news layer and a seat simulation. Reads `uniform_swing`'s outputs. |
| [`uniform_swing/`](uniform_swing/) | The baseline: the 2024 vote on the 2026 map, a generic-ballot swing and incumbency, with Student-t probabilities and a 2010–2024 House backtest. |

## Folder layout

```
models/<name>/
  model.py          # defines run(args); may define add_arguments(parser) for its own flags
  README.md         # method, data, results, known limits
  predictions.csv   # written by run(): the model's output (format below)
  results/          # the model's own diagnostics and backtests, plus decide.py's model_vs_kalshi.csv / strategy_summary.csv
                    #   optional race_explain.csv: race_id + labelled columns, a readable per-race summary
  submission/       # written by decide.py: favorite_*.csv, ev_*.csv and, with simulations, portfolio_*.csv
```

A model may also write `results/simulated_outcomes.csv` (`race_id, p_d, p_d_simulated, non_r_wins`, where `non_r_wins` has one character per simulated election, `1` if the non-Republican wins). `decide.py` then scores pick strategies in every simulated election (`results/portfolio_summary.csv`) and writes the chosen one as `submission/portfolio_*.csv`. See [`house_polls`](house_polls/README.md#pick-strategies-against-simulated-elections).

`python3 forecast.py` finds every folder that has a `model.py`. A model that reads another model's outputs names it in `DEPENDS_ON = ["other"]`, and that model runs first. For each one, it runs the model and then [`decide.py`](../decide.py) on the model's `predictions.csv`.

The [visualizer](../visualizer/) shows the submission model and validates every `predictions.csv` it finds; any model can be opened with `?model=<folder>`. It colors each race by `projected_margin`, falling back to `win_probability` when that's blank.

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
- **Backtest before adopting.** A new model should beat the current out-of-sample scores (House log loss 0.077, Senate 0.126) before it is used.
