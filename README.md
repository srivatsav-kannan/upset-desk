# Model Citizens 2026: US Congress Forecast

Our entry for **Model Citizens** (Stanford Democracy Day): predict the winners of the November 3, 2026 US congressional elections, scored against Kalshi's market odds.

> **Status:** planning and data collection. No model code yet. See [Roadmap](#roadmap).

## The challenge

| | Senate track | Full Congress track |
|---|---|---|
| Races | 35 (33 regular seats + OH and FL specials) | 470 (435 House + 35 Senate) |
| Template | [`submission/templates/senate_track_template.csv`](submission/templates/senate_track_template.csv) | [`submission/templates/full_congress_track_template.csv`](submission/templates/full_congress_track_template.csv) |

There is also a **bonus award for the best explanation or visualization**. It is judged on clarity, not accuracy.

**Submission needs three things:**
1. A predictions CSV in the official template format (`race_id, chamber, predicted_winner_party, candidate_name, win_probability`).
2. This GitHub repo, with all the code needed to reproduce the predictions and a README covering data, method and how to run it.
3. A one-paragraph write-up covering our thought process, the data we chose and the risks and limitations.

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

The slides warn that "sometimes, too much data is noise". Ranked by expected value, the order is district lean → incumbency/open seat → national environment → polls → money → ratings → everything else.

## Repo layout (planned)

```
data/raw/          # downloaded source files, never edited by hand (large files gitignored)
data/overrides/    # hand-curated fixes (e.g. candidate names), each row cites a source
data/processed/    # model-ready tables built by code
src/ingest/        # one module per source
src/features/      # feature building
src/models/        # baselines, fundamentals, polls + simulation
src/decide/        # expected-points pick logic
src/submit/        # writes and validates the submission CSVs
notebooks/         # exploration only; nothing the pipeline depends on
submission/        # final CSVs + write-up
```

## How to run

To be written once the pipeline exists. The target is a single command that goes from raw data to the submission CSVs, with fixed seeds.

## Roadmap

- [ ] Confirm the open questions with the organizers (below)
- [ ] Ingest: Kalshi daily snapshot, MIT results, district lean on new lines, Ballotpedia candidates
- [ ] Phase 0 baselines + scoring function + backtest harness
- [ ] Phase 1 fundamentals model
- [ ] Phase 2 polls + simulation
- [ ] Phase 3 decision layer, then the final run after the Nov 1 Kalshi pull
- [ ] Write-up + visualization (bonus award)

## Open questions for the organizers

1. What is the submission deadline? Before or after the Nov 1 pull?
2. For House races with no Kalshi market, what *p* is used?
3. Is scoring by `predicted_winner_party`, by `candidate_name`, or both? What applies in same-party top-two races and for independents (NE-SEN)?
4. Is `win_probability` scored, or informational only?
5. Which Kalshi price counts: last trade, midpoint or bid/ask, and at what time on Nov 1?

## Team

[@srivatsav-kannan](https://github.com/srivatsav-kannan) · [@KrishWu](https://github.com/KrishWu) · [@heruirayli](https://github.com/heruirayli)
