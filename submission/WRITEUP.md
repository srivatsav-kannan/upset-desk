# Write-up (form answers)

Paste-ready answers for the [submission form](https://forms.gle/E9xeDRjsqm2TwFuu7). Due **Nov 2, 11:59pm**. One person submits for the team.

Track: **Full Congress.** CSV: [`house_polls_portfolio_full_congress.csv`](house_polls_portfolio_full_congress.csv). Model type: **Ensemble or hybrid.**

---

## Thought process behind your model (200 words)

We treated this as two problems: getting honest odds for every race, then deciding who to pick given how the contest is scored. Kalshi's prices only come in at the second step, so the forecast stays our own opinion.

For the forecast, we combined three signals in a single regression: how each district voted in 2024 on its new 2026 lines (shifted by the generic ballot and adjusted for incumbents running again), the average of up to 11 expert ratings, and polls from the last four weeks. We let history set the weights, fitting on every House and Senate race from 2010 to 2022 and predicting each year without the model seeing it. That version called 96.7% of House races and 92.6% of Senate races correctly, and its underdogs won about as often as its odds said they would.

For the picks, we back our forecast's favorite almost everywhere, which already puts us against the market in 5 races. In 12 more we back a candidate we expect to lose, but only when we rate them above the market, give them at least a 1 in 20 chance, and the bet is clearly worth more on average.

## Which data points did you include? (200 words)

The model learns from past results: the MIT Election Lab's House and Senate returns from 2010 to 2024. Because Texas, California, North Carolina, Ohio and Utah redrew their maps for 2026, we used The Downballot's 2024 presidential results recalculated on the new district lines. Expert ratings from up to 11 forecasters per race (Cook, Sabato's Crystal Ball, Inside Elections and others) were our strongest input, cutting the model's error by about 40%. For polls, we trained on FiveThirtyEight's archive and used Wikipedia's race pages for 2026, keeping only the last four weeks and only polls of the two candidates actually on the ballot, which covers the polled Senate races and 57 House districts. We also used a generic ballot average across five aggregators (Democrats +8.9) and incumbency and retirement data from Wikipedia. On top of that sits a small layer of candidate and news research on 105 competitive races, scored on a fixed checklist and saved to a file so the run is reproducible. Kalshi's November 1 prices are used only to choose picks. We left out fundraising and demographics, since district lean and the ratings already capture most of what they would add.

## Risks and limitations

The biggest risk is that our strategic picks move together. All 12 are Republicans in seats where the market favors the Democrat, so a strong night for Democrats could sink nearly all of them at once, and in 8 out of 10 of our simulated elections the total score lands between about 47 and 66 points. We also learned from only seven elections, and a national environment this lopsided is rarer than most of what the model trained on.

Most House races have no recent polls, so 378 districts rest entirely on vote history and expert ratings, and if the raters move as a herd, so do we. The news research is a judgment layer we can't backtest, because rerunning it on past years would leak their results, which is why it can only move a race by a point or two. Alaska's Senate race cuts against us: our forecast favors Dan Sullivan, while Mary Peltola led the August primary 49.5% to 41.4%, and primary results aren't something the model uses. Finally, nine same-party California races have no market at all, and in Alaska and Nebraska we model the race as one non-Republican against the Republican, which simplifies ranked-choice voting and Dan Osborn's independent bid.

## Link to visualization, slides, or extra explanation (optional)

https://srivatsav-kannan.github.io/election-prediction/ (once GitHub Pages is turned on, see the checklist)

No slide deck is required. The site is our explanation: an interactive map of all 470 races, a 3D view of each state, a panel for every race (who's favored, why, past results, and a short note wherever our pick differs from the forecast), a searchable table, and an "Our prediction strategy" page with the track record and the pick strategy. It's written for a general audience, with no model jargon.

## Anything else you want to tell us?

Everything reproduces from code. Running `python3 forecast.py` regenerates every CSV in about two minutes using only Python's standard library, every simulation is seeded, and the raw data is saved by download date in `data/raw/`. The model never reads Kalshi's prices, and a unit test checks that it can't.

---

## Checklist before hitting submit

- [x] Upload the CSV to Google Drive ("The Upset Desk - full_congress_predictions (final).csv"; the link is already in the form).
- [ ] Share that Drive file with dwgan@stanford.edu and arsalem@stanford.edu.
- [ ] Make the repo public, or add dwgan@stanford.edu and arsalem@stanford.edu as collaborators. **It's private right now.**
- [ ] Team name, full names and Stanford emails of all three of us, in the same order.
- [ ] Turn on GitHub Pages (Settings → Pages → Source: GitHub Actions; needs the repo public, or GitHub Pro), then check the link above loads.
- [ ] Track: Full Congress. Bonus award: yes.
- [ ] Tick the three acknowledgement boxes.
