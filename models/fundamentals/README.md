# Fundamentals (Phase 1, planned)

**Idea.** A regression that predicts each race's D − R margin from:
- district lean on the 2026 lines
- incumbency and open seat
- the midterm penalty for the president's party
- the generic ballot and presidential approval
- fundraising share
- uncontested status

Win probability comes from the size of the regression's errors. It's trained on 2010–2024 and validated leave-one-cycle-out, with midterms weighted up.

**Starting point.** The [uniform-swing backtest](../uniform_swing/README.md#backtest-is-σ-calibrated-in-the-tails) already shows two things:
- **Incumbency is worth about +4.4 points.** Adding it cuts log loss from 0.177 to 0.149.
- **The errors are fat-tailed.** A Student-t with 3 degrees of freedom fits them; a normal does not.

Most deep-tail upsets were crossover incumbents.

**Data.**
- `common.load_house_results` gives results and incumbent party per cycle.
- The Downballot sheets give lean on each cycle's lines.
- For 2026: incumbents, retirements and candidates (Ballotpedia), and FEC fundraising.

**To do:**
- Ingest 2026 incumbents and retirements.
- Fit the regression.
- Write `predictions.csv` in the format described in [`models/README.md`](../README.md).
