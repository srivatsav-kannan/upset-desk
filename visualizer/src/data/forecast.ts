import { parseCsv } from "./csv";
import historyJson from "./history.json";
import type { Party } from "./models";

/**
 * Everything the public site shows beyond a model's predictions.csv, for the team's submission
 * model: our submitted call, both candidates, the market's odds, what drives the forecast, past
 * results and the seat simulation. All of it is read from files the pipeline already writes.
 */

// The submission model is whichever model's portfolio CSV forecast.py copied into submission/.
const callFiles = import.meta.glob<string>("../../../submission/*_portfolio_full_congress.csv", {
  query: "?raw",
  import: "default",
  eager: true,
});
const resultFiles = import.meta.glob<string>(
  [
    "../../../models/*/results/model_vs_kalshi.csv",
    "../../../models/*/results/race_components.csv",
    "../../../models/*/results/race_changes.csv",
    "../../../models/*/results/simulation_summary.csv",
    "../../../models/*/results/seat_distribution.csv",
    "../../../models/*/results/backtest_calibration.csv",
    "../../../models/*/results/backtest_scores.csv",
    "../../../models/*/results/portfolio_summary.csv",
  ],
  { query: "?raw", import: "default", eager: true },
);

const [callPath, callText] = Object.entries(callFiles)[0] ?? ["", ""];
/** Folder name of the submission model, e.g. "house_polls". */
export const SUBMISSION_ID = callPath.match(/submission\/(.+)_portfolio_full_congress\.csv$/)?.[1] ?? "";

const results = (model: string, file: string) => {
  const text = resultFiles[`../../../models/${model}/results/${file}`];
  return text ? parseCsv(text) : [];
};
const num = (s: string | undefined): number | null => (s === undefined || s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

export interface Candidates {
  /** The Republican, when one is on the ballot. */
  r: string;
  /** The strongest non-Republican (a Democrat, or an independent such as Dan Osborn). */
  other: string;
}

export interface Market {
  /** The market's probability that the Republican wins. */
  pR: number;
  favorite: Party;
}

export interface Call {
  party: Party;
  name: string;
  /** Our probability for the candidate we called. */
  probability: number;
}

/** The four inputs behind a forecast, in points of margin (positive = toward the non-Republican). */
export interface Factors {
  lean: number;
  /** Mean expert rating, from -3 (Safe R) to +3 (Safe D). */
  rating: number | null;
  raters: number;
  poll: number | null;
  pollsters: number;
  /** Points the candidate and news research moved the margin. */
  newsShift: number;
  news: string;
  incumbentRunning: -1 | 0 | 1;
}

export interface PastSide {
  name: string;
  party: Party;
  pct: number;
}
export interface PastRace {
  year: number;
  special?: boolean;
  winner: PastSide;
  runnerUp: PastSide | null;
}
export interface History {
  past: PastRace[];
  /** Democrat minus Republican presidential margin (share of the total vote), by year. */
  president: Partial<Record<string, number | null>>;
}

export interface RaceExtras {
  call?: Call;
  candidates: Candidates;
  nonRParty: Party;
  market?: Market;
  factors?: Factors;
  history?: History;
}

const calls = new Map<string, Call>(
  parseCsv(callText).map((r) => [
    r.race_id,
    { party: r.predicted_winner_party as Party, name: r.candidate_name, probability: Number(r.win_probability) },
  ]),
);

const vsMarket = new Map(results(SUBMISSION_ID, "model_vs_kalshi.csv").map((r) => [r.race_id, r]));
// The submission model builds on the ensemble: its inputs per race, plus House district polls.
const components = new Map(results("ensemble", "race_components.csv").map((r) => [r.race_id, r]));
const housePolls = new Map(results(SUBMISSION_ID, "race_changes.csv").map((r) => [r.race_id, r]));
const history = (historyJson as { races: Record<string, History> }).races;

const NO_CANDIDATE = /^No Republican/;

export function extrasFor(raceId: string): RaceExtras {
  const m = vsMarket.get(raceId);
  const c = components.get(raceId);
  const hp = housePolls.get(raceId);
  const nonRParty: Party = c?.non_r_party === "I" ? "I" : "D";
  const pR = num(m?.kalshi_p_r);
  const factors: Factors | undefined = c
    ? {
        lean: Number(c.fundamentals_margin),
        rating: num(c.rating_mean),
        raters: Number(c.raters) || 0,
        poll: hp ? Number(hp.poll_average) : num(c.poll_average),
        pollsters: hp ? Number(hp.pollsters) : Number(c.pollsters) || 0,
        newsShift: num(c.news_adjustment) ?? 0,
        news: c.news_summary ?? "",
        incumbentRunning: (Number(c.incumbent_running) || 0) as -1 | 0 | 1,
      }
    : undefined;
  return {
    call: calls.get(raceId),
    candidates: { r: NO_CANDIDATE.test(m?.name_r ?? "") ? "" : (m?.name_r ?? ""), other: m?.name_non_r ?? "" },
    nonRParty,
    market: m?.kalshi_event && pR !== null ? { pR, favorite: (m.kalshi_favorite || "R") as Party } : undefined,
    factors,
    history: history[raceId],
  };
}

/** Our pick is a candidate our own forecast expects to lose: a strategic pick against the market. */
export function isStrategic(view: { race: { winner: Party }; extras: RaceExtras }): boolean {
  const { call, market } = view.extras;
  return !!call && !!market && call.party !== view.race.winner;
}

/** Points a correct call scores: −log₂ of the market's probability for it, floored at 1%. */
export const pointsFor = (p: number): number => -Math.log2(Math.max(p, 0.01));

/** The market's probability for a party in a race (two-way: the non-Republican gets the rest). */
export const marketProbability = (market: Market, party: Party): number => (party === "R" ? market.pR : 1 - market.pR);

export interface ChamberOutlook {
  /** Seats the Democrats (with allied independents) win in the median simulated election. */
  median: number;
  low: number;
  high: number;
  /** Chance the non-Republicans reach a majority. */
  pMajority: number;
  needs: number;
  simulations: number;
  /** Probability of each seat total. */
  distribution: [number, number][];
}

function outlook(chamber: "House" | "Senate"): ChamberOutlook | null {
  const s = results(SUBMISSION_ID, "simulation_summary.csv").find((r) => r.chamber === chamber && r.scenario === "central");
  if (!s) return null;
  const distribution = results(SUBMISSION_ID, "seat_distribution.csv")
    .filter((r) => r.chamber === chamber && r.scenario === "central")
    .map((r): [number, number] => [Number(r.non_r_seats), Number(r.probability)]);
  return {
    median: Number(s.median),
    low: Number(s.p05),
    high: Number(s.p95),
    pMajority: Number(s.p_non_r_majority),
    needs: Number(s.majority_needs),
    simulations: Number(s.simulations),
    distribution,
  };
}

export const OUTLOOK = { House: outlook("House"), Senate: outlook("Senate") };

export interface CalibrationBin {
  chamber: "House" | "Senate";
  from: number;
  to: number;
  races: number;
  expected: number;
  observed: number;
  lo: number;
  hi: number;
}

/** Out-of-sample calibration of the core model, 2010–2022: how often the underdog won, by our odds. */
export const CALIBRATION: CalibrationBin[] = results("ensemble", "backtest_calibration.csv")
  .filter((r) => r.scope === "House" || r.scope === "Senate")
  .map((r) => ({
    chamber: r.scope as "House" | "Senate",
    from: Number(r.upset_p_from),
    to: Number(r.upset_p_to),
    races: Number(r.races),
    expected: Number(r.expected_upsets),
    observed: Number(r.observed_upsets),
    lo: Number(r.observed_ci95_lo),
    hi: Number(r.observed_ci95_hi),
  }));

/** Races called right out of sample, 2010–2022, by the submission model (House) and the core model (Senate). */
export const TRACK_RECORD = (() => {
  const pick = (model: string, scope: string, variant: string) => {
    const r = results(model, "backtest_scores.csv").find((x) => x.scope === scope && x.variant === variant);
    return r ? { races: Number(r.races), wrong: Number(r.wrong_calls) } : null;
  };
  return {
    House: pick(SUBMISSION_ID, "House", "+house polls") ?? pick("ensemble", "House", "+ratings+polls"),
    Senate: pick("ensemble", "Senate", "+ratings+polls"),
    simple: pick("ensemble", "House", "fundamentals"),
  };
})();

/** Expected score of each way of picking, across the submission model's simulated elections. */
export const SCORE = (() => {
  const rows = results(SUBMISSION_ID, "portfolio_summary.csv").filter((r) => r.scope === "All");
  const get = (pred: (r: Record<string, string>) => boolean) => {
    const r = rows.find(pred);
    return r ? { mean: Number(r.mean), low: Number(r.p10), high: Number(r.p90), upsets: Number(r.underdog_picks) } : null;
  };
  return {
    ours: get((r) => r.chosen === "True"),
    favorites: get((r) => r.strategy === "Kalshi favorite"),
    simulations: Number(rows[0]?.simulations ?? 0),
  };
})();
