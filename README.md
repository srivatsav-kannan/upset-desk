# Model Citizens 2026: US Congress Forecast

Our entry for **Model Citizens** (Stanford Democracy Day): predict the winners of the November 3, 2026 US congressional elections, scored against Kalshi's market odds.

> **Status:** Final. We submit [`submission/house_polls_portfolio_full_congress.csv`](submission/house_polls_portfolio_full_congress.csv) (Full Congress track), built from the Nov 1 Kalshi snapshot. The model is [`house_polls`](models/house_polls/), which is [`ensemble`](models/ensemble/) plus House district polls. `ensemble` takes fundamentals, 11 expert ratings per race, Senate polls and a researched news layer, and stacks them with a regression fit on every 2010–2022 House and Senate race, calibrated out of sample. Out-of-sample log loss: House 0.077, Senate 0.126, against 0.139 in the House for the [`uniform_swing`](models/uniform_swing/) baseline. The form write-up is in [`submission/WRITEUP.md`](submission/WRITEUP.md). See [Models](#models).

## The challenge

| | Senate track | Full Congress track |
|---|---|---|
| Races | 35 (33 regular seats + OH and FL specials) | 470 (435 House + 35 Senate) |
| Template | [`submission/templates/senate_track_template.csv`](submission/templates/senate_track_template.csv) | [`submission/templates/full_congress_track_template.csv`](submission/templates/full_congress_track_template.csv) |

There is also a **bonus award for the best explanation or visualization**. It is judged on clarity, not accuracy.

**Submission** ([form](https://forms.gle/E9xeDRjsqm2TwFuu7), due **Nov 2, 11:59pm**, one submission per team, one track):
1. A Google Drive link to the predictions CSV in the official template format (`race_id, chamber, predicted_winner_party, candidate_name, win_probability`), shared so the organizers can open it.
2. This GitHub repo, public or shared with the organizers, with all the code needed to reproduce the predictions and a README covering data, method and how to run it.
3. A write-up in three fields: thought process (200 words), data used (200 words), and risks and limitations. Ours is in [`submission/WRITEUP.md`](submission/WRITEUP.md).
4. Optional: a link to a visualization, slides or extra explanation (for the bonus award). No slide deck is required.

Organizer contacts: dwgan@stanford.edu, arsalem@stanford.edu.

## Scoring, and why it changes the strategy

- A correct pick earns **−log₂(p)** points, where *p* is **Kalshi's probability for the candidate we picked, pulled November 1**. A wrong pick earns 0.
- *p* is floored at 1%, so the most one race can be worth is 6.64 points.
- The highest total score wins. Models must have real technical substance: "always pick the Democrat" doesn't count.

| Kalshi favorite at | Points if favorite wins | Points if underdog wins | Pick the underdog when our P(underdog) exceeds |
|---|---|---|---|
| 55% | 0.86 | 1.15 | 42.8% |
| 60% | 0.74 | 1.32 | 35.8% |
| 70% | 0.51 | 1.74 | 22.9% |
| 80% | 0.32 | 2.32 | 12.2% |
| 90% | 0.15 | 3.32 | 4.4% |
| 95% | 0.07 | 4.32 | 1.7% |
| 99% | 0.01 | 6.64 | 0.2% |

**What this means for us:**

1. **The decision rule is separate from the model.** For each race we pick the candidate with the highest expected points, `P_model(c) × −log₂(max(p_Kalshi(c), 0.01))`. The pick is *not* simply whoever our model favors. Slide 10's "Upset Finder" uses exactly this formula.
2. **The rule leans heavily toward underdogs.** If Kalshi were perfectly calibrated, the underdog would have the higher expected value in *every* race. So the model's real job is to separate races that are truly locked (our underdog probability is below the break-even in the table) from races where the market is overconfident.
3. **This is a tournament.** A field that picks favorites ends up clustered at similar scores. On a Kalshi snapshot from Oct 21 (Senate, if the market is treated as the truth), picking every favorite averages about 4.7 points. Calling a few well-chosen upsets is the only way to finish first. We should tune how much variance we take on, not only the expected value.
4. **Calibration of the market matters.** Prediction markets tend to overprice longshots (the favorite–longshot bias). We will measure this against historical market data where we can find it.

## Strategy

The plan is deterministic first and AI later. Each phase has to beat the previous one in a backtest before we adopt it.

| Phase | What | Why |
|---|---|---|
| **0. Baselines** | (a) Kalshi as-is. (b) Expert ratings (Cook, Sabato, Inside) mapped to probabilities. | Gives us the floor to beat and a sanity check. |
| **1. Fundamentals** | A regression that predicts the **two-party vote margin** from district lean on current lines, incumbency, open seat, the midterm penalty for the president's party, the generic ballot, presidential approval, fundraising share and uncontested status. Win probability comes from the residual error. Trained on 2010–2024 with leave-one-cycle-out validation, with midterms weighted up. | Covers all 435 House seats, most of which have no polls. Fully reproducible. |
| **2. Polls + simulation** | A weighted poll average (by recency, sample size and pollster quality) blended with the Phase 1 prior when polls are sparse. Then 10,000 seeded Monte Carlo runs with a shared national error term. | Gets the Senate and swing House seats right, where most of the points are. |
| **3. Decision layer** | The expected-points pick against the Nov 1 Kalshi prices, plus a tunable appetite for variance. | Turns probabilities into a score. |
| **4. ML / AI (optional)** | A gradient-boosted upset classifier. LLM-extracted features such as candidate quality, scandals and late news. | Only if it improves the Phase 2/3 backtest. |

**The market is never a model feature.** Kalshi prices are used only in the decision layer, so our probabilities stay an independent opinion. Our edge comes from the races where we disagree with the market.

### Special cases to handle

- **Mid-decade redistricting.** New maps for 2026 in TX, CA (Prop 50), NC, OH, UT and others, and the status of MO and VA is contested. District lean must be recomputed on the **new lines**. Old-district results don't carry over directly.
  - **Missouri: settled, the 2022 lines.** Census's 2026 lines (TIGER/Line `cd120`) carry Missouri's 2025 map, but courts blocked it for November. The Missouri Supreme Court ruled on Sep 3, 2026 that the referendum petition suspends the map, and the U.S. Supreme Court stayed the federal orders that would have revived it (Sep 10 and 25). The Secretary of State [directed](https://abc17news.com/news/missouri/2026/09/10/hoskins-pledges-to-use-2022-missouri-congressional-map-after-u-s-supreme-court-ruling/) election authorities to use the 2022 map. The 2025 map is on the Nov 3 ballot as Proposition A, for 2028 onward. The Downballot's sheet, our predictions and the [visualizer](visualizer/) all already use the 2022 lines, so nothing changes.
- **Top-two primaries (CA, WA).** Some generals pit two candidates from the same party against each other. The party pick is then trivial and the candidate pick is what matters.
- **Ranked-choice / top-four (AK, ME).** NE-SEN has a strong independent (Osborn).
- **GA runoff rules, and uncontested seats.** Uncontested seats are effectively locked.
- **Missing Kalshi markets.** Only about 75 House races have Kalshi markets. We need to ask the organizers what *p* is for the others.

## Data sources

| Need | Source | Notes |
|---|---|---|
| Benchmark odds | [Kalshi](https://kalshi.com/category/elections). The public API at `api.elections.kalshi.com/trade-api/v2` needs no key for market data. | Snapshot daily until the official **Nov 1** pull. All 35 Senate races are listed, but only about 75 House races. Rate-limited, so requests need backoff. |
| Past results | [MIT Election Data + Science Lab](https://electionlab.mit.edu/data) | House and Senate results 1976–2024. The training labels. |
| District lean on new lines | [Cook PVI](https://www.cookpolitical.com/cook-pvi). Also 2024 presidential results by congressional district (The Downballot / Dave's Redistricting App). | The single strongest House predictor. Must match the 2026 maps. |
| 2026 polls | [FiftyPlusOne](https://fiftyplusone.news) | Race polls, generic ballot and approval. |
| Historical polls | [FiveThirtyEight data archive](https://github.com/fivethirtyeight/data) | Polls and forecasts before 2025, for backtests and pollster weights. |
| Money | [FEC / OpenFEC API](https://www.fec.gov/data) | Receipts and cash on hand per candidate. A free API key from api.data.gov goes in `.env`. |
| Candidates | [Ballotpedia](https://ballotpedia.org) | Who is on the ballot, incumbents, open seats, uncontested races. |
| Expert ratings | [Sabato's Crystal Ball](https://centerforpolitics.org/crystalball), [Inside Elections](https://insideelections.com), Cook | Current ratings, plus historical ratings (from Wikipedia race pages) for the backtest. |
| Demographics | [Census ACS](https://data.census.gov) | Income, education and age by district. Lowest priority: mostly captured by lean already. |
| Map shapes | [Census TIGER/Line 2026](https://www2.census.gov/geo/tiger/TIGER2026/CD/) congressional districts (`cd120`), plus [2025](https://www2.census.gov/geo/tiger/TIGER2025/CD/) (`cd119`) for the 2024 lines of redrawn states | The 2026 and 2024 lines, public domain. Used only by the [visualizer](visualizer/). |

The slides warn that "sometimes, too much data is noise". Ranked by expected value, the order is district lean → incumbency/open seat → national environment → polls → money → ratings → everything else.

## Repo layout

```
forecast.py               # runner: runs each model (dependencies first), then the decision step on its predictions
common.py                 # shared data layer: downloads, raw-data cache, parsers, CSV helpers
decide.py                 # the only code that reads Kalshi: expected-points pick + submission CSVs
models/<name>/            # one folder per model (see models/README.md)
  model.py                #   run(args) writes predictions.csv
  predictions.csv         #   the model's output, one row per race (shared format)
  results/                #   diagnostics, backtests, model_vs_kalshi.csv, strategy_summary.csv
  submission/             #   favorite_*.csv and ev_*.csv in the official template format
data/raw/                 # downloaded source files, cached with retrieval date, never edited by hand
                          #   (llm_news/: the frozen news research the ensemble reads)
tests/                    # unittest suite for parsers, backtest leakage, calibration and outputs
submission/                # the team's submission CSVs (copied from the submission model by forecast.py)
  templates/              #   the official templates
visualizer/               # React + TypeScript map of every model's predictions.csv (see visualizer/README.md)
```

## How to run

Requires Python 3.9+ and only the standard library.

```bash
python3 forecast.py                        # every model in models/, using cached data in data/raw/
python3 forecast.py --model uniform_swing  # one model (repeatable)
python3 forecast.py --refresh              # re-downloads the source data first
python3 forecast.py --swing 0              # uniform_swing: overrides the national swing (0 = pure 2024 replay)
python3 forecast.py --ensemble-d-correction  # ensemble: apply the generic-ballot D correction (worse in the backtest)
python3 -m unittest discover tests         # 26 tests: parsers, leakage, calibration, outputs, no Kalshi in models
```

A full run takes about 1¾ minutes, most of it the two leave-one-cycle-out backtests.

**Map of the predictions.** The [visualizer](visualizer/) needs Node.js 20+. It reads every `models/*/predictions.csv`, so run the pipeline first:

```bash
cd visualizer && npm install && npm run dev
```

A workflow can also publish the map to GitHub Pages on every push to `main`. It needs a one-time setup by the repo owner, and the site would be public. See [Publishing on GitHub Pages](visualizer/README.md#publishing-on-github-pages).

## Models

Every model writes `models/<name>/predictions.csv` in one shared format ([`models/README.md`](models/README.md)). The decision step then turns it into picks and submission CSVs inside the same folder, so models can be compared side by side.

| Model | Status | Out-of-sample log loss, 2010–2022 |
|---|---|---|
| [`ensemble`](models/ensemble/) | Built; `house_polls` builds on it | House **0.080**, Senate **0.126** (fundamentals + ratings + Senate polls, stacked; news layer on top) |
| [`house_polls`](models/house_polls/) | **Built, submission model** | House **0.0769** (the ensemble plus House district polls; Senate as the ensemble). Adds pick strategies scored against correlated simulated elections. |
| [`uniform_swing`](models/uniform_swing/) | Built (v2), baseline | House 0.139 (Student-t + incumbent running / open seat). v1 was 0.197. |
| [`expert_ratings`](models/expert_ratings/) | Folded into `ensemble` | |
| [`fundamentals`](models/fundamentals/) | Partly in `ensemble` (no FEC money yet) | |
| [`polls_simulation`](models/polls_simulation/) | Folded into `ensemble` (Senate polls + seat simulation) | |
| [`upset_classifier`](models/upset_classifier/) | Planned (Phase 4, optional) | |

**`ensemble` in brief.** For each race the inputs are:
- fundamentals (from `uniform_swing`);
- the mean of up to 11 expert ratings;
- for the Senate, a recency-weighted average of the last 4 weeks of polls.

A regression fit on 2,655 House and 242 Senate races, leave-one-cycle-out, combines them. A Student-t turns the margin into a probability. A news layer, researched for 105 competitive races and centred so it can't move the national environment, adds at most a couple of points.

The forecast is House D 235 (90%: 226–244) and 52 non-R Senate seats (49–55), with a 77% chance of a non-R Senate majority. On the Nov 1 prices, the expected-points rule (with no upset called below a 5% chance) makes 30 underdog picks and expects 48.2 points if Kalshi is right, against 43.2 for picking every Kalshi favorite.

A flat "Democrats are overstated" correction was tested three ways and made the backtest worse every time. It is reported as a stress test (Senate majority 77% → 50%) instead of being applied. Averaging the stack with the deterministic baseline afterwards was also worse at every weight (House 0.080 → 0.086 at 20%), because the stack already weights the fundamentals. Full write-up: [`models/ensemble/README.md`](models/ensemble/README.md).

**`house_polls` in brief.** The ensemble, plus each House district's general-election polls from the last 28 days where there are any (57 districts in 2026). Fit on the 506 polled House races of 2010–2022, the polls cut log loss on those races from 0.295 to 0.276 and change 2 calls (TX-15 and ME-02 to D). Partisan polls lean about 5 points toward their sponsor, but subtracting that made the backtest worse, so it isn't applied. The model also writes 4,000 seeded simulated elections that share one national error. `decide.py` scores pick strategies in each one: keeping only underdogs whose expected points beat the favorite's by 25%, and that we give at least a 5% chance, leaves 21 upset calls (28 without the 25% edge) with nearly the same mean and a narrower downside. Full write-up: [`models/house_polls/README.md`](models/house_polls/README.md).

**`uniform_swing` in brief.** Each race takes the 2024 presidential margin on its 2026 lines, plus a D+10.5 swing (generic ballot D+8.9 on Oct 30, against a 2024 presidential national margin of D−1.7). Two incumbency terms are added: +5.1 points for an incumbent running and +1.3 for the party holding an open seat. Win probability comes from a Student-t (df 3, scale 5.56). All four parameters are fit on the 2010–2022 House, and the model is calibrated out of sample.

The result is House D 231 / R 204 and 15 of 35 Senate seats for Democrats. Against Kalshi, the expected-points rule makes 222 underdog picks and expects 74.3 points if the market is right, against 45.3 for picking every Kalshi favorite. 20 of those underdog picks are Senate long shots that rest on a House-fitted tail; the ensemble fits its tail on the Senate instead.

The full write-up is in [`models/uniform_swing/README.md`](models/uniform_swing/README.md): redistricting effects, the swing, the Kalshi comparison and the [backtest](models/uniform_swing/README.md#backtest-is-σ-calibrated-in-the-tails).

## Roadmap

- [ ] Confirm the open questions with the organizers (below)
- [x] Baseline v0: 2024 presidential results on the 2026 map ([Baseline v0](models/uniform_swing/README.md#baseline-v0-2024-replayed-on-the-2026-map))
- [x] Baseline v1: uniform national swing from the generic ballot ([Baseline v1](models/uniform_swing/README.md#baseline-v1-adding-the-national-environment))
- [x] Kalshi snapshot + model-vs-market comparison + expected-points pick
- [x] Backtest tail calibration (σ) on historical House results, 2010–2024 ([Backtest](models/uniform_swing/README.md#backtest-is-σ-calibrated-in-the-tails))
- [x] One folder per model, with a shared predictions format and decision step ([models/](models/))
- [x] Interactive map of each model's predictions on the 2026 lines ([visualizer/](visualizer/))
- [x] Redistricting view: each redrawn House district on its 2024 and 2026 lines, by 2024 presidential margin ([visualizer/](visualizer/README.md#what-it-shows))
- [x] Resolve the Missouri map mismatch (2022 lines are in force) (see [Special cases](#special-cases-to-handle))
- [x] Baseline v2: Student-t + incumbent running / open seat, with 2026 incumbents and retirements from Wikipedia ([v2](models/uniform_swing/README.md#baseline-v2-student-t--incumbency))
- [x] Senate backtest of the tail before trusting Senate long-shot picks (the ensemble's Senate backtest, 242 races)
- [x] Ensemble: expert ratings + Senate polls + fundamentals, stacked and backtested on 2010–2022 House and Senate, with a news layer and a seat simulation ([ensemble](models/ensemble/))
- [x] Test suite (`python3 -m unittest discover tests`)
- [ ] Phase 1 fundamentals: FEC money
- [x] House district polls ([house_polls](models/house_polls/))
- [x] Pick strategies scored against correlated simulated elections ([house_polls](models/house_polls/README.md#pick-strategies-against-simulated-elections))
- [x] Phase 3 decision layer, then the final run after the Nov 1 Kalshi pull
- [x] Write-up ([`submission/WRITEUP.md`](submission/WRITEUP.md)); visualization for the bonus award is the [visualizer](visualizer/)

## Open questions for the organizers

1. ~~What is the submission deadline?~~ Nov 2, 11:59pm (the form).
2. For House races with no Kalshi market, what *p* is used?
3. Is scoring by `predicted_winner_party`, by `candidate_name`, or both? What applies in same-party top-two races and for independents (NE-SEN)?
4. Is `win_probability` scored, or informational only?
5. Which Kalshi price counts: last trade, midpoint or bid/ask, and at what time on Nov 1?

## Team

[@srivatsav-kannan](https://github.com/srivatsav-kannan) · [@KrishWu](https://github.com/KrishWu) · [@heruirayli](https://github.com/heruirayli)
