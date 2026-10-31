import type { Chamber, Model, Race } from "../data/models";
import type { DistrictLines, LinesYear, Redistricting } from "../data/redistricting";
import { raceTitle, type BBox, type UsGeometry } from "./geo";

/** Forecast: each race by projected margin. Redistricting: House districts on the 2024 or 2026 lines. */
export type ViewMode = "forecast" | "redistricting";

/** One shape on the map: a state (Senate view) or a district (House view), with its race. */
export interface Region {
  id: string;
  stateId: string;
  stateName: string;
  stateBBox: BBox;
  title: string;
  bbox: BBox;
  d: string;
  /** Undefined when the state has no race this cycle, or the model has no prediction for it. */
  race?: Race;
  /** House only: the district's 2024 presidential vote on both maps. */
  lines?: DistrictLines;
}

/** `year` picks the House shapes: the 2024 lines swap in the old districts of each redrawn state. */
export function regionsFor(
  geo: UsGeometry,
  chamber: Chamber,
  model: Model | undefined,
  redistricting: Redistricting | null,
  year: LinesYear = 2026,
): Region[] {
  const states = new Map(geo.states.map((s) => [s.id, s]));
  if (chamber === "Senate") {
    return geo.states.map((s) => {
      const race = model?.races.get(`${s.id}-SEN`);
      const title = race ? raceTitle(race.raceId, s.name) : s.name;
      return { id: s.id, stateId: s.id, stateName: s.name, stateBBox: s.bbox, title, bbox: s.bbox, d: s.d, race };
    });
  }
  const redrawn = new Set(geo.redrawn);
  const shapes =
    year === 2024
      ? [...geo.districts.filter((d) => !redrawn.has(d.state)), ...geo.districts2024].sort((a, b) => a.id.localeCompare(b.id))
      : geo.districts;
  return shapes.map((d) => {
    const state = states.get(d.state);
    if (!state) throw new Error(`${d.id}: unknown state ${d.state}`);
    const title = raceTitle(d.id, state.name);
    const lines = redistricting?.districts.get(d.id);
    return { id: d.id, stateId: d.state, stateName: state.name, stateBBox: state.bbox, title, bbox: d.bbox, d: d.d, race: model?.races.get(d.id), lines };
  });
}

/** Reading order for lists: by state name, then district number (ids are zero-padded). */
export const byStateThenDistrict = (a: Region, b: Region): number =>
  a.stateName.localeCompare(b.stateName) || a.id.localeCompare(b.id);
