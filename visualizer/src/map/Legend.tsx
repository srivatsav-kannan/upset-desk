import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Chamber } from "../data/models";
import type { LinesYear, Redistricting } from "../data/redistricting";
import { formatSeatChange, presSideOf } from "./redistricting";
import type { Region } from "./regions";
import { BUCKETS, BUCKET_LABEL, MARGIN_STEPS, PARTY_NAME, bucketOf, marginBucket, sideOf, type Bucket, type Side } from "./scale";

/** One stacked-bar segment: a party arm's bucket, or the independents. */
interface Segment {
  key: string;
  label: string;
  range: string;
  count: number;
  className: string;
  fill?: string;
}

/** One side of the bar. */
interface Arm {
  /** Heads the arm's end of the bar ("Republican", "Trump"). */
  name: string;
  /** Follows the bucket name in the tooltip ("Safe R", "Safe Trump"). */
  short: string;
  total: number;
  counts: Record<Bucket, number>;
}

/** A segment shorter than this shows its count only in the tooltip and the key. */
const MIN_LABEL_PX = 20;

const { lean, likely, safe } = MARGIN_STEPS;
const RANGE: Record<Bucket, string> = {
  safe: `by ${safe}+`,
  likely: `by ${likely}–${safe}`,
  lean: `by ${lean}–${likely}`,
  tilt: `within ${lean}`,
};

/** Safest Republican at the top, through the tilts (and independents), to safest Democrat at the bottom. */
const R_ORDER: Bucket[] = [...BUCKETS].reverse();
const D_ORDER: Bucket[] = BUCKETS;

const emptyCounts = (): Record<Side, Record<Bucket, number>> => ({
  d: { tilt: 0, lean: 0, likely: 0, safe: 0 },
  r: { tilt: 0, lean: 0, likely: 0, safe: 0 },
});

function KeyRows({ side, order, counts }: { side: Side; order: Bucket[]; counts: Record<Bucket, number> }) {
  return (
    <ul className="legend-rows">
      {order.map((b) => (
        <li key={b}>
          <span className="swatch-color" style={{ background: `var(--${side}-${b})` }} aria-hidden="true" />
          <span className="legend-row-label">
            {BUCKET_LABEL[b]} <span className="legend-range">{RANGE[b]}</span>
          </span>
          <span className="legend-row-count">{counts[b]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Safe-to-tilt for each arm as one vertical stacked bar, with a key beside it in the same order. */
function SeatBar({ r, d, independents, unit }: { r: Arm; d: Arm; independents: number; unit: [string, string] }) {
  const total = r.total + d.total + independents;
  const arm = (side: Side, a: Arm, order: Bucket[]): Segment[] =>
    order.map((b) => ({
      key: `${side}-${b}`,
      label: `${BUCKET_LABEL[b]} ${a.short}`,
      range: `Projected to win ${RANGE[b]} points`,
      count: a.counts[b],
      className: `seat-seg seat-seg-${b}`,
      fill: `var(--${side}-${b})`,
    }));
  const segments = [
    ...arm("r", r, R_ORDER),
    { key: "i", label: PARTY_NAME.I, range: "Any margin", count: independents, className: "seat-seg swatch-hatched" },
    ...arm("d", d, D_ORDER),
  ].filter((s) => s.count > 0);

  // The bar's height decides which counts fit inside their segment.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBarHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [tip, setTip] = useState<{ segment: Segment; top: number } | null>(null);
  const onHover = (segment: Segment) => (e: PointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ segment, top: box.top + box.height / 2 - wrap.top });
  };

  return (
    <div className="legend-body">
      {/* The key beside it carries the same numbers for assistive tech, so the bar itself is decorative. */}
      <div ref={wrapRef} className="seat-bar-wrap" aria-hidden="true">
        <div className="seat-bar" onPointerLeave={() => setTip(null)}>
          {segments.map((s) => (
            <div
              key={s.key}
              className={s.className}
              style={{ flexGrow: s.count, background: s.fill }}
              onPointerEnter={onHover(s)}
              onPointerDown={onHover(s)}
            >
              {s.fill && total > 0 && (barHeight * s.count) / total >= MIN_LABEL_PX && s.count}
            </div>
          ))}
        </div>
        {tip && (
          <div className="seat-tip" style={{ top: tip.top }}>
            <div className="tooltip-title">{tip.segment.label}</div>
            <div className="tooltip-value">
              {tip.segment.count} {tip.segment.count === 1 ? unit[0] : unit[1]}
            </div>
            <div className="tooltip-meta">{tip.segment.range}</div>
          </div>
        )}
      </div>

      <div className="legend-key">
        <div className="legend-group">
          <div className="legend-total">
            <span className="legend-total-label">{r.name}</span>
            <strong>{r.total}</strong>
          </div>
          <KeyRows side="r" order={R_ORDER} counts={r.counts} />
        </div>
        {independents > 0 && (
          <div className="legend-extra-row">
            <span className="swatch-color swatch-hatched" aria-hidden="true" />
            <span className="legend-row-label">{PARTY_NAME.I}</span>
            <span className="legend-row-count">{independents}</span>
          </div>
        )}
        <div className="legend-group">
          <KeyRows side="d" order={D_ORDER} counts={d.counts} />
          <div className="legend-total">
            <span className="legend-total-label">{d.name}</span>
            <strong>{d.total}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Forecast key: seats by projected winner and margin. */
export function Legend({ regions, chamber }: { regions: Region[]; chamber: Chamber }) {
  const counts = emptyCounts();
  const wins = { D: 0, R: 0, I: 0 };
  let noRace = 0;
  for (const { race } of regions) {
    if (!race) {
      noRace++;
      continue;
    }
    wins[race.winner]++;
    // Independents are counted on their own (the hatched segment), so each arm sums to its party total.
    if (race.winner !== "I") counts[sideOf(race)][bucketOf(race)]++;
  }

  return (
    <section className="legend" aria-label="Seats by projected winner">
      <h2 className="legend-title">
        {chamber === "Senate" ? `The ${wins.D + wins.R + wins.I} Senate seats on the ballot` : `All ${wins.D + wins.R + wins.I} House seats`}
        <span>by who's favored, and how strongly</span>
      </h2>
      <SeatBar
        r={{ name: PARTY_NAME.R, short: "R", total: wins.R, counts: counts.r }}
        d={{ name: PARTY_NAME.D, short: "D", total: wins.D, counts: counts.d }}
        independents={wins.I}
        unit={["seat", "seats"]}
      />
      {chamber === "Senate" && noRace > 0 && (
        <p className="legend-note">
          <span className="legend-extra">
            <span className="swatch-color" style={{ background: "var(--no-race)" }} aria-hidden="true" /> No race in {noRace} states
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * Redistricting key: the redrawn districts on the shown map by 2024 presidential margin, with
 * each arm summing to the seats that candidate carried among them. Below it, the net effect.
 */
export function RedistrictingLegend({ regions, redistricting, year }: { regions: Region[]; redistricting: Redistricting; year: LinesYear }) {
  const counts = emptyCounts();
  for (const { lines } of regions) {
    if (lines?.redrawn) counts[presSideOf(lines.vote[year].margin)][marginBucket(lines.vote[year].margin)]++;
  }
  const total = (side: Side) => BUCKETS.reduce((n, b) => n + counts[side][b], 0);
  const redrawn = total("d") + total("r");
  const { trump, states } = redistricting;
  const byChange = [...states].sort((a, b) => b.trump[2026] - b.trump[2024] - (a.trump[2026] - a.trump[2024]) || a.state.localeCompare(b.state));

  return (
    <section className="legend" aria-label={`Redrawn districts by 2024 presidential margin, ${year} lines`}>
      <SeatBar
        r={{ name: "Trump", short: "Trump", total: total("r"), counts: counts.r }}
        d={{ name: "Harris", short: "Harris", total: total("d"), counts: counts.d }}
        independents={0}
        unit={["district", "districts"]}
      />
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
    </section>
  );
}
