import type { Chamber } from "../data/models";
import type { LinesYear, Redistricting } from "../data/redistricting";
import { formatSeatChange, presSideOf } from "./redistricting";
import type { Region } from "./regions";
import { BUCKETS, BUCKET_LABEL, MARGIN_STEPS, bucketOf, marginBucket, sideOf, type Bucket, type Side } from "./scale";

function Swatch({ side, bucket, count, party = side === "d" ? "D" : "R" }: { side: Side; bucket: Bucket; count: number; party?: string }) {
  return (
    <li className="swatch" aria-label={`${BUCKET_LABEL[bucket]} ${party}: ${count}`}>
      <span className="swatch-color" style={{ background: `var(--${side}-${bucket})` }} />
      <span className="swatch-label">{BUCKET_LABEL[bucket]}</span>
      <span className="swatch-count">{count}</span>
    </li>
  );
}

/** Diverging key: Republican arm on the left (safe to tilt), non-Republican arm on the right. */
export function Legend({ regions, chamber }: { regions: Region[]; chamber: Chamber }) {
  const counts: Record<Side, Record<Bucket, number>> = {
    d: { tilt: 0, lean: 0, likely: 0, safe: 0 },
    r: { tilt: 0, lean: 0, likely: 0, safe: 0 },
  };
  const wins = { D: 0, R: 0, I: 0 };
  let noRace = 0;
  for (const { race } of regions) {
    if (!race) {
      noRace++;
      continue;
    }
    wins[race.winner]++;
    // Independents are counted on their own (the hatched key), so each arm sums to its party total.
    if (race.winner !== "I") counts[sideOf(race)][bucketOf(race)]++;
  }
  const { lean, likely, safe } = MARGIN_STEPS;

  return (
    <div className="legend">
      <div className="legend-bar">
        <div className="legend-total">
          <span className="legend-total-label">Republican</span>
          <strong>{wins.R}</strong>
        </div>
        <ol className="legend-scale" aria-label="Seats by projected margin">
          {[...BUCKETS].reverse().map((b) => (
            <Swatch key={`r-${b}`} side="r" bucket={b} count={counts.r[b]} />
          ))}
          {BUCKETS.map((b) => (
            <Swatch key={`d-${b}`} side="d" bucket={b} count={counts.d[b]} />
          ))}
        </ol>
        <div className="legend-total legend-total-d">
          <span className="legend-total-label">Democrat</span>
          <strong>{wins.D}</strong>
        </div>
      </div>
      <p className="legend-note">
        <span>
          Projected margin: Tilt under {lean} pt · Lean {lean}–{likely} · Likely {likely}–{safe} · Safe {safe}+
        </span>
        {wins.I > 0 && (
          <span className="legend-extra">
            <span className="swatch-color swatch-hatched" aria-hidden="true" /> Independent ({wins.I})
          </span>
        )}
        {chamber === "Senate" && noRace > 0 && (
          <span className="legend-extra">
            <span className="swatch-color" style={{ background: "var(--no-race)" }} aria-hidden="true" /> No race
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Redistricting key: the redrawn districts on the shown map by 2024 presidential margin, with
 * each arm summing to the seats that candidate carried among them. Below it, the net effect.
 */
export function RedistrictingLegend({ regions, redistricting, year }: { regions: Region[]; redistricting: Redistricting; year: LinesYear }) {
  const counts: Record<Side, Record<Bucket, number>> = {
    d: { tilt: 0, lean: 0, likely: 0, safe: 0 },
    r: { tilt: 0, lean: 0, likely: 0, safe: 0 },
  };
  for (const { lines } of regions) {
    if (lines?.redrawn) counts[presSideOf(lines.vote[year].margin)][marginBucket(lines.vote[year].margin)]++;
  }
  const total = (side: Side) => BUCKETS.reduce((n, b) => n + counts[side][b], 0);
  const redrawn = total("d") + total("r");
  const { trump, states } = redistricting;
  const byChange = [...states].sort((a, b) => b.trump[2026] - b.trump[2024] - (a.trump[2026] - a.trump[2024]) || a.state.localeCompare(b.state));

  return (
    <div className="legend">
      <div className="legend-bar">
        <div className="legend-total">
          <span className="legend-total-label">Trump</span>
          <strong>{total("r")}</strong>
        </div>
        <ol className="legend-scale" aria-label={`Redrawn districts by 2024 presidential margin, ${year} lines`}>
          {[...BUCKETS].reverse().map((b) => (
            <Swatch key={`r-${b}`} side="r" bucket={b} count={counts.r[b]} party="Trump" />
          ))}
          {BUCKETS.map((b) => (
            <Swatch key={`d-${b}`} side="d" bucket={b} count={counts.d[b]} party="Harris" />
          ))}
        </ol>
        <div className="legend-total legend-total-d">
          <span className="legend-total-label">Harris</span>
          <strong>{total("d")}</strong>
        </div>
      </div>
      <p className="legend-note">
        <span>
          2024 presidential margin in the {redrawn} redrawn districts, on the {year} lines
        </span>
        <span className="legend-extra">
          <span className="swatch-dash" aria-hidden="true" /> {year === 2026 ? 2024 : 2026} lines, where they moved
        </span>
        <span className="legend-extra">
          <span className="swatch-color" style={{ background: "var(--no-race)" }} aria-hidden="true" /> Lines unchanged
        </span>
      </p>
      <p className="legend-note">
        <span>
          Trump carried {trump[2024]} seats on the 2024 lines and {trump[2026]} on the 2026 lines ({formatSeatChange(trump[2026] - trump[2024])})
        </span>
        <span>By state: {byChange.map((s) => `${s.state} ${formatSeatChange(s.trump[2026] - s.trump[2024])}`).join(" · ")}</span>
      </p>
    </div>
  );
}
