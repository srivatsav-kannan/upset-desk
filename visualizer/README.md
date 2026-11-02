# Election map

An interactive map of every model's 2026 predictions. Pick a model and Senate or House, and each state or district is shaded by its projected margin. A second view shows what mid-decade redistricting did to the House map. The design follows [jacksonjude's USA Election Map](https://github.com/jacksonjude/USA-Election-Map), but none of its code or map files are used: that repo has no license.

```bash
cd visualizer
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + static site in visualizer/dist/ (host it anywhere)
```

Requires Node.js 20+.

## What it shows

- **Data:** every `models/<name>/predictions.csv` in the repo, in the shared format from [`models/README.md`](../models/README.md). A new model shows up in the picker as soon as its CSV exists: on the next build, or live while `npm run dev` is running. The picker uses the first heading of the model's README as its name. If the model also writes `results/race_explain.csv` (`race_id` plus labelled columns), the tooltip lists those lines under the margin, e.g. the ensemble's fundamentals, ratings, polls and news for each race.
- **Color:** the projected margin (`projected_margin`), in USA Election Map's buckets. A model with no margin is bucketed by win probability instead (95 / 80 / 60%).

  | Bucket | Margin (points) |
  |---|---|
  | Tilt | under 1 |
  | Lean | 1 to 5 |
  | Likely | 5 to 15 |
  | Safe | 15 or more |

- **Sides:** the map is Republican vs the strongest non-Republican, the same framing as `decide.py`. An independent winner is drawn on the non-Republican side with a hatch. No third color stays distinguishable from both the blue and red scales for color-blind readers.
- **Redistricting view** (House only): nine states redrew for 2026 (AL, CA, FL, LA, NC, OH, TN, TX, UT), changing 145 districts.
  - **Color:** each redrawn district is shaded by the 2024 presidential margin (Harris − Trump, share of the total vote) inside its lines, in the same buckets and colors. Districts whose lines didn't change are gray.
  - **2024 lines / 2026 lines:** switches between the old and new maps. The other map's district lines are drawn dashed, only where they moved. The zoom is kept, so you can flip back and forth on one state.
  - **Legend:** seats each candidate carried among the redrawn districts on the shown map, the national total (Trump carried 230 seats on the 2024 lines and 234 on the 2026 lines) and the change by state.
  - **Tooltip and table:** each district's margin on both maps, the shift, whether the 2024 winner flips, and the selected model's 2026 forecast. In the forecast view, a redrawn district's tooltip also shows its old and new 2024 margin.
  - **Data:** The Downballot's 2024 presidential results by district on the [2024 lines and the 2026 lines](https://www.the-downballot.com/p/the-downballots-calculations-of-presidential), read from the newest `data/raw/downballot/downballot_{2024,2026}_lines_*.csv` (the files `common.py` downloads). A district counts as redrawn when its vote totals differ between the two sheets, the same test as `uniform_swing`'s `lines_changed`. So a few districts that moved only a handful of voters count as redrawn too.
  - **Missouri** shows as unchanged, because our predictions keep it on its old lines (see [Map geometry](#map-geometry)).
- **Interaction:**
  - Hover, tap or Tab to a shape to see its margin, win probability and rating.
  - In the House view, click a state to zoom into it.
  - Scroll or pinch to zoom, and drag to pan.
  - **Table** lists every race. It's the accessible version of the map.
- **Links:** the view is kept in the URL, e.g. `?model=uniform_swing&chamber=senate` or `?view=redistricting&lines=2024`, so a link opens the same map.

## Colors

Light and dark mode follow the system setting. Each party has four steps, from Tilt to Safe:

- **Blue (D):** steps from a validated reference ramp.
- **Red (R):** each step matches the blue step's lightness, at a red hue.

Every step was checked against color-blindness simulation. D and R stay distinct at every step: the worst pair scores 13.1 (target 8) under simulation and 17.7 (floor 15) in normal vision. In light mode the safest seats are darkest. In dark mode the scale flips, so the safest seats are brightest and the closest races sit nearest the background. The values and validation notes are at the top of [`src/styles.css`](src/styles.css).

## Publishing on GitHub Pages

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds the map on every push to `main` that touches `visualizer/`, a model's `predictions.csv` or `README.md`, or The Downballot's sheets. It then publishes the map to **https://srivatsav-kannan.github.io/election-prediction/**. You can also run it by hand: Actions → Deploy election map → Run workflow.

**One-time setup, by the repo owner:** Settings → Pages → Build and deployment → Source: **GitHub Actions**. Until that's done, the workflow still builds the site, so every push gets a free type-check, and it skips the deploy with a notice instead of failing.

**Before turning it on, note two things:**
- **A private repo needs a paid plan for Pages.** For a personal account that's GitHub Pro, which is free for students through GitHub Education. Making the repo public also works.
- **The site is public even if the repo is private.** Anyone with the link can see every model's predictions. The team may want to wait until after Kalshi's Nov 1 snapshot.

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
| `src/data/models.ts` | Finds and validates every `predictions.csv`, plus optional `results/race_explain.csv` (`import.meta.glob`) |
| `src/data/redistricting.ts` | Loads The Downballot's 2024 presidential results on both maps (lazily, in their own chunk), and finds the redrawn districts |
| `src/map/scale.ts` | Margin buckets, sides, labels |
| `src/map/redistricting.ts` | Redistricting view: colors, shift and flip labels, and the check that the shapes match the sheets |
| `src/map/ElectionMap.tsx` | The SVG map: zoom (d3-zoom), hover/focus, click-to-zoom |
| `src/map/Legend.tsx`, `Tooltip.tsx`, `RaceTable.tsx` | Key with seat counts, hover card, table view (each with a redistricting version) |
| `scripts/build-geo.mjs` | Census shapefiles → `src/geo/us-2026.json`, including the 2024 lines of redrawn states |

**Dependencies:**
- **Runtime:** React and three small D3 modules (zoom, selection, transition).
- **Build only:** Vite and TypeScript, plus mapshaper and d3-geo, which are used only by `npm run geo`.
- **Not installed:** npm held back install scripts for two native packages that mapshaper pulls in. They aren't needed.
