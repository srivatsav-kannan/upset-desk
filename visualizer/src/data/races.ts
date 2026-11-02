import { extrasFor, type RaceExtras } from "./forecast";
import type { Chamber, Model, Race } from "./models";

/** A race with everything the site shows about it. */
export interface RaceView {
  id: string;
  chamber: Chamber;
  stateId: string;
  stateName: string;
  /** "15th district", "At-large district", "Senate", "Senate · special election". */
  seat: string;
  /** "Texas's 15th district", "Alaska Senate". */
  title: string;
  race: Race;
  extras: RaceExtras;
}

const SPECIALS = new Set(["OH-SEN", "FL-SEN"]);

/** So the race list needs no map geometry. */
export const STATE_NAMES: Record<string, string> = {
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

export function seatOf(id: string): string {
  const s = id.slice(3);
  if (s === "SEN") return SPECIALS.has(id) ? "Senate · special election" : "Senate";
  if (s === "AL") return "At-large district";
  return `${ordinal(Number(s))} district`;
}

export function titleOf(id: string, stateName: string): string {
  const s = id.slice(3);
  if (s === "SEN") return `${stateName} Senate${SPECIALS.has(id) ? " (special)" : ""}`;
  if (s === "AL") return `${stateName} at-large`;
  return `${stateName}'s ${ordinal(Number(s))} district`;
}

export function raceViews(model: Model): Map<string, RaceView> {
  const out = new Map<string, RaceView>();
  for (const race of model.races.values()) {
    const stateId = race.raceId.slice(0, 2);
    const stateName = STATE_NAMES[stateId] ?? stateId;
    out.set(race.raceId, {
      id: race.raceId,
      chamber: race.chamber,
      stateId,
      stateName,
      seat: seatOf(race.raceId),
      title: titleOf(race.raceId, stateName),
      race,
      extras: extrasFor(race.raceId),
    });
  }
  return out;
}

/** Closest race first: how far the leader's chance is from a coin flip. */
export const closeness = (v: RaceView): number => Math.abs(v.race.pD - 0.5);

/** Reading order: by state, the Senate race first, then districts in order. */
export const readingOrder = (a: RaceView, b: RaceView): number =>
  a.stateName.localeCompare(b.stateName) || (a.chamber === b.chamber ? a.id.localeCompare(b.id) : a.chamber === "Senate" ? -1 : 1);
