# Expert ratings (Phase 0b, planned)

**Idea.** Map each race's Cook, Sabato's Crystal Ball and Inside Elections rating (Safe, Likely, Lean, Toss-up) to a win probability. Each rating's probability is how often favorites with that rating actually won, 2010–2024.

**Why.** It gives a cheap, strong baseline and a sanity check. The historical rating-to-outcome rates also tell us how upset-prone each rating level really is.

**Data.**
- Current ratings from each outlet.
- Historical ratings from Wikipedia race pages.
- Results from `common.load_house_results` (538's archive, already cached in `data/raw/fivethirtyeight/`).

**To do:**
- Ingest current and historical ratings into `common.py`.
- Fit rating → probability, leave-one-cycle-out.
- Write `predictions.csv` in the format described in [`models/README.md`](../README.md).
