import type { Party, Race } from "../data/models";

export type Bucket = "tilt" | "lean" | "likely" | "safe";
export type Side = "d" | "r";

/** Weakest to strongest. */
export const BUCKETS: Bucket[] = ["tilt", "lean", "likely", "safe"];
export const BUCKET_LABEL: Record<Bucket, string> = { tilt: "Tilt", lean: "Lean", likely: "Likely", safe: "Safe" };

/** Margin buckets in points (the same defaults as jacksonjude's USA Election Map). */
export const MARGIN_STEPS = { safe: 15, likely: 5, lean: 1 };
/** Used only for a model whose predictions.csv leaves projected_margin blank. */
export const PROBABILITY_STEPS = { safe: 0.95, likely: 0.8, lean: 0.6 };

export function bucketOf(race: Race): Bucket {
  if (race.margin !== null) {
    const m = Math.abs(race.margin);
    return m >= MARGIN_STEPS.safe ? "safe" : m >= MARGIN_STEPS.likely ? "likely" : m >= MARGIN_STEPS.lean ? "lean" : "tilt";
  }
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

/** "R+12.3", "D+0.4", "Even"; blank margins fall back to the win probability. */
export function formatMargin(race: Race): string {
  if (race.margin === null) return `${race.winner} ${formatProbability(race.winProbability)}`;
  const m = Math.abs(race.margin);
  return m < 0.05 ? "Even" : `${race.winner}+${m.toFixed(1)}`;
}

export function formatProbability(p: number): string {
  if (p > 0.995) return ">99%";
  if (p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}
