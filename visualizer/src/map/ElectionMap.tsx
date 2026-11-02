import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, MouseEvent, PointerEvent } from "react";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { Chamber } from "../data/models";
import type { RaceView } from "../data/races";
import type { LinesYear } from "../data/redistricting";
import type { BBox, UsGeometry } from "./geo";
import { formatPres, linesFillOf, shiftLabel } from "./redistricting";
import type { Region, ViewMode } from "./regions";
import { PARTY_NAME, bucketOf, fillOf } from "./scale";
import { pct, ratingOf } from "../ui/words";
import { Tooltip, type TooltipAnchor } from "./Tooltip";

const MAX_ZOOM = 24;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A race flashes on a model switch when this changes: its projected winner or its margin bucket. */
const flashKey = (r: Region) => (r.race ? `${r.race.winner} ${bucketOf(r.race)}` : "");

function ariaLabel(r: Region, mode: ViewMode, year: LinesYear): string {
  if (mode === "redistricting") {
    if (!r.lines) return `${r.title}: no results`;
    const margin = `2024 presidential margin ${formatPres(r.lines.vote[year].margin)}`;
    return r.lines.redrawn ? `${r.title}: ${margin} on the ${year} lines, ${shiftLabel(r.lines)}` : `${r.title}: lines unchanged, ${margin}`;
  }
  if (!r.race) return `${r.title}: no race`;
  const { race } = r;
  return `${r.title}: ${ratingOf(race)}, ${PARTY_NAME[race.winner]} ${pct(race.winProbability)} to win`;
}

/** The colored shapes. Memoized so hovering and zooming never re-render 435 paths. */
const Regions = memo(function Regions({ regions, mode, year }: { regions: Region[]; mode: ViewMode; year: LinesYear }) {
  const byLines = mode === "redistricting";
  return (
    <g className="regions">
      {regions.map((r) => {
        // Redistricting: only redrawn districts are tab stops; the table lists the same set.
        const shown = byLines ? r.lines?.redrawn : r.race;
        return (
          <path
            key={r.id}
            data-id={r.id}
            d={r.d}
            className={shown ? "region" : "region no-race"}
            style={{ fill: byLines ? linesFillOf(r.lines, year) : fillOf(r.race) }}
            tabIndex={shown ? 0 : -1}
            role="img"
            aria-label={ariaLabel(r, mode, year)}
          />
        );
      })}
      {regions
        .filter((r) => !byLines && r.race?.winner === "I")
        .map((r) => (
          <path key={`${r.id}-hatch`} d={r.d} className="hatch" />
        ))}
    </g>
  );
});

const StateBorders = memo(function StateBorders({ geo }: { geo: UsGeometry }) {
  return (
    <g className="state-borders" aria-hidden="true">
      {geo.states.map((s) => (
        <path key={s.id} d={s.d} />
      ))}
    </g>
  );
});

interface Props {
  geo: UsGeometry;
  chamber: Chamber;
  mode: ViewMode;
  /** Redistricting view: which map's lines the regions are drawn on. */
  year: LinesYear;
  regions: Region[];
  views: Map<string, RaceView>;
  /** Forecast view: a click on a state opens it. */
  onState: (stateId: string) => void;
}

export function ElectionMap({ geo, chamber, mode, year, regions, views, onState }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const byId = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const { width: W, height: H } = geo;

  // d3-zoom supplies the gesture math (wheel, drag, pinch, double-click); React renders the transform.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .extent([[0, 0], [W, H]])
      .translateExtent([[0, 0], [W, H]])
      .on("zoom", (e: { transform: ZoomTransform }) => {
        setTransform(e.transform);
        setAnchor(null); // the shapes just moved under the pointer; the next move re-targets
      });
    // Double-click is left alone: a single click already opens (or, for redrawn lines, zooms to) the state.
    select(svg).call(behavior).on("dblclick.zoom", null);
    zoomRef.current = behavior;
    return () => {
      select(svg).on(".zoom", null);
    };
  }, [W, H]);

  const zoomTo = useCallback(
    (t: ZoomTransform) => {
      const svg = svgRef.current;
      const behavior = zoomRef.current;
      if (!svg || !behavior) return;
      select(svg).transition().duration(reducedMotion() ? 0 : 550).call(behavior.transform, t);
    },
    [],
  );

  const fitBox = useCallback(
    ([x0, y0, x1, y1]: BBox) => {
      const k = Math.min(MAX_ZOOM, 0.88 / Math.max((x1 - x0) / W, (y1 - y0) / H));
      zoomTo(zoomIdentity.translate(W / 2 - (k * (x0 + x1)) / 2, H / 2 - (k * (y0 + y1)) / 2).scale(k));
    },
    [W, H, zoomTo],
  );

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior) select(svg).transition().duration(reducedMotion() ? 0 : 250).call(behavior.scaleBy, factor);
  };

  // A tooltip for a state makes no sense once the shapes underneath it change.
  useEffect(() => {
    setAnchor(null);
  }, [regions]);

  // New regions in the same forecast view means the model changed: flash every race whose rating
  // moved. The shapes are dropped when the animation ends; `n` restarts it on the next switch.
  const [flash, setFlash] = useState<{ changed: Region[]; count: number; n: number } | null>(null);
  const prevView = useRef({ chamber, mode, year, regions });
  useEffect(() => {
    const prev = prevView.current;
    prevView.current = { chamber, mode, year, regions };
    if (prev.regions === regions) return;
    if (mode !== "forecast" || prev.mode !== mode || prev.chamber !== chamber || prev.year !== year) {
      setFlash(null);
      return;
    }
    const before = new Map(prev.regions.map((r) => [r.id, flashKey(r)]));
    const changed = regions.filter((r) => before.get(r.id) !== flashKey(r));
    setFlash((f) => ({ changed, count: changed.length, n: (f?.n ?? 0) + 1 }));
  }, [chamber, mode, year, regions]);

  const regionAt = (target: EventTarget | null) => {
    const id = target instanceof Element ? target.getAttribute("data-id") : null;
    return id ? byId.get(id) : undefined;
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.buttons) return; // dragging pans the map; the zoom handler already hid the tooltip
    const region = regionAt(e.target);
    if (region) setAnchor({ region, x: e.clientX, y: e.clientY });
    else if (e.pointerType !== "touch") setAnchor(null);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    // Touch has no hover: a tap shows the tooltip, a tap on empty space clears it.
    const region = regionAt(e.target);
    setAnchor(region ? { region, x: e.clientX, y: e.clientY } : null);
  };

  // Keyboard focus shows the same tooltip as hover. Focus that comes from a click is skipped,
  // so the tooltip stays at the pointer instead of jumping to the shape's center.
  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    const region = regionAt(e.target);
    if (!region || !(e.target instanceof Element) || !e.target.matches(":focus-visible")) return;
    const box = e.target.getBoundingClientRect();
    setAnchor({ region, x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };

  // Forecast: a click opens the state. Redrawn lines: it zooms in, so both maps can be compared there.
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const region = regionAt(e.target);
    if (!region) return;
    if (mode === "forecast") onState(region.stateId);
    else if (transform.k < 1.5) fitBox(region.stateBBox);
  };

  const active = anchor ? byId.get(anchor.region.id) : undefined;
  const zoomed = transform.k > 1.01;
  // The other map's boundaries, dashed, wherever they moved.
  const moved = mode === "redistricting" ? (year === 2026 ? geo.lines2024 : geo.lines2026) : "";
  const label =
    mode === "redistricting"
      ? `Map of House districts on the ${year} lines, redrawn districts colored by 2024 presidential margin.`
      : `Map of 2026 ${chamber} races, colored by how strongly each is favored. Select a state for its races.`;

  return (
    <div className="map-frame">
      <svg
        ref={svgRef}
        className={`map map-${chamber.toLowerCase()}`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={label}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={(e) => e.pointerType !== "touch" && setAnchor(null)}
        onFocus={onFocus}
        onBlur={() => setAnchor(null)}
        onKeyDown={(e) => e.key === "Escape" && setAnchor(null)}
        onClick={onClick}
      >
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" />
          </pattern>
        </defs>
        <g transform={transform.toString()}>
          <Regions regions={regions} mode={mode} year={year} />
          {moved && <path className="moved-lines" d={moved} aria-hidden="true" />}
          {chamber === "House" && <StateBorders geo={geo} />}
        </g>
      </svg>
      {/* Hover ring and change flash live on their own layer, so they never re-rasterize the map. */}
      <svg className="map-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g transform={transform.toString()}>
          {flash && flash.changed.length > 0 && (
            <g
              key={flash.n}
              className="flash"
              onAnimationEnd={() => setFlash((f) => f && { ...f, changed: [] })}
            >
              {flash.changed.map((r) => (
                <path key={r.id} d={r.d} />
              ))}
            </g>
          )}
          {active && <path className="hover-ring" d={active.d} />}
        </g>
      </svg>
      <div className="zoom-controls">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" disabled={!zoomed}>
          −
        </button>
        <button type="button" onClick={() => zoomTo(zoomIdentity)} disabled={!zoomed}>
          Reset
        </button>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {flash && `${flash.count} ${flash.count === 1 ? "race" : "races"} changed rating.`}
      </p>
      <Tooltip anchor={anchor} chamber={chamber} mode={mode} year={year} views={views} />
    </div>
  );
}
