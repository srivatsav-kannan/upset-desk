# Election map

An interactive map of every model's 2026 predictions. Pick a model and Senate or House, and each state or district is shaded by its projected margin. The design follows [jacksonjude's USA Election Map](https://github.com/jacksonjude/USA-Election-Map), but none of its code or map files are used: that repo has no license.

```bash
cd visualizer
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + static site in visualizer/dist/ (host it anywhere)
```

Requires Node.js 20+.

## What it shows

- **Data:** every `models/<name>/predictions.csv` in the repo, in the shared format from [`models/README.md`](../models/README.md). A new model shows up in the picker as soon as its CSV exists: on the next build, or live while `npm run dev` is running. The picker uses the first heading of the model's README as its name.
- **Color:** the projected margin (`projected_margin`), in USA Election Map's buckets. A model with no margin is bucketed by win probability instead (95 / 80 / 60%).

  | Bucket | Margin (points) |
  |---|---|
  | Tilt | under 1 |
  | Lean | 1 to 5 |
  | Likely | 5 to 15 |
  | Safe | 15 or more |

- **Sides:** the map is Republican vs the strongest non-Republican, the same framing as `decide.py`. An independent winner is drawn on the non-Republican side with a hatch. No third color stays distinguishable from both the blue and red scales for color-blind readers.
- **Interaction:**
  - Hover, tap or Tab to a shape to see its margin, win probability and rating.
  - In the House view, click a state to zoom into it.
  - Scroll or pinch to zoom, and drag to pan.
  - **Table** lists every race. It's the accessible version of the map.
- **Links:** the view is kept in the URL, e.g. `?model=uniform_swing&chamber=senate`, so a link opens the same map.

## Colors

Light and dark mode follow the system setting. Each party has four steps, from Tilt to Safe:

- **Blue (D):** steps from a validated reference ramp.
- **Red (R):** each step matches the blue step's lightness, at a red hue.

Every step was checked against color-blindness simulation. D and R stay distinct at every step: the worst pair scores 13.1 (target 8) under simulation and 17.7 (floor 15) in normal vision. In light mode the safest seats are darkest. In dark mode the scale flips, so the safest seats are brightest and the closest races sit nearest the background. The values and validation notes are at the top of [`src/styles.css`](src/styles.css).

## Map geometry

[`src/geo/us-2026.json`](src/geo/us-2026.json) is generated and committed. Rebuild it with `npm run geo`, which downloads about 52 MB of Census zips into `data/raw/census/` (gitignored) unless they're already cached.

- **Source:** the US Census Bureau's TIGER/Line 2026 congressional districts (`cd120`, the 120th Congress, i.e. the 2026 lines), which are public domain.
- **Processing:**
  - Districts are clipped to the shoreline using the 2025 cartographic state boundaries, and simplified to a 1 km tolerance with shared borders kept consistent.
  - States are dissolved from the same districts, so the House and Senate maps line up exactly.
  - Everything is projected with Albers USA, with Alaska and Hawaii as insets.
- **Missouri is the one exception.** Census has Missouri's new 2025 map, but The Downballot's 2026 sheet, and so every model, keeps Missouri on its 2022 lines. The map draws Missouri on its 2024 Census lines so the shapes match the numbers. If Missouri votes on the new map in 2026, our Missouri predictions are for the wrong districts. See the main README's special cases.

## Code

| File | What it does |
|---|---|
| `src/data/models.ts` | Finds and validates every `predictions.csv` (`import.meta.glob`) |
| `src/map/scale.ts` | Margin buckets, sides, labels |
| `src/map/ElectionMap.tsx` | The SVG map: zoom (d3-zoom), hover/focus, click-to-zoom |
| `src/map/Legend.tsx`, `Tooltip.tsx`, `RaceTable.tsx` | Key with seat counts, hover card, table view |
| `scripts/build-geo.mjs` | Census shapefiles → `src/geo/us-2026.json` |

**Dependencies:**
- **Runtime:** React and three small D3 modules (zoom, selection, transition).
- **Build only:** Vite and TypeScript, plus mapshaper and d3-geo, which are used only by `npm run geo`.
- **Not installed:** npm held back install scripts for two native packages that mapshaper pulls in. They aren't needed.
