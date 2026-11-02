import { useCallback, useEffect, useMemo, useState } from "react";
import { OUTLOOK, SUBMISSION_ID } from "./data/forecast";
import { MODELS, MODEL_ERRORS, type Chamber } from "./data/models";
import { raceViews } from "./data/races";
import { LINES_YEARS, loadRedistricting, type LinesYear, type Redistricting } from "./data/redistricting";
import { ElectionMap } from "./map/ElectionMap";
import { loadGeometry, type UsGeometry } from "./map/geo";
import { Legend, RedistrictingLegend } from "./map/Legend";
import { RedistrictingTable } from "./map/RaceTable";
import { shapesMismatch } from "./map/redistricting";
import { regionsFor, type ViewMode } from "./map/regions";
import { TeamBar } from "./ui/TeamBar";
import { pct } from "./ui/words";
import { MethodView } from "./views/MethodView";
import { RacePanel } from "./views/RacePanel";
import { RacesView } from "./views/RacesView";
import { StateView } from "./views/StateView";

type Tab = "map" | "races" | "method";
const TABS: [Tab, string][] = [
  ["map", "Map"],
  ["races", "All races"],
  ["method", "Our prediction strategy"],
];

interface View {
  tab: Tab;
  /** A model folder; the team's submission unless the link names another (for the team's own checks). */
  modelId: string;
  chamber: Chamber;
  mode: ViewMode;
  year: LinesYear;
  state: string | null;
  race: string | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The whole view lives in the URL, so any link reopens exactly what you were looking at. */
function viewFromUrl(): View {
  const q = new URLSearchParams(window.location.search);
  const model = MODELS.find((m) => m.id === q.get("model")) ?? MODELS.find((m) => m.id === SUBMISSION_ID) ?? MODELS[0];
  const tab = (TABS.find(([t]) => t === q.get("tab"))?.[0] ?? "map") as Tab;
  const mode = q.get("view") === "redistricting" ? "redistricting" : "forecast";
  const race = q.get("race");
  return {
    tab,
    modelId: model?.id ?? "",
    chamber: mode === "forecast" && q.get("chamber") === "senate" ? "Senate" : "House",
    mode,
    year: q.get("lines") === "2024" ? 2024 : 2026,
    state: q.get("state")?.toUpperCase().slice(0, 2) ?? null,
    race: race && model?.races.has(race) ? race : null,
  };
}

function urlOf(view: View): string {
  const q = new URLSearchParams();
  if (view.tab !== "map") q.set("tab", view.tab);
  if (view.modelId !== SUBMISSION_ID) q.set("model", view.modelId);
  if (view.tab === "map") {
    q.set("chamber", view.chamber.toLowerCase());
    if (view.mode === "redistricting") q.set("view", "redistricting");
    if (view.mode === "redistricting") q.set("lines", String(view.year));
    if (view.state) q.set("state", view.state);
  }
  if (view.race) q.set("race", view.race);
  const s = q.toString();
  return s ? `?${s}` : window.location.pathname;
}

function Outlook({ chamber, active, onClick }: { chamber: Chamber; active: boolean; onClick: () => void }) {
  const o = OUTLOOK[chamber];
  if (!o) return null;
  const dem = o.pMajority >= 0.5;
  return (
    <button type="button" className={active ? "outlook-card outlook-active" : "outlook-card"} onClick={onClick} aria-pressed={active}>
      <span className="outlook-chamber">{chamber}</span>
      <span className={`outlook-big ${dem ? "text-d" : "text-r"}`}>{pct(dem ? o.pMajority : 1 - o.pMajority)}</span>
      <span className="outlook-text">
        chance {dem ? (chamber === "Senate" ? "Democrats and allied independents win" : "Democrats win") : "Republicans keep"} control
      </span>
      <span className="outlook-seats">
        Typically {o.median} seats, and {o.low} to {o.high} in 9 of 10 simulations
      </span>
    </button>
  );
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  const [geo, setGeo] = useState<UsGeometry | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [redistricting, setRedistricting] = useState<Redistricting | null>(null);
  const [redistrictingError, setRedistrictingError] = useState<string | null>(null);
  const model = MODELS.find((m) => m.id === view.modelId);

  useEffect(() => {
    loadGeometry().then(setGeo, (e: unknown) => setGeoError(message(e)));
    loadRedistricting().then(setRedistricting, (e: unknown) => setRedistrictingError(message(e)));
  }, []);

  useEffect(() => {
    window.history.replaceState(null, "", urlOf(view));
  }, [view]);

  const linesError = redistrictingError ?? (geo && redistricting ? shapesMismatch(geo, redistricting) : null);
  useEffect(() => {
    if (linesError) console.error(linesError);
  }, [linesError]);
  const shownLines = view.mode === "redistricting" && !linesError ? redistricting : null;
  const mode: ViewMode = shownLines ? "redistricting" : "forecast";
  const year: LinesYear = shownLines ? view.year : 2026;

  const regions = useMemo(
    () => (geo ? regionsFor(geo, view.chamber, model, redistricting, year) : []),
    [geo, view.chamber, model, redistricting, year],
  );
  const views = useMemo(() => (model ? raceViews(model) : new Map()), [model]);
  const redrawn = useMemo(() => new Set(geo?.redrawn ?? []), [geo]);
  const linesLoaded = redistricting !== null || redistrictingError !== null;

  const openRace = useCallback((race: string) => setView((v) => ({ ...v, race })), []);
  const closeRace = useCallback(() => setView((v) => ({ ...v, race: null })), []);
  const openState = useCallback((state: string) => setView((v) => ({ ...v, state, race: null })), []);
  const closeState = useCallback(() => setView((v) => ({ ...v, state: null, race: null })), []);
  const selected = view.race ? views.get(view.race) : undefined;

  if (!model) {
    return (
      <main className="empty">
        <p>No forecast found.</p>
        {MODEL_ERRORS.map((e) => (
          <p key={e} className="error">
            {e}
          </p>
        ))}
      </main>
    );
  }

  const ready = geo && linesLoaded;
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={window.location.pathname} onClick={(e) => (e.preventDefault(), setView((v) => ({ ...v, tab: "map", state: null, race: null })))}>
          <span className="brand-dot brand-dot-d" aria-hidden="true" />
          <strong className="brand-name">The Upset Desk</strong>
          <span className="brand-dot brand-dot-r" aria-hidden="true" />
          <span className="brand-sub">2026 Congress forecast</span>
        </a>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([t, label]) => (
            <span key={t} className="tab-wrap">
              <button type="button" aria-current={t === view.tab ? "page" : undefined} onClick={() => setView((v) => ({ ...v, tab: t, race: null }))}>
                {label}
              </button>
              {t === "method" && view.tab !== "method" && (
                <span className="tab-hint" aria-hidden="true">
                  how we did it
                  <svg viewBox="0 0 36 36">
                    <path d="M3 31c12 0 22-8 26-25" />
                    <path d="M23.5 10.5L29.2 5l3.2 7" />
                  </svg>
                </span>
              )}
            </span>
          ))}
        </nav>
      </header>

      {view.tab === "map" && (
        <div className="map-page">
          {!view.state && (
            <div className="hero">
              <Outlook chamber="House" active={view.chamber === "House" && mode === "forecast"} onClick={() => setView((v) => ({ ...v, chamber: "House", mode: "forecast" }))} />
              <Outlook chamber="Senate" active={view.chamber === "Senate"} onClick={() => setView((v) => ({ ...v, chamber: "Senate", mode: "forecast" }))} />
            </div>
          )}
          <div className={view.state ? "workspace workspace-full" : "workspace"}>
            <main className="stage">
              {!ready ? (
                <p className="status">{geoError ? `Couldn't load the map: ${geoError}` : "Loading map…"}</p>
              ) : view.state ? (
                <StateView stateId={view.state} geo={geo} views={views} selectedId={view.race} onSelect={openRace} onBack={closeState} />
              ) : (
                <>
                {mode === "forecast" && (
                  <div className="map-cue" aria-hidden="true">
                    <svg viewBox="0 0 20 20">
                      <path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5L10 2.5z" />
                      <path d="M3.5 6.25L10 10l6.5-3.75M10 10v7.5" />
                    </svg>
                    Click any state to explore it in 3D
                  </div>
                )}
                <ElectionMap
                  geo={geo}
                  chamber={view.chamber}
                  mode={mode}
                  year={year}
                  regions={regions}
                  views={views}
                  onState={openState}
                />
                </>
              )}
            </main>
            {ready && !view.state && (
              <aside className="sidebar">
                {shownLines ? (
                  <>
                    <div className="lines-head">
                      <button type="button" className="back-link" onClick={() => setView((v) => ({ ...v, mode: "forecast" }))}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M10 3L5 8l5 5" />
                        </svg>
                        Back to the forecast
                      </button>
                      <h2>How the House map was redrawn</h2>
                      <div className="segmented" role="group" aria-label="Which map">
                        {LINES_YEARS.map((y) => (
                          <button key={y} type="button" aria-pressed={y === year} onClick={() => setView((v) => ({ ...v, year: y }))}>
                            {y} map
                          </button>
                        ))}
                      </div>
                    </div>
                    <RedistrictingLegend regions={regions} redistricting={shownLines} year={year} />
                    <details className="lines-table">
                      <summary>Every redrawn district</summary>
                      <RedistrictingTable regions={regions} />
                    </details>
                  </>
                ) : (
                  <>
                    <Legend regions={regions} chamber={view.chamber} />
                    {!linesError && redistricting && view.chamber === "House" && (
                      <button
                        type="button"
                        className="story-card"
                        onClick={() => setView((v) => ({ ...v, chamber: "House", mode: "redistricting" }))}
                      >
                        <span className="story-eyebrow">New district lines</span>
                        <span className="story-title">
                          {redistricting.states.length} states redrew {redistricting.states.reduce((n, s) => n + s.redrawn, 0)} House districts for 2026
                        </span>
                        <span className="story-link">Compare the old and new maps →</span>
                      </button>
                    )}
                  </>
                )}
              </aside>
            )}
          </div>
        </div>
      )}

      {view.tab === "races" && <RacesView views={views} onSelect={openRace} selectedId={view.race} />}
      {view.tab === "method" && <MethodView views={views} />}

      <TeamBar />

      {selected && (
        <>
          <div className="scrim" onClick={closeRace} aria-hidden="true" />
          <RacePanel view={selected} redrawn={redrawn.has(selected.stateId)} onClose={closeRace} />
        </>
      )}
    </div>
  );
}
