import type { Party, Race } from "../data/models";

export type Bucket = "tilt" | "lean" | "likely" | "safe";
export type Side = "d" | "r";

/** Weakest to strongest. */
export const BUCKETS: Bucket[] = ["tilt", "lean", "likely", "safe"];
export const BUCKET_LABEL: Record<Bucket, string> = { tilt: "Toss-up", lean: "Lean", likely: "Likely", safe: "Safe" };

/** Margin buckets in points (the same defaults as jacksonjude's USA Election Map). */
export const MARGIN_STEPS = { safe: 15, likely: 5, lean: 1 };
/** Used only for a model whose predictions.csv leaves projected_margin blank. */
export const PROBABILITY_STEPS = { safe: 0.95, likely: 0.8, lean: 0.6 };

/** Bucket for a margin in points, either sign. */
export function marginBucket(margin: number): Bucket {
  const m = Math.abs(margin);
  return m >= MARGIN_STEPS.safe ? "safe" : m >= MARGIN_STEPS.likely ? "likely" : m >= MARGIN_STEPS.lean ? "lean" : "tilt";
}

export function bucketOf(race: Race): Bucket {
  if (race.margin !== null) return marginBucket(race.margin);
  const p = race.winProbability;
  return p >= PROBABILITY_STEPS.safe ? "safe" : p >= PROBABILITY_STEPS.likely ? "likely" : p >= PROBABILITY_STEPS.lean ? "lean" : "tilt";
}

/**
 * The map is Republican vs the strongest non-Republican (as in decide.py). An independent
 * non-Republican is drawn on the D arm with a hatch: no third hue stays distinguishable from
 * both arms under color-vision deficiency, so the hatch carries that identity instead.
 */
export const sideOf = (race: Race): Side => (race.winner === "R" ? "r" : "d");

/** CSS fill for a race (custom properties defined in styles.css); no race gets the neutral. */
export const fillOf = (race: Race | undefined): string =>
  race ? `var(--${sideOf(race)}-${bucketOf(race)})` : "var(--no-race)";

export const PARTY_NAME: Record<Party, string> = { D: "Democrat", R: "Republican", I: "Independent" };
