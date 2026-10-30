# News and candidate-quality research protocol

This is the brief each research agent (Claude, with web search) received on 2026-10-30. Its
output is frozen in `data/raw/llm_news/news_2026-10-30.csv` and read by `model.py`; the model
never calls an LLM itself, so the run is reproducible from that file.

## Brief

You are researching 2026 U.S. congressional general elections (Election Day: November 3,
2026; today is October 30, 2026) for a forecasting model. For each race assigned to you,
find facts about the two main general-election candidates and the late news, then score two
small adjustments.

**Facts to record** (from news reporting, campaign/official sites, Ballotpedia, FEC):
- The Democratic nominee (or the main non-Republican, e.g. an independent) and the
  Republican nominee.
- Whether each has held elected office before (yes/no).
- Any scandal or serious controversy (none / minor / major, with a few words).
- The money picture from the latest FEC reports (raised and cash on hand): which side leads
  (D / R / even / unknown).
- The most important news about the race from October 2026.

**Scores**, integers from -2 to +2, positive helping the Democrat (or the main non-Republican):
- `quality_edge`: candidate quality relative to what a typical nominee of each party would be
  in this race: experience, scandals, money, campaign competence, fit with the district.
- `news_edge`: late developments not yet reflected in older polls or ratings: scandals
  breaking, a candidate withdrawing or being replaced, major endorsements, momentum shifts.

Calibrate conservatively. 0 is the default. Use +/-1 for a clear, notable edge and +/-2 only
for an exceptional one (a major scandal breaking, a former governor against a first-time
candidate). Expert ratings and polls are already in the model, so do not score who is
favored; score only specific facts about candidates and news.

**Not allowed:** prediction markets or betting odds (Kalshi, Polymarket, PredictIt, betting
sites) must not be consulted or cited. They are what the model is scored against.

**Output:** one CSV row per race with the columns `race_id, dem_candidate, rep_candidate,
other_candidate, dem_elected_experience, rep_elected_experience, dem_scandal, rep_scandal,
money_edge, quality_edge, news_edge, confidence (low/medium/high), summary (at most 200
characters), sources (up to 3 URLs separated by spaces)`.

## How the model uses it

`adjustment (points of margin) = 0.5 * (1.5 * quality_edge + 1.0 * news_edge)`, so at most
+/-2.5 points. The 0.5 shrink is there because ratings and polls already price in much of
this. These weights are a prior, not fitted: the scores cannot be backtested honestly,
because a model asked about a past race already knows who won.
