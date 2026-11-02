# Election map

The public site for our 2026 forecast: every House and Senate race, who's favored and why, and which candidate we picked. It's written for people who don't follow forecasting, so it never uses model jargon. It's built with React and TypeScript, plus three.js for the 3D state view. The map follows the look of [jacksonjude's USA Election Map](https://github.com/jacksonjude/USA-Election-Map), but none of its code or map files are used: that repo has no license.

```bash
cd visualizer
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + static site in visualizer/dist/ (host it anywhere)
npm run history   # rebuild src/data/history.json (past results) from data/raw/
```

Requires Node.js 20+.

## What it shows

The site shows the **submission model**: whichever model's `portfolio_full_congress.csv` `forecast.py` copied into `submission/` (now `house_polls`). Add `?model=<folder>` to a link to see another model's `predictions.csv` instead. That's for the team's own checks, so there's no picker on the page.

- **Map.** Two cards at the top give the chance of each chamber changing hands and the typical seat count, from the model's own simulated elections (`results/simulation_summary.csv`); clicking a card switches the map between House and Senate. Each state or district is shaded by who's favored and how strongly:

  | Shade | Projected margin (points) |
  |---|---|
  | Toss-up | under 1 |
  | Lean | 1 to 5 |
  | Likely | 5 to 15 |
  | Safe | 15 or more |

  The sidebar counts seats by shade. Hovering shows the leading candidate and their chance. **Redrawn districts** switches to the redistricting view described below.
- **State view.** Click any state. Its House districts rise in 3D, colored as on the map and **as tall as their projected margin**, so safe seats are towers and toss-ups lie nearly flat. The camera swoops in from overhead; drag to turn, scroll to zoom. The state's races are listed beside it, Senate first. Without WebGL the state is drawn flat instead. three.js loads only when a state is opened.
- **Race panel.** Click a district, a card or a table row. The panel shows:
  - both candidates and their chances;
  - **our call** and what it's worth: the market's price for that candidate and the points a correct pick earns. Upset calls explain why we took them: either our chance is well above the market's, or it's a cheap ticket where a win pays far more;
  - **what drives the forecast**, in four plain lines: how the area votes, the expert ratings, the polls, and the candidate and news research;
  - **past results**: the presidential vote inside the 2026 lines, and every general election for that seat since 2012 (Senate: the same seat back to 2002), with a note where the lines changed.
- **All races.** Every race in one table: search by state, district or candidate; filter to competitive races, seats changing party, or our upset calls; sort by state, closeness, or the size of the upset. Phones get one card per race.
- **Our prediction strategy.** The method as a short illustrated essay: the scoring rule, the four kinds of evidence, the out-of-sample track record and calibration, the seat simulation, how picks are made (with the break-even line for an upset call), and the main risks. Every number is read from the model's result files.
- **Redistricting view** (House only): nine states redrew for 2026 (AL, CA, FL, LA, NC, OH, TN, TX, UT), changing 145 districts.
  - **Color:** each redrawn district is shaded by the 2024 presidential margin (Harris − Trump, share of the total vote) inside its lines, in the same buckets and colors. Districts whose lines didn't change are gray.
  - **2024 map / 2026 map:** switches between the old and new lines. The other map's district lines are drawn dashed, only where they moved. A click zooms into a state, so you can flip back and forth on it.
  - **Sidebar:** seats each candidate carried among the redrawn districts on the shown map, the national total (Trump carried 230 seats on the 2024 lines and 234 on the 2026 lines), the change by state, and a table of every redrawn district.
  - **Data:** The Downballot's 2024 presidential results by district on the [2024 lines and the 2026 lines](https://www.the-downballot.com/p/the-downballots-calculations-of-presidential), read from the newest `data/raw/downballot/downballot_{2024,2026}_lines_*.csv`. A district counts as redrawn when its vote totals differ between the two sheets, the same test as `uniform_swing`'s `lines_changed`.
- **Top and bottom bars:** the team name sits between a blue and a red dot, with a small arrow pointing to the strategy page. A bar along the bottom of every page lists the team with LinkedIn and GitHub links (`src/ui/TeamBar.tsx`; a missing link shows as a dimmed icon).
- **Links:** the whole view lives in the URL (`?state=TX&race=TX-15`, `?tab=races`, `?view=redistricting&lines=2024`), so a link reopens exactly what you were looking at.

## Data it reads

Everything is read at build time from files the pipeline already writes. The site never feeds anything back into a model.

| File | Used for |
|---|---|
| `models/*/predictions.csv` | Each race's chance and projected margin |
| `submission/<model>_portfolio_full_congress.csv` | Our call in each race (and which model is the submission) |
| `models/<model>/results/model_vs_kalshi.csv` | Both candidates' names and the market's odds (`decide.py` writes it; the site never reads Kalshi itself) |
| `models/ensemble/results/race_components.csv`, `models/<model>/results/race_changes.csv` | The four inputs behind each forecast |
| `models/<model>/results/simulation_summary.csv`, `seat_distribution.csv`, `portfolio_summary.csv` | Chamber odds, seat histograms, expected scores |
| `models/*/results/backtest_scores.csv`, `models/ensemble/results/backtest_calibration.csv` | Track record and calibration |
| `src/data/history.json` | Past results, built by `npm run history` from the cached 538 results archive and The Downballot's 2026-lines sheet |

## Colors

Light and dark mode follow the system setting. Each party has four steps, from Toss-up to Safe:

- **Blue (D):** steps from a validated reference ramp.
- **Red (R):** each step matches the blue step's lightness, at a red hue.

Every step was checked against color-blindness simulation. D and R stay distinct at every step: the worst pair scores 13.1 (target 8) under simulation and 17.7 (floor 15) in normal vision. The safest seats are darkest in both light and dark mode. The values are at the top of [`src/styles.css`](src/styles.css).

## Publishing on GitHub Pages

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds the site on every push to `main` that touches `visualizer/`, a model's `predictions.csv`, `README.md` or result files, `submission/`, or The Downballot's sheets. It then publishes the map to **https://srivatsav-kannan.github.io/election-prediction/**. You can also run it by hand: Actions → Deploy election map → Run workflow.

**One-time setup, by the repo owner:** Settings → Pages → Build and deployment → Source: **GitHub Actions**. Until that's done, the workflow still builds the site, so every push gets a free type-check, and it skips the deploy with a notice instead of failing.

**Before turning it on, note two things:**
- **A private repo needs a paid plan for Pages.** For a personal account that's GitHub Pro, which is free for students through GitHub Education. Making the repo public also works.
- **The site is public even if the repo is private.** Anyone with the link can see the forecast and our picks.

The build uses relative paths, so it works under the `/election-prediction/` subfolder. That was tested by serving a clean `npm ci` build from that path.

## Map geometry

[`src/geo/us-2026.json`](src/geo/us-2026.json) is generated and committed. Rebuild it with `npm run geo`, which downloads about 100 MB of Census zips (the 2026 and 2024 lines of every state) into `data/raw/census/` (gitignored) unless they're already cached.

- **Source:** the US Census Bureau's TIGER/Line 2026 congressional districts (`cd120`, the 120th Congress, i.e. the 2026 lines), which are public domain.
- **Processing:**
  - Districts are clipped to the shoreline using the 2025 cartographic state boundaries, and simplified to a 1 km tolerance with shared borders kept consistent.
  - States are dissolved from the same districts, so the House and Senate maps line up exactly.
  - Everything is projected with Albers USA, with Alaska and Hawaii as insets.
- **2024 lines for the redistricting view:** every district of a state that redrew, from TIGER/Line 2025 (`cd119`, the 119th Congress, i.e. the 2024 lines).
  - **Which states redrew** is worked out by the build: a state counts if any district's area changes by more than 1% between `cd119` and `cd120`. The nine that redrew change some district by 26% or more, and every other state by under 0.02% (ordinary Census edits). The app checks this list against The Downballot's sheets, and turns the view off with a message to rerun `npm run geo` if they disagree.
  - **Simplification:** old and new districts are simplified together, so a boundary that didn't move is drawn identically on both maps. This also adds a few points along the borders of the redrawn states, so the shapes of their neighbors shift very slightly.
  - **Dashed overlay:** each map's interior district lines in the redrawn states, minus the segments both maps share.
  - **Size:** the file grows from about 270 to 380 KB gzipped.
- **Missouri is the one exception.** Census has Missouri's new 2025 map, but The Downballot's 2026 sheet, and so every model, keeps Missouri on its 2022 lines. The map draws Missouri on its 2024 Census lines so the shapes match the numbers. Courts blocked the new map for 2026, so these are the right lines (see the main README's special cases).

## Code

| File | What it does |
|---|---|
| `src/App.tsx` | Top bar, tabs, outlook cards, URL state |
| `src/data/models.ts` | Finds and validates every `predictions.csv` (`import.meta.glob`) |
| `src/data/forecast.ts`, `src/data/races.ts` | Joins each race with our call, names, market odds, inputs and past results; chamber outlook, track record, calibration |
| `src/data/redistricting.ts` | Loads The Downballot's 2024 presidential results on both maps (lazily, in their own chunk), and finds the redrawn districts |
| `src/map/ElectionMap.tsx` | The SVG map: zoom (d3-zoom), hover and focus, click to open a state |
| `src/map/Legend.tsx`, `Tooltip.tsx`, `RaceTable.tsx` | Seat sidebar, hover card, redistricting table |
| `src/map/scale.ts`, `src/map/redistricting.ts`, `src/ui/words.ts` | Shades and buckets; redistricting labels; every plain-language label |
| `src/three/State3D.tsx` | The 3D state: extruded districts, lighting and shadows, camera intro, hover and selection |
| `src/views/StateView.tsx`, `RacePanel.tsx`, `RacesView.tsx`, `MethodView.tsx` | State view, race panel, all-races table, Our prediction strategy |
| `scripts/build-geo.mjs` | Census shapefiles → `src/geo/us-2026.json`, including the 2024 lines of redrawn states |
| `scripts/build-history.mjs` | 538 results archive + The Downballot → `src/data/history.json` |

**Dependencies:**
- **Runtime:** React, three.js (the state view only, loaded on demand), and three small D3 modules (zoom, selection, transition). Fonts: Inter and Fraunces from Google Fonts, falling back to system fonts.
- **Build only:** Vite and TypeScript, plus mapshaper and d3-geo, which are used only by `npm run geo`.
- **Not installed:** npm held back install scripts for two native packages that mapshaper pulls in. They aren't needed.
