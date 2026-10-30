# Models

Each model lives in its own folder and produces one file that everything else reads: `predictions.csv`.

| Folder | Phase | Status |
|---|---|---|
| [`uniform_swing/`](uniform_swing/) | Baseline v2 | **Done.** The 2024 vote on the 2026 map, a generic-ballot swing and incumbency, with Student-t probabilities. Has a 2010–2024 House backtest. |
| [`expert_ratings/`](expert_ratings/) | 0b | Planned. Cook / Sabato / Inside ratings mapped to probabilities. |
| [`fundamentals/`](fundamentals/) | 1 | Planned. Margin regression: lean, incumbency, open seat, environment, money. |
| [`polls_simulation/`](polls_simulation/) | 2 | Planned. Poll average blended with fundamentals, plus a correlated simulation. |
| [`upset_classifier/`](upset_classifier/) | 4 (optional) | Planned. Gradient-boosted classifier for "will the favorite lose?" |

## Folder layout

```
models/<name>/
  model.py          # defines run(args); may define add_arguments(parser) for its own flags
  README.md         # method, data, results, known limits
  predictions.csv   # written by run(): the model's output (format below)
  results/          # the model's own diagnostics and backtests, plus decide.py's model_vs_kalshi.csv / strategy_summary.csv
  submission/       # written by decide.py: favorite_*.csv (model favorite) and ev_*.csv (expected-points rule)
```

`python3 forecast.py` finds every folder that has a `model.py`. For each one, it runs the model and then [`decide.py`](../decide.py) on the model's `predictions.csv`. A folder with only a README is skipped.

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
- **Backtest before adopting.** A new model should beat [`uniform_swing`](uniform_swing/)'s out-of-sample scores (log loss 0.139 for v2, the Student-t + incumbent running / open seat version; 0.197 for v1) before we rely on it.
