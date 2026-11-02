import type { Party, Race } from "../data/models";
import { bucketOf, type Bucket } from "../map/scale";

/** Plain-language labels for the public site. */

export const PARTY_LONG: Record<Party, string> = { D: "Democrat", R: "Republican", I: "Independent" };
export const PARTY_ADJ: Record<Party, string> = { D: "Democratic", R: "Republican", I: "Independent" };

const RATING: Record<Bucket, string> = { safe: "Safe", likely: "Likely", lean: "Lean", tilt: "Toss-up" };

/** "Safe Republican", "Lean Democratic", "Toss-up". */
export function ratingOf(race: Race): string {
  const b = bucketOf(race);
  return b === "tilt" ? "Toss-up" : `${RATING[b]} ${PARTY_ADJ[race.winner]}`;
}

/** "62%", "<1%", ">99%". */
export function pct(p: number): string {
  if (p >= 0.995) return ">99%";
  if (p <= 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

/** "2.7 points", "less than a point". */
export function points(m: number): string {
  const a = Math.abs(m);
  if (a < 0.95) return "less than a point";
  return `${a.toFixed(a < 10 ? 1 : 0)} points`;
}

/** Margin toward the non-Republican (+) or the Republican (−), as "Republican +2.7". */
export function marginLabel(m: number, nonR: Party = "D"): string {
  if (Math.abs(m) < 0.05) return "Even";
  return `${m > 0 ? PARTY_ADJ[nonR] : "Republican"} +${Math.abs(m).toFixed(1)}`;
}

/** Presidential margin (Democrat minus Republican) as "Trump +10.1" for a year. */
export function presLabel(m: number, year: string): string {
  const [d, r] = year === "2024" ? ["Harris", "Trump"] : year === "2020" ? ["Biden", "Trump"] : ["Clinton", "Trump"];
  if (Math.abs(m) < 0.05) return "Even";
  return `${m > 0 ? d : r} +${Math.abs(m).toFixed(1)}`;
}

/** An expert-rating average, −3 (Safe R) to +3 (Safe D), in words. */
export function expertLabel(r: number, nonR: Party = "D"): string {
  const a = Math.abs(r);
  const side = r > 0 ? PARTY_ADJ[nonR] : "Republican";
  if (a < 0.25) return "a pure toss-up";
  if (a < 0.75) return `a toss-up, tilting ${side}`;
  if (a < 1.5) return `Lean ${side}`;
  if (a < 2.5) return `Likely ${side}`;
  return `Safe ${side}`;
}

/** Last name, for tight spots: "Monica De La Cruz" → "Cruz" is wrong, so particles stay ("De La Cruz"). */
export function lastName(name: string): string {
  if (name.includes("(")) return name.replace(/\s*\(.*\)\s*$/, ""); // a label such as "Republican field (open primary)"
  const parts = name.replace(/,?\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim().split(/\s+/);
  let i = parts.length - 1;
  while (i > 1 && /^(de|la|del|van|von|der|di|da|le|st\.?)$/i.test(parts[i - 1])) i--;
  return parts.slice(Math.max(i, 1)).join(" ") || name;
}
