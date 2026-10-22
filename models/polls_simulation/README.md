# Polls + simulation (Phase 2, planned)

**Idea.** A race-level poll average, weighted by recency, sample size and pollster quality. Where polls are sparse, it's blended with the [fundamentals](../fundamentals/) prior. Then come 10,000 seeded simulated elections. Each one draws a single national error shared by every race, plus a separate error for each race.

**Why.** Most of the points are in the Senate and in swing House seats, and that is where polls help. The simulation also gives us the distribution of our total score, which is what we need to choose how much risk to take in a tournament.

**Starting point.** The final generic ballot missed the actual House vote by 2.6 points RMS from 2010 to 2022. It overstated Democrats by 2.0 points on average. Each run's shared national error should be drawn at that size (see [`../uniform_swing/results/backtest_cycles.csv`](../uniform_swing/results/backtest_cycles.csv)).

**Data.**
- 2026 race polls and the generic ballot (FiftyPlusOne).
- Historical polls and pollster ratings (538's archive).

**To do:**
- Ingest the polls.
- Build the weighted average.
- Write the seeded simulation.
- Write `predictions.csv` in the format described in [`models/README.md`](../README.md).
