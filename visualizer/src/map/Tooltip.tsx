import { useLayoutEffect, useRef, useState } from "react";
import type { Chamber } from "../data/models";
import { LINES_YEARS, type LinesYear } from "../data/redistricting";
import { flipOf, formatPres, presFillOf, shiftLabel } from "./redistricting";
import type { Region, ViewMode } from "./regions";
import { BUCKET_LABEL, PARTY_NAME, bucketOf, fillOf, formatMargin, formatProbability } from "./scale";

export interface TooltipAnchor {
  region: Region;
  /** Viewport coordinates the tooltip sits next to. */
  x: number;
  y: number;
}

const OFFSET = 14;

/** The district's 2024 presidential margin on the shown map, then on both maps if it was redrawn. */
function LinesCard({ region, year, modelName }: { region: Region; year: LinesYear; modelName: string }) {
  const { lines, race } = region;
  if (!lines) return <div className="tooltip-meta">No presidential results</div>;
  const flip = flipOf(lines);
  return (
    <>
      <div className="tooltip-value">{formatPres(lines.vote[year].margin)}</div>
      <div className="tooltip-caption">2024 presidential vote, {year} lines</div>
      {lines.redrawn ? (
        <>
          {LINES_YEARS.map((y) => (
            <div key={y} className={y === year ? "tooltip-row tooltip-row-current" : "tooltip-row"}>
              <span className="line-key" style={{ background: presFillOf(lines.vote[y].margin) }} aria-hidden="true" />
              <span>{y} lines</span>
              <span className="tooltip-num">{formatPres(lines.vote[y].margin)}</span>
            </div>
          ))}
          <div className="tooltip-meta">
            {shiftLabel(lines)}
            {flip && ` · ${flip}`}
          </div>
        </>
      ) : (
        <div className="tooltip-meta">
          Lines unchanged
          {region.stateId === "MO" && ". Missouri's new 2025 map isn't shown: our predictions use its old lines."}
        </div>
      )}
      {race && (
        <div className="tooltip-meta">
          2026 forecast {formatMargin(race)} · {modelName}
        </div>
      )}
    </>
  );
}

interface Props {
  /** Null while nothing is hovered: the box stays mounted, just transparent. */
  anchor: TooltipAnchor | null;
  chamber: Chamber;
  mode: ViewMode;
  year: LinesYear;
  modelName: string;
}

/** Values lead, labels follow: the margin is the strong element, the race name sits above it. */
function TooltipBody({ region, chamber, mode, year, modelName }: Omit<Props, "anchor"> & { region: Region }) {
  const { race, lines } = region;
  return (
    <>
      <div className="tooltip-title">{region.title}</div>
      {mode === "redistricting" ? (
        <LinesCard region={region} year={year} modelName={modelName} />
      ) : race ? (
        <>
          <div className="tooltip-value">{formatMargin(race)}</div>
          <div className="tooltip-row">
            <span className="line-key" style={{ background: fillOf(race) }} aria-hidden="true" />
            <span>{PARTY_NAME[race.winner]}</span>
            <span className="tooltip-num">{formatProbability(race.winProbability)} to win</span>
          </div>
          <div className="tooltip-meta">
            {BUCKET_LABEL[bucketOf(race)]} {race.winner} · {modelName}
          </div>
          {lines?.redrawn && (
            <div className="tooltip-meta">
              Redrawn for 2026: {formatPres(lines.vote[2024].margin)} → {formatPres(lines.vote[2026].margin)} (2024 vote)
            </div>
          )}
          {race.explain.length > 0 && (
            <dl className="tooltip-explain">
              {race.explain.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <div className="tooltip-meta">{chamber === "Senate" ? "No Senate race in 2026" : "No prediction"}</div>
      )}
    </>
  );
}

/**
 * Always mounted, on its own compositor layer, and moved by transform. Mounting or unmounting a
 * composited box makes the browser re-layer the page and re-rasterize the whole map under it,
 * which is what made hovering stutter; this way only the tooltip's own small layer repaints.
 */
export function Tooltip({ anchor, ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const region = anchor?.region;

  // Measure only when the content changes, not on every pointer move: a measurement forces a
  // layout, and pointer moves arrive faster than frames.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !region) return;
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [region, rest.mode, rest.year, rest.modelName]);

  // Keep the box inside the viewport: flip to the other side of the pointer near an edge.
  let left = 0;
  let top = 0;
  if (anchor && size) {
    const { width, height } = size;
    left = Math.max(8, anchor.x + OFFSET + width > window.innerWidth - 8 ? anchor.x - OFFSET - width : anchor.x + OFFSET);
    top = Math.max(8, anchor.y + OFFSET + height > window.innerHeight - 8 ? anchor.y - OFFSET - height : anchor.y + OFFSET);
  }
  return (
    <div
      ref={ref}
      className={anchor && size ? "tooltip" : "tooltip tooltip-hidden"}
      role="status"
      style={{ transform: `translate(${left}px, ${top}px)` }}
    >
      {region && <TooltipBody region={region} {...rest} />}
    </div>
  );
}
