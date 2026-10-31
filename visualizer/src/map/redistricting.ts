import { trumpWon, type DistrictLines, type LinesYear, type Redistricting } from "../data/redistricting";
import type { UsGeometry } from "./geo";
import { marginBucket, type Side } from "./scale";

/**
 * Redistricting view: each House district by the 2024 presidential margin inside its lines,
 * on the 2024 or the 2026 map. Districts whose lines didn't change take the neutral, so the
 * redrawn ones stand out; the forecast's D/R scale carries over (Harris on the D arm).
 */
export const presSideOf = (margin: number): Side => (margin > 0 ? "d" : "r");

/** CSS fill for a margin on the party scale (custom properties in styles.css). */
export const presFillOf = (margin: number): string => `var(--${presSideOf(margin)}-${marginBucket(margin)})`;

export function linesFillOf(lines: DistrictLines | undefined, year: LinesYear): string {
  return lines?.redrawn ? presFillOf(lines.vote[year].margin) : "var(--no-race)";
}

/** "Trump +10.1", "Harris +3.2", "Even". Also used for a shift between maps. */
export function formatPres(margin: number): string {
  const m = Math.abs(margin);
  return m < 0.05 ? "Even" : `${margin > 0 ? "Harris" : "Trump"} +${m.toFixed(1)}`;
}

/** Change in the 2024 margin from the old lines to the new (positive = toward Harris). */
export const shiftOf = (lines: DistrictLines): number => lines.vote[2026].margin - lines.vote[2024].margin;

/** "Flips to Trump" when the 2024 winner differs between the maps, else null. */
export function flipOf(lines: DistrictLines): string | null {
  const [before, after] = [trumpWon(lines.vote[2024]), trumpWon(lines.vote[2026])];
  return before === after ? null : `Flips to ${after ? "Trump" : "Harris"}`;
}

/** "Trump", or "Harris → Trump" when the 2024 winner differs between the maps. */
export function winnerChange(lines: DistrictLines): string {
  const [before, after] = [lines.vote[2024], lines.vote[2026]].map((v) => (trumpWon(v) ? "Trump" : "Harris"));
  return before === after ? before : `${before} → ${after}`;
}

/** "Moved 5.7 pts toward Trump", or "No partisan change" for a district that barely moved. */
export function shiftLabel(lines: DistrictLines): string {
  const shift = shiftOf(lines);
  return Math.abs(shift) < 0.05 ? "No partisan change" : `Moved ${Math.abs(shift).toFixed(1)} pts toward ${shift > 0 ? "Harris" : "Trump"}`;
}

/** "+3", "−6", "0": a change in seats, with a real minus sign. */
export const formatSeatChange = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/**
 * The map's 2024 shapes and The Downballot's sheets must agree on which states redrew, or the
 * view would color districts it can't draw on their old lines. Null when they agree.
 */
export function shapesMismatch(geo: UsGeometry, redistricting: Redistricting): string | null {
  const shapes = [...(geo.redrawn ?? [])].sort().join(" ");
  const sheets = redistricting.states.map((s) => s.state).join(" ");
  return shapes === sheets
    ? null
    : `The map's 2024 shapes cover ${shapes || "no states"}, but The Downballot redrew ${sheets}. Run npm run geo.`;
}
