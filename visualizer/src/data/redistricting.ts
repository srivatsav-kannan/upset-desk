import { parseCsvRows } from "./csv";

export type LinesYear = 2024 | 2026;
export const LINES_YEARS: LinesYear[] = [2024, 2026];

/** The 2024 presidential vote in one district, on one map. */
export interface PresVote {
  harris: number;
  trump: number;
  total: number;
  /** Harris - Trump in points of the total vote: The Downballot's margin (common.load_districts). */
  margin: number;
}

/** One House district on the 2024 lines and on the 2026 lines (the same district number). */
export interface DistrictLines {
  id: string;
  vote: Record<LinesYear, PresVote>;
  /** The vote totals differ between the maps: uniform_swing's `lines_changed`. */
  redrawn: boolean;
}

/** A state with at least one redrawn district. */
export interface StateLines {
  state: string;
  seats: number;
  redrawn: number;
  /** Seats Trump carried on each map. */
  trump: Record<LinesYear, number>;
}

export interface Redistricting {
  districts: Map<string, DistrictLines>;
  /** Alphabetical. */
  states: StateLines[];
  /** Seats Trump carried nationally on each map. */
  trump: Record<LinesYear, number>;
}

// The Downballot's 2024 presidential results by district on each map, as common.py downloads
// them (the newest retrieval of each is used). Loaded on demand, in its own chunk.
const SHEETS: Record<LinesYear, Record<string, () => Promise<string>>> = {
  2024: import.meta.glob<string>("../../../data/raw/downballot/downballot_2024_lines_*.csv", { query: "?raw", import: "default" }),
  2026: import.meta.glob<string>("../../../data/raw/downballot/downballot_2026_lines_*.csv", { query: "?raw", import: "default" }),
};
const RACE_ID = /^[A-Z]{2}-(AL|\d{2})$/;

/** Ties go to Trump, as in uniform_swing. */
export const trumpWon = (v: PresVote): boolean => v.margin <= 0;

async function newestSheet(year: LinesYear): Promise<[string, string]> {
  const path = Object.keys(SHEETS[year]).sort().at(-1);
  if (!path) throw new Error(`no data/raw/downballot/downballot_${year}_lines_*.csv`);
  return [path.split("/").at(-1) ?? path, await SHEETS[year][path]()];
}

/** A "Vote totals" tab: banner rows, then a header row naming Harris/Trump/Total, then districts. */
function parseSheet(name: string, text: string): Map<string, PresVote> {
  const rows = parseCsvRows(text);
  const header = rows.find((r) => r.includes("Harris"));
  if (!header) throw new Error(`${name}: no header row with a Harris column`);
  const [h, t, tot] = ["Harris", "Trump", "Total"].map((c) => header.indexOf(c));
  const out = new Map<string, PresVote>();
  for (const r of rows) {
    if (!RACE_ID.test(r[0])) continue;
    const [harris, trump, total] = [r[h], r[t], r[tot]].map((s) => Number(s.replace(/,/g, "")));
    if (![harris, trump, total].every((n) => Number.isInteger(n) && n > 0)) throw new Error(`${name} ${r[0]}: bad vote counts`);
    out.set(r[0], { harris, trump, total, margin: (100 * (harris - trump)) / total });
  }
  if (out.size !== 435) throw new Error(`${name}: expected 435 districts, got ${out.size}`);
  return out;
}

export async function loadRedistricting(): Promise<Redistricting> {
  const [[oldName, oldText], [newName, newText]] = await Promise.all([newestSheet(2024), newestSheet(2026)]);
  const old = parseSheet(oldName, oldText);
  const now = parseSheet(newName, newText);

  const districts = new Map<string, DistrictLines>();
  for (const [id, n] of now) {
    const o = old.get(id);
    if (!o) throw new Error(`${id} is in ${newName} but not ${oldName}`);
    districts.set(id, { id, vote: { 2024: o, 2026: n }, redrawn: o.harris !== n.harris || o.trump !== n.trump });
  }

  const byState = new Map<string, DistrictLines[]>();
  for (const d of districts.values()) {
    const list = byState.get(d.id.slice(0, 2)) ?? [];
    list.push(d);
    byState.set(d.id.slice(0, 2), list);
  }
  const count = (ds: DistrictLines[], year: LinesYear) => ds.filter((d) => trumpWon(d.vote[year])).length;
  const states = [...byState]
    .filter(([, ds]) => ds.some((d) => d.redrawn))
    .map(([state, ds]) => ({
      state,
      seats: ds.length,
      redrawn: ds.filter((d) => d.redrawn).length,
      trump: { 2024: count(ds, 2024), 2026: count(ds, 2026) },
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
  const all = [...districts.values()];
  return { districts, states, trump: { 2024: count(all, 2024), 2026: count(all, 2026) } };
}
