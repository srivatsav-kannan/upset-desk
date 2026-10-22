# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) and humans working in this repo. Read [README.md](README.md) first: it explains the challenge, the scoring rule and the phased strategy.

## The goal in one line

Produce `submission/*.csv` predictions for the 2026 House and Senate races. Our score is −log₂(Kalshi's Nov 1 probability for our pick) for each correct pick, so **we choose picks by expected points, not just by which candidate is most likely to win**.

## Layout

**The whole pipeline lives in one file: [`forecast.py`](forecast.py).** That covers ingest, model, results and submission. Extend it; don't split it into packages. Every run writes to `results/` and `submission/`. **Commit every result**: code changes and the outputs they produce go in the same commit.

## Hard rules

1. **Reproducible.** Judges must be able to regenerate our CSVs from code. Every random process takes an explicit seed. No manual edits to outputs.
2. **Raw data is immutable.** Downloads go to `data/raw/<source>/` with the retrieval date in the filename (e.g. `kalshi_2026-10-21.json`). Never edit them. Hand fixes go in `data/overrides/*.csv`, and every row needs a `source` column (a URL) and a `note`.
3. **No leakage in backtests.** When predicting cycle *Y*, only use information that existed before Election Day *Y*. That means pre-election polls, ratings and fundraising. Never use final results or post-election data as features.
4. **Kalshi is not a model feature.** Market prices may only be used in the decision step (the expected-points pick) and for evaluation. The model's probabilities must stay an independent opinion.
5. **Keep secrets out of git.** API keys (e.g. `FEC_API_KEY`) live in `.env`, which is gitignored. Load them from the environment.
6. **Deterministic before AI.** Don't add ML/LLM components until the deterministic baseline exists. Then add them only if they improve the backtest score. Report the before/after numbers in the PR.

## Conventions

- **Language:** Python 3.9+, standard library only so far. Add a dependency only when it clearly pays for itself, and list it in the README.
- **Race IDs** must match the templates exactly: `XX-SEN` for Senate, `XX-NN` (zero-padded) for House, `XX-AL` for at-large seats. OH-SEN and FL-SEN are the special elections. Read the canonical list from `submission/templates/`. Don't hardcode it.
- **Parties:** use `D`, `R`, `I` internally. Map to whatever string the organizers require only when writing the submission.
- **Margins** are Democratic share minus Republican share of the two-party vote, in points (positive = D).
- **Network calls** live only in the ingest functions. They must cache to `data/raw/` and back off on HTTP 429. The Kalshi API rate-limits aggressively.
- **Notebooks** are for exploration. Anything the pipeline needs moves into `forecast.py`.

## Scoring helpers (implement once, reuse everywhere)

```python
import math

def points(p_kalshi_pick: float) -> float:
    return -math.log2(max(p_kalshi_pick, 0.01))

def expected_points(p_model_pick: float, p_kalshi_pick: float) -> float:
    return p_model_pick * points(p_kalshi_pick)
```

Every model change should report the following, using leave-one-cycle-out CV on 2010–2024 with an emphasis on midterms (2010, 2014, 2018, 2022):
- Brier score and log loss of our probabilities.
- Expected and simulated score under the decision rule.

## Gotchas

- **2026 district lines differ from 2024 in several states** because of mid-decade redistricting (TX, CA, NC, OH, UT; MO and VA are contested). District lean must be computed on the 2026 lines.
- **Top-two states (CA, WA)** can have same-party general elections. **AK and ME** use ranked-choice voting. **NE-SEN** has a competitive independent. **GA** has runoffs.
- **Uncontested races** and races without a Kalshi market need explicit handling. Check the README's open questions before guessing.
- **Kalshi data is messy.** Events can be candidate-named or party-named, and series tickers are inconsistent (`SENATEXX`, `SENATEPARTYXX`, `KXHOUSE…`). Validate the race-to-market mapping against Ballotpedia and fail loudly when something doesn't match.

## Before you open a PR

- The pipeline runs end to end, or the part you touched does.
- The submission validator in `forecast.py` passes: race IDs match the template in order, every party is D/R/I, and probabilities are in [0, 1]. `candidate_name` stays blank until candidate data is ingested.
- The README is updated if you changed data sources, method or run instructions.
