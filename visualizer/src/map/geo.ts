import geoUrl from "../geo/us-2026.json?url";

/** [x0, y0, x1, y1] in the map's viewBox. */
export type BBox = [number, number, number, number];

export interface StateShape {
  id: string;
  name: string;
  bbox: BBox;
  d: string;
}

export interface DistrictShape {
  id: string;
  state: string;
  bbox: BBox;
  d: string;
}

/** Built by scripts/build-geo.mjs from the Census 2026 district lines (and 2024, where they changed). */
export interface UsGeometry {
  source: string;
  width: number;
  height: number;
  states: StateShape[];
  districts: DistrictShape[];
  /** States whose district lines changed for 2026 (not Missouri; see the build script). */
  redrawn: string[];
  /** Every district of a redrawn state, on its 2024 lines. */
  districts2024: DistrictShape[];
  /** Interior district boundaries of each map, only where they moved: the dashed overlay. */
  lines2024: string;
  lines2026: string;
}

export async function loadGeometry(): Promise<UsGeometry> {
  const res = await fetch(geoUrl);
  if (!res.ok) throw new Error(`map geometry: HTTP ${res.status}`);
  return (await res.json()) as UsGeometry;
}

// The two 2026 Senate specials (see the repo README); every other Senate race is regular.
const SPECIALS = new Set(["OH-SEN", "FL-SEN"]);

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "Texas's 15th district", "Alaska at-large", "Ohio Senate (special)". */
export function raceTitle(raceId: string, stateName: string): string {
  const seat = raceId.slice(3);
  if (seat === "SEN") return `${stateName} Senate${SPECIALS.has(raceId) ? " (special)" : ""}`;
  if (seat === "AL") return `${stateName} at-large`;
  return `${stateName}'s ${ordinal(Number(seat))} district`;
}
