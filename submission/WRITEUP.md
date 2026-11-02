# Write-up

The Upset Desk, Full Congress track. Predictions: [`house_polls_portfolio_full_congress.csv`](house_polls_portfolio_full_congress.csv). Interactive explanation: [srivatsav-kannan.github.io/upset-desk](https://srivatsav-kannan.github.io/upset-desk/).

## Thought process

We treated this as two problems: getting honest odds for every race, then deciding who to pick given how the contest is scored. Kalshi's prices only come in at the second step, so the forecast stays our own opinion.

For the forecast, we combined three signals in a single regression: how each district voted in 2024 on its new 2026 lines (shifted by the generic ballot and adjusted for incumbents running again), the average of up to 11 expert ratings, and polls from the last four weeks. We let history set the weights, fitting on every House and Senate race from 2010 to 2022 and predicting each year without the model seeing it. That version called 96.7% of House races and 92.6% of Senate races correctly, and its underdogs won about as often as its odds said they would.

For the picks, we back our forecast's favorite almost everywhere, which already puts us against the market in 5 races. In 12 more we back a candidate we expect to lose, but only when we rate them above the market, give them at least a 1 in 20 chance, and the bet is clearly worth more on average.

## Data

The model learns from past results: FiveThirtyEight's archive of House and Senate returns from 2010 to 2024. Because Texas, California, North Carolina, Ohio and Utah redrew their maps for 2026, we used The Downballot's 2024 presidential results recalculated on the new district lines. Expert ratings from up to 11 forecasters per race (Cook, Sabato's Crystal Ball, Inside Elections and others) were our strongest input, cutting the model's error by about 40%. For polls, we trained on FiveThirtyEight's archive and used Wikipedia's race pages for 2026, keeping only the last four weeks and only polls of the two candidates actually on the ballot, which covers the polled Senate races and 57 House districts. We also used a generic ballot average across five aggregators (Democrats +8.9) and incumbency and retirement data from Wikipedia. On top of that sits a small layer of candidate and news research on 105 competitive races, scored on a fixed checklist and saved to a file so the run is reproducible. Kalshi's November 1 prices are used only to choose picks. We left out fundraising and demographics, since district lean and the ratings already capture most of what they would add.

## Risks and limitations

The biggest risk is that our strategic picks move together. All 12 are Republicans in seats where the market favors the Democrat, so a strong night for Democrats could sink nearly all of them at once, and in 8 out of 10 of our simulated elections the total score lands between about 47 and 66 points. We also learned from only seven elections, and a national environment this lopsided is rarer than most of what the model trained on.

Most House races have no recent polls, so 378 districts rest entirely on vote history and expert ratings, and if the raters move as a herd, so do we. The news research is a judgment layer we can't backtest, because rerunning it on past years would leak their results, which is why it can only move a race by a point or two. Alaska's Senate race cuts against us: our forecast favors Dan Sullivan, while Mary Peltola led the August primary 49.5% to 41.4%, and primary results aren't something the model uses. Finally, nine same-party California races have no market at all, and in Alaska and Nebraska we model the race as one non-Republican against the Republican, which simplifies ranked-choice voting and Dan Osborn's independent bid.
