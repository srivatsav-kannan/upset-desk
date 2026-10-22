import type { Chamber, Model, Race } from "../data/models";
import { raceTitle, type BBox, type UsGeometry } from "./geo";

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
}

export function regionsFor(geo: UsGeometry, chamber: Chamber, model: Model | undefined): Region[] {
  const states = new Map(geo.states.map((s) => [s.id, s]));
  if (chamber === "Senate") {
    return geo.states.map((s) => {
      const race = model?.races.get(`${s.id}-SEN`);
      const title = race ? raceTitle(race.raceId, s.name) : s.name;
      return { id: s.id, stateId: s.id, stateName: s.name, stateBBox: s.bbox, title, bbox: s.bbox, d: s.d, race };
    });
  }
  return geo.districts.map((d) => {
    const state = states.get(d.state);
    if (!state) throw new Error(`${d.id}: unknown state ${d.state}`);
    const title = raceTitle(d.id, state.name);
    return { id: d.id, stateId: d.state, stateName: state.name, stateBBox: state.bbox, title, bbox: d.bbox, d: d.d, race: model?.races.get(d.id) };
  });
}

/** Reading order for lists: by state name, then district number (ids are zero-padded). */
export const byStateThenDistrict = (a: Region, b: Region): number =>
  a.stateName.localeCompare(b.stateName) || a.id.localeCompare(b.id);
