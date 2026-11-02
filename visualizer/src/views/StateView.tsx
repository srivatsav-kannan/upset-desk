import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { RaceView } from "../data/races";
import { readingOrder } from "../data/races";
import type { UsGeometry } from "../map/geo";
import { fillOf } from "../map/scale";
import type { Block } from "../three/State3D";
import { webglAvailable } from "../three/webgl";

// three.js is most of the site's weight: it loads only once a state is opened.
const State3D = lazy(() => import("../three/State3D").then((m) => ({ default: m.State3D })));
import { PARTY_LONG, lastName, pct, ratingOf } from "../ui/words";

/** Margins (points) at or beyond this are drawn at full height. */
const MARGIN_CAP = 40;

/** CSS custom properties resolved to colors, re-read when the color scheme flips. */
function useCssColors(): (cssVar: string) => string {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setVersion((v) => v + 1);
    mq.addEventListener("change", bump);
    return () => mq.removeEventListener("change", bump);
  }, []);
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const cache = new Map<string, string>();
    return (value: string) => {
      const name = value.match(/var\((--[\w-]+)\)/)?.[1];
      if (!name) return value;
      if (!cache.has(name)) cache.set(name, style.getPropertyValue(name).trim() || "#888");
      return cache.get(name) ?? "#888";
    };
    // `version` re-reads the variables after a color-scheme change.
  }, [version]);
}

const leaderName = (v: RaceView) => {
  const { r, other } = v.extras.candidates;
  const name = v.race.winner === "R" ? r : other;
  return name || PARTY_LONG[v.race.winner];
};

function RaceCard({ view, active, onSelect }: { view: RaceView; active: boolean; onSelect: () => void }) {
  const { race, extras } = view;
  const upset = !!extras.market && !!extras.call && extras.call.party !== extras.market.favorite;
  return (
    <li>
      <button type="button" className={active ? "race-card race-card-active" : "race-card"} onClick={onSelect}>
        <span className="race-card-seat">
          {view.seat}
          {upset && <span className="badge-upset">Upset call</span>}
        </span>
        <span className="race-card-lead">
          <span className="rating-swatch" style={{ background: fillOf(race) }} aria-hidden="true" />
          <span className="race-card-name">{leaderName(view)}</span>
          <span className="race-card-pct">{pct(race.winProbability)}</span>
        </span>
        <span className="race-card-rating">{ratingOf(race)}</span>
      </button>
    </li>
  );
}

interface Props {
  stateId: string;
  geo: UsGeometry;
  views: Map<string, RaceView>;
  selectedId: string | null;
  onSelect: (raceId: string) => void;
  onBack: () => void;
}

export function StateView({ stateId, geo, views, selectedId, onSelect, onBack }: Props) {
  const color = useCssColors();
  const state = geo.states.find((s) => s.id === stateId);
  const districts = useMemo(() => geo.districts.filter((d) => d.state === stateId), [geo, stateId]);
  const races = useMemo(() => [...views.values()].filter((v) => v.stateId === stateId).sort(readingOrder), [views, stateId]);
  const blocks = useMemo<Block[]>(
    () =>
      districts.map((d) => {
        const v = views.get(d.id);
        return {
          id: d.id,
          d: d.d,
          color: color(fillOf(v?.race)),
          // Height by projected margin, which still varies among seats that are all >99% safe.
          height: v ? (v.race.margin !== null ? Math.min(Math.abs(v.race.margin), MARGIN_CAP) / MARGIN_CAP : Math.abs(v.race.pD - 0.5) * 2) : 0,
        };
      }),
    [districts, views, color],
  );
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [gl] = useState(webglAvailable);
  const house = races.filter((v) => v.chamber === "House");
  const rWins = house.filter((v) => v.race.winner === "R").length;
  const hovered = hover ? views.get(hover.id) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !selectedId && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, selectedId]);

  if (!state) return null;
  const [x0, y0, x1, y1] = state.bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  return (
    <div className="state-view">
      <div className="state-stage">
        <button type="button" className="back-button" onClick={onBack}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3L5 8l5 5" />
          </svg>
          United States
        </button>
        <div className="state-title">
          <h2>{state.name}</h2>
          <p>
            {house.length === 1
              ? `One House seat, ${PARTY_LONG[house[0].race.winner].toLowerCase()} favored`
              : `${house.length} House districts · Republicans favored in ${rWins}, Democrats in ${house.length - rWins}`}
          </p>
        </div>
        {gl ? (
          <Suspense fallback={<div className="state3d" />}>
            <State3D blocks={blocks} selectedId={selectedId} onHover={setHover} onSelect={onSelect} />
          </Suspense>
        ) : (
          <svg className="state-flat" viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`}>
            {districts.map((d) => (
              <path key={d.id} d={d.d} style={{ fill: fillOf(views.get(d.id)?.race) }} onClick={() => onSelect(d.id)} />
            ))}
          </svg>
        )}
        <div className="state-hint" aria-hidden="true">
          {gl ? "Drag to turn · scroll to zoom · taller means a bigger projected win" : "Click a district for details"}
        </div>
        {hovered && hover && (
          <div className="float-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }}>
            <div className="float-tip-title">{hovered.seat}</div>
            <div className="float-tip-line">
              {lastName(leaderName(hovered))} <b>{pct(hovered.race.winProbability)}</b>
            </div>
            <div className="float-tip-meta">{ratingOf(hovered.race)}</div>
          </div>
        )}
      </div>
      <aside className="state-races" aria-label={`${state.name} races`}>
        <ul>
          {races.map((v) => (
            <RaceCard key={v.id} view={v} active={v.id === selectedId} onSelect={() => onSelect(v.id)} />
          ))}
        </ul>
      </aside>
    </div>
  );
}
