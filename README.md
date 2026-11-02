# The Upset Desk: 2026 US Congress Forecast

Our entry for Stanford Democracy Day's **Model Citizens** challenge, Full Congress track. We forecast all 470 House and Senate races on the November 3, 2026 ballot, then choose a candidate in each one to score as many points as possible against Kalshi's November 1 odds.

- **Predictions:** [`submission/house_polls_portfolio_full_congress.csv`](submission/house_polls_portfolio_full_congress.csv)
- **Write-up:** [`submission/WRITEUP.md`](submission/WRITEUP.md)
- **Interactive site:** [srivatsav-kannan.github.io/upset-desk](https://srivatsav-kannan.github.io/upset-desk/), built from [`visualizer/`](visualizer/)

## At a glance

| | |
|---|---|
| House | Democrats favored in 237 seats (225 to 248 in 9 of 10 simulations), with a 99.8% chance of a majority |
| Senate | Democrats and allied independents at 52 seats (49 to 55), with a 77% chance of a majority |
| Accuracy, out of sample, 2010–2022 | 96.7% of House races and 92.6% of Senate races called correctly; underdogs won about as often as our odds said |
| Picks against the market | 17 of the 461 races with a Kalshi market: 5 where our forecast favors the market's underdog, and 12 strategic picks |
| Expected score | 56.2 points across 4,000 simulated elections, against 48.8 for picking every market favorite |

## How the forecast works

Every race gets three inputs:
- **How the place votes:** the 2024 presidential margin inside the 2026 district lines, shifted by this year's generic ballot (Democrats +8.9) and adjusted for incumbents running again.
- **Expert ratings:** the average of up to 11 professional race ratings.
- **Polls:** a recency-weighted average of the last four weeks wherever there are polls (most Senate races and 57 House districts), counting only polls of the two candidates on the ballot.

A regression combines them, with weights fit on every House and Senate race from 2010 to 2022 (2,897 races) and each year predicted without the model seeing it. A Student-t distribution turns the projected margin into a win probability. A small candidate and news layer, researched on a fixed checklist for 105 competitive races, can move a race by a point or two. Finally, 4,000 seeded simulated elections, each with one national error shared by every race, give the seat totals.

Expert ratings are the strongest single input. Ideas that made the backtest worse were left out, including a flat "Democrats are overstated" correction, a partisan-poll correction, and averaging in a simpler baseline model. The details are in [`models/ensemble/`](models/ensemble/) and [`models/house_polls/`](models/house_polls/).

## How we pick

A correct pick earns −log₂(p) points, where p is Kalshi's November 1 probability for that candidate (floored at 1%), and a wrong pick earns nothing. A 90% favorite is worth 0.15 points and a 25% underdog is worth 2, so a well-chosen upset is worth many safe calls.

We pick our forecast's favorite in almost every race. In 5 races that candidate is the market's underdog. In 12 more we back a candidate our forecast expects to lose, and only when three things are all true:
1. Backing them is worth at least 25% more on average than backing the favorite: our chance times the points for a win, against the same for the favorite.
2. We rate them strictly higher than the market does.
3. We give them at least a 5% chance.

Kalshi's prices are used only in this step ([`decide.py`](decide.py)). The models never read them, and a test enforces that, so the forecast stays an independent opinion.

## Special cases

- **Redistricting.** Nine states redrew for 2026 (AL, CA, FL, LA, NC, OH, TN, TX, UT, 145 districts in all), so every House forecast uses its district's 2026 lines. Missouri's 2025 map was blocked by the courts for this election, so Missouri stays on its 2022 lines.
- **Same-party races.** Nine California races are top-two contests between two candidates of the same party, with no Kalshi market. The party is settled, and we name the June primary leader.
- **Louisiana** holds an open all-party primary on November 3, with a December runoff if nobody wins a majority. Kalshi prices the party, and for the two open seats with no single nominee the candidate is listed as the Republican field.
- **Independents and ranked choice.** Each race is modeled as the strongest non-Republican against the Republican, which covers Dan Osborn in Nebraska and Alaska's ranked-choice general.
- **Candidate names** come from Kalshi's markets. Where a market names only a party, the name comes from [`data/overrides/candidate_names.csv`](data/overrides/candidate_names.csv), with a source for every row.

## Data

| Source | Used for |
|---|---|
| [FiveThirtyEight's election archive](https://github.com/fivethirtyeight/election-results) (pinned commits) | House, Senate and presidential results, the training labels, plus historical generic-ballot averages and polls for the backtest |
| [The Downballot](https://www.the-downballot.com/p/the-downballots-calculations-of-presidential) | Presidential results inside each congressional district, on the 2024 and 2026 lines (and earlier lines for the backtest) |
| Wikipedia race and ratings pages | Expert ratings for 2010–2026, 2026 polls, the generic ballot average, incumbents and retirements |
| Candidate and news research | 105 competitive races, scored on the protocol in [`models/ensemble/news_protocol.md`](models/ensemble/news_protocol.md) and saved in `data/raw/llm_news/` |
| [Kalshi](https://kalshi.com/category/elections) | November 1 market odds, used only to choose picks |
| [Census TIGER/Line](https://www2.census.gov/geo/tiger/) | District shapes for the site |

Every download is cached in `data/raw/` with its retrieval date and never edited by hand. Hand fixes live in `data/overrides/`, each with a source.

## Reproducing it

Requires Python 3.9 or newer and nothing outside the standard library.

```bash
python3 forecast.py
```

This runs every model on the cached data and rewrites every CSV in about two minutes. Add `--refresh` to download the sources again.

```bash
python3 -m unittest discover tests
```

The 27 tests cover the parsers, the backtest (a held-out year's results can't change its own forecast), calibration, the output formats, and the rule that no model reads Kalshi.

The site needs Node.js 20 or newer:

```bash
cd visualizer && npm install && npm run dev
```

```
forecast.py      runs each model, then the pick step
common.py        downloads, cache, parsers, CSV checks
decide.py        the pick step: the only code that reads Kalshi
models/          one folder per model, each with its README, predictions and results
submission/      the submitted CSVs, the official templates and the write-up
data/raw/        cached source files
data/overrides/  sourced hand fixes
tests/           the test suite
visualizer/      the interactive site
```

## Models

| Model | What it is | House log loss, out of sample |
|---|---|---|
| [`house_polls`](models/house_polls/) (submitted) | The ensemble plus House district polls, with the seat simulation and pick strategies | 0.077 |
| [`ensemble`](models/ensemble/) | Vote history, expert ratings, Senate polls and the news layer, combined by regression | 0.080 |
| [`uniform_swing`](models/uniform_swing/) | Baseline: the 2024 vote on the new lines, a national swing and incumbency | 0.139 |

Lower is better. In the Senate, `ensemble` and `house_polls` share a log loss of 0.126.

## Team

Srivatsav Kannan ([@srivatsav-kannan](https://github.com/srivatsav-kannan)), Ray Li ([@heruirayli](https://github.com/heruirayli)) and Krish Wu ([@KrishWu](https://github.com/KrishWu)).
