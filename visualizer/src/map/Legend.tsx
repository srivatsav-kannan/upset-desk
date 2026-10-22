import type { Chamber } from "../data/models";
import type { Region } from "./regions";
import { BUCKETS, BUCKET_LABEL, MARGIN_STEPS, bucketOf, sideOf, type Bucket, type Side } from "./scale";

function Swatch({ side, bucket, count }: { side: Side; bucket: Bucket; count: number }) {
  const party = side === "d" ? "D" : "R";
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
