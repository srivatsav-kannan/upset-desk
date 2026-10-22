# Upset classifier (Phase 4, optional, planned)

**Idea.** The slides' "Upset Finder". Label past midterm races (2010, 2014, 2018, 2022) by whether the favorite lost, then train a gradient-boosted classifier on:
- race ratings
- late fundraising surges
- candidate experience
- retirements
- news volume

The model outputs upset odds.

**Rule.** We only adopt it if it beats the Phase 2/3 backtest (see [AGENTS.md](../../AGENTS.md), "Deterministic before AI").

**Caution.** Four midterms contain only a few dozen genuine upsets, so overfitting is the main risk. In the [uniform-swing backtest](../uniform_swing/README.md#backtest-is-σ-calibrated-in-the-tails), 16 of the 20 deep-tail upsets were crossover incumbents, which a simple incumbency feature already captures.

**To do:**
- Build the labels and features.
- Train with leave-one-cycle-out validation.
- Write `predictions.csv` in the format described in [`models/README.md`](../README.md).
