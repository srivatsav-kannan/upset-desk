import { parseCsv } from "./csv";

export type Party = "D" | "R" | "I";
export type Chamber = "Senate" | "House";

export interface Race {
  raceId: string;
  chamber: Chamber;
  /** Projected D - R margin in points (for an independent, non-R - R); null if the model has none. */
  margin: number | null;
  /** Probability that the Democrat (or the strongest non-Republican) wins. */
  pD: number;
  winner: Party;
  /** Probability for `winner`. */
  winProbability: number;
}

export interface Model {
  id: string;
  name: string;
  races: Map<string, Race>;
}

// Every model folder that has a predictions.csv (format: models/README.md) is picked up at
// build time, so a new model appears in the picker as soon as its CSV is committed.
const csvFiles = import.meta.glob<string>("../../../models/*/predictions.csv", {
  query: "?raw",
  import: "default",
  eager: true,
});
const readmes = import.meta.glob<string>("../../../models/*/README.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const FIELDS = ["race_id", "chamber", "projected_margin", "p_d", "predicted_winner_party", "win_probability"];
const RACE_ID = /^[A-Z]{2}-(SEN|AL|\d{2})$/;

/** The model's display name: the first heading of its README, else its folder name. */
function modelName(id: string): string {
  const readme = readmes[`../../../models/${id}/README.md`] ?? "";
  const heading = readme.split(/\r?\n/).find((line) => line.startsWith("# "));
  return heading ? heading.slice(2).trim() : id;
}

function probability(value: string, where: string): number {
  const p = Number(value);
  if (value === "" || !Number.isFinite(p) || p < 0 || p > 1) throw new Error(`${where}: "${value}" is not a probability`);
  return p;
}

function parseModel(path: string, text: string): Model {
  const id = path.split("/").at(-2) ?? path;
  const rows = parseCsv(text);
  const missing = FIELDS.filter((f) => !(f in (rows[0] ?? {})));
  if (missing.length) throw new Error(`${id}/predictions.csv: missing column(s) ${missing.join(", ")}`);
  const races = new Map<string, Race>();
  for (const r of rows) {
    const where = `${id}/predictions.csv ${r.race_id}`;
    if (!RACE_ID.test(r.race_id)) throw new Error(`${where}: bad race_id`);
    if (r.chamber !== "Senate" && r.chamber !== "House") throw new Error(`${where}: bad chamber "${r.chamber}"`);
    if (r.predicted_winner_party !== "D" && r.predicted_winner_party !== "R" && r.predicted_winner_party !== "I") {
      throw new Error(`${where}: bad party "${r.predicted_winner_party}"`);
    }
    const margin = r.projected_margin === "" ? null : Number(r.projected_margin);
    if (margin !== null && !Number.isFinite(margin)) throw new Error(`${where}: bad projected_margin`);
    races.set(r.race_id, {
      raceId: r.race_id,
      chamber: r.chamber,
      margin,
      pD: probability(r.p_d, where),
      winner: r.predicted_winner_party,
      winProbability: probability(r.win_probability, where),
    });
  }
  return { id, name: modelName(id), races };
}

/** Models that failed to parse are left out, with the reason here (and in the console). */
export const MODEL_ERRORS: string[] = [];

export const MODELS: Model[] = Object.entries(csvFiles)
  .flatMap(([path, text]) => {
    try {
      return [parseModel(path, text)];
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      MODEL_ERRORS.push(message);
      return [];
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name));
