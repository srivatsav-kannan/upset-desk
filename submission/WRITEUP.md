# Write-up (form answers)

Paste-ready answers for the [submission form](https://forms.gle/E9xeDRjsqm2TwFuu7). Due **Nov 2, 11:59pm**. One person submits for the team.

Track: **Full Congress.** CSV: [`house_polls_portfolio_full_congress.csv`](house_polls_portfolio_full_congress.csv). Model type: **Ensemble or hybrid.**

---

## Thought process behind your model (200 words)

Scoring is −log₂ of Kalshi's price for whoever we pick, so the problem splits in two. First, get honest probabilities. Second, go against the market only where we disagree enough to get paid for it. Kalshi only enters the pick step, never the model.

For probabilities we stacked every signal in one regression instead of averaging models by hand. Per race, the inputs are:
- a fundamentals margin: the 2024 presidential margin on the 2026 lines, the generic-ballot swing and incumbency;
- the mean of up to 11 expert ratings;
- Senate and House district polls from the last four weeks.

Weights are fit on every 2010–2022 House and Senate race with leave-one-cycle-out CV, and a Student-t turns margins into probabilities. Out of sample, House log loss is 0.077 against 0.139 for fundamentals alone, and calibration holds in every probability bin. Ideas that lost in the backtest stay out: a flat "Democrats are overstated" correction, a partisan-poll correction, and blending the baseline back in.

For picks, we simulated 4,000 correlated elections and scored several rules. We take an underdog only when its expected points beat the favorite's by 25% and we give it at least a 5% chance, which gives 21 upset calls.

## Which data points did you include? (200 words)

- **Past results:** MIT Election Lab House and Senate results, 2010–2024, are the training labels. The Downballot's 2024 presidential results on the 2026 district lines cover the mid-decade redraws in TX, CA, NC, OH and UT.
- **Expert ratings:** up to 11 raters per race (Cook, Sabato, Inside Elections and others), historical for training and current for 2026. Our strongest input: it cut log loss about 40%.
- **Polls:** for training, the FiveThirtyEight archive, 2010–2022. For 2026, Wikipedia race pages: the polled Senate races plus 57 polled House districts. We use the last 28 days, weighted by recency and sample size, and only polls of the actual top-two matchup.
- **National environment:** a generic-ballot average across 5 aggregators (D+8.9).
- **Incumbency and retirements:** from Wikipedia.
- **Candidate quality and news:** LLM-assisted research on 105 competitive races, scored on a fixed protocol, frozen to a CSV. It's centered, so it can't move the national picture, and it moves a single race by about 2 points at most.
- **Kalshi, Nov 1:** used only to choose picks.

Left out: FEC money and demographics. Lean and ratings already carry most of that signal.

## Risks and limitations

- **Our upsets are correlated.** Almost every underdog call is a Republican in a seat where Kalshi favors the Democrat, so they hit or miss together on one national error. In our simulations the score's 10th–90th percentile is 46–68.
- **Seven training cycles.** The national error is estimated from 2010–2022. A D+9 generic ballot is bigger than most of those years.
- **We lean on the raters.** If they herd, so do we.
- **The news layer isn't backtested.** You can't rerun LLM research on 2018 without leaking the result. It's capped small for that reason.
- **Thin House polling.** Only 57 of 435 districts have recent polls. The other 378 run on lean, incumbency and ratings.
- **No market in 9 races.** These are California same-party races, so we don't know how they're scored. The party pick is locked anyway, and we name the primary leader.
- **AK-SEN cuts against us.** Our biggest Senate upset call is Sullivan (R) at 61%, but Peltola led the top-four primary 49.5% to 41.4%. Primary results aren't a model input, so the model hasn't seen that.
- **Odd systems.** Alaska's RCV and Nebraska's independent (Osborn) are modelled as one non-Republican against the Republican.

## Link to visualization, slides, or extra explanation (optional)

https://srivatsav-kannan.github.io/election-prediction/ (once GitHub Pages is turned on, see the checklist)

No slide deck is required. The site is our explanation: an interactive map of all 470 races, a 3D view of each state, a panel for every race (who's favored, why, our call and what it's worth, past results), a searchable table, and a How it works essay with the track record and the pick strategy. It's written for a general audience, with no model jargon.

## Anything else you want to tell us?

Everything reproduces from code: `python3 forecast.py` regenerates every CSV in about 2 minutes. It uses the standard library only, every simulation is seeded, and raw data is cached by retrieval date in `data/raw/`. The model never reads Kalshi, and a unit test enforces that.

---

## Checklist before hitting submit

- [ ] Upload `house_polls_portfolio_full_congress.csv` to Google Drive and set it to "anyone with the link can view".
- [ ] Make the repo public, or add dwgan@stanford.edu and arsalem@stanford.edu as collaborators. **It's private right now.**
- [ ] Team name, full names and Stanford emails of all three of us, in the same order.
- [ ] Turn on GitHub Pages (Settings → Pages → Source: GitHub Actions; needs the repo public, or GitHub Pro), then check the link above loads.
- [ ] Track: Full Congress. Bonus award: yes.
- [ ] Tick the three acknowledgement boxes.
