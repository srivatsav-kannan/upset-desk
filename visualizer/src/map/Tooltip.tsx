import { useLayoutEffect, useRef, useState } from "react";
import type { Chamber } from "../data/models";
import type { RaceView } from "../data/races";
import { LINES_YEARS, type LinesYear } from "../data/redistricting";
import { flipOf, formatPres, presFillOf, shiftLabel } from "./redistricting";
import type { Region, ViewMode } from "./regions";
import { PARTY_NAME, fillOf } from "./scale";
import { lastName, pct, ratingOf } from "../ui/words";

export interface TooltipAnchor {
  region: Region;
  /** Viewport coordinates the tooltip sits next to. */
  x: number;
  y: number;
}

const OFFSET = 14;

/** The district's 2024 presidential margin on the shown map, then on both maps if it was redrawn. */
function LinesCard({ region, year }: { region: Region; year: LinesYear }) {
  const { lines, race } = region;
  if (!lines) return <div className="tooltip-meta">No presidential results</div>;
  const flip = flipOf(lines);
  return (
    <>
      <div className="tooltip-value">{formatPres(lines.vote[year].margin)}</div>
      <div className="tooltip-caption">2024 vote for president, inside the {year} lines</div>
      {lines.redrawn ? (
        <>
          {LINES_YEARS.map((y) => (
            <div key={y} className={y === year ? "tooltip-row tooltip-row-current" : "tooltip-row"}>
              <span className="line-key" style={{ background: presFillOf(lines.vote[y].margin) }} aria-hidden="true" />
              <span>{y} map</span>
              <span className="tooltip-num">{formatPres(lines.vote[y].margin)}</span>
            </div>
          ))}
          <div className="tooltip-meta">
            {shiftLabel(lines)}
            {flip && ` · ${flip}`}
          </div>
        </>
      ) : (
        <div className="tooltip-meta">Lines unchanged for 2026</div>
      )}
      {race && <div className="tooltip-meta">2026 forecast: {ratingOf(race)}</div>}
    </>
  );
}

interface Props {
  /** Null while nothing is hovered: the box stays mounted, just transparent. */
  anchor: TooltipAnchor | null;
  chamber: Chamber;
  mode: ViewMode;
  year: LinesYear;
  views: Map<string, RaceView>;
}

/** The leader's name and chance lead; the rating and a hint follow. */
function TooltipBody({ region, chamber, mode, year, views }: Omit<Props, "anchor"> & { region: Region }) {
  const { race } = region;
  const view = race ? views.get(race.raceId) : undefined;
  const leader = view ? (race?.winner === "R" ? view.extras.candidates.r : view.extras.candidates.other) : "";
  return (
    <>
      <div className="tooltip-title">{region.title}</div>
      {mode === "redistricting" ? (
        <LinesCard region={region} year={year} />
      ) : race ? (
        <>
          <div className="tooltip-row tooltip-lead">
            <span className="line-key" style={{ background: fillOf(race) }} aria-hidden="true" />
            <span>{leader ? lastName(leader) : PARTY_NAME[race.winner]}</span>
            <span className="tooltip-num">{pct(race.winProbability)}</span>
          </div>
          <div className="tooltip-meta">{ratingOf(race)}</div>
          <div className="tooltip-hint">Click to explore {region.stateName} in 3D</div>
        </>
      ) : (
        <div className="tooltip-meta">{chamber === "Senate" ? "No Senate race in 2026" : "No forecast"}</div>
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
  }, [region, rest.mode, rest.year]);

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
