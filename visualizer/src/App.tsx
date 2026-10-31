import { useEffect, useMemo, useState } from "react";
import { MODELS, MODEL_ERRORS, type Chamber } from "./data/models";
import { LINES_YEARS, loadRedistricting, type LinesYear, type Redistricting } from "./data/redistricting";
import { ElectionMap } from "./map/ElectionMap";
import { loadGeometry, type UsGeometry } from "./map/geo";
import { Legend, RedistrictingLegend } from "./map/Legend";
import { RaceTable, RedistrictingTable } from "./map/RaceTable";
import { shapesMismatch } from "./map/redistricting";
import { regionsFor, type ViewMode } from "./map/regions";

const CHAMBERS: Chamber[] = ["Senate", "House"];
const MODES: [ViewMode, string][] = [
  ["forecast", "Forecast"],
  ["redistricting", "Redistricting"],
];

interface View {
  modelId: string;
  chamber: Chamber;
  mode: ViewMode;
  year: LinesYear;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The view lives in the URL (?model=...&chamber=...&view=...&lines=...) so a link opens the same
 * map. Redistricting is a House view, so it overrides the chamber.
 */
function viewFromUrl(): View {
  const q = new URLSearchParams(window.location.search);
  const model = MODELS.find((m) => m.id === q.get("model")) ?? MODELS[0];
  const mode = q.get("view") === "redistricting" ? "redistricting" : "forecast";
  return {
    modelId: model?.id ?? "",
    chamber: mode === "forecast" && q.get("chamber") === "senate" ? "Senate" : "House",
    mode,
    year: q.get("lines") === "2024" ? 2024 : 2026,
  };
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  const [geo, setGeo] = useState<UsGeometry | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [redistricting, setRedistricting] = useState<Redistricting | null>(null);
  const [redistrictingError, setRedistrictingError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const model = MODELS.find((m) => m.id === view.modelId);

  useEffect(() => {
    loadGeometry().then(setGeo, (e: unknown) => setGeoError(message(e)));
    loadRedistricting().then(setRedistricting, (e: unknown) => setRedistrictingError(message(e)));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("model", view.modelId);
    q.set("chamber", view.chamber.toLowerCase());
    q.set("view", view.mode);
    if (view.mode === "redistricting") q.set("lines", String(view.year));
    else q.delete("lines");
    window.history.replaceState(null, "", `?${q}`);
  }, [view]);

  // Without its data (or with shapes that don't match it) the redistricting view is unavailable.
  const linesError = redistrictingError ?? (geo && redistricting ? shapesMismatch(geo, redistricting) : null);
  useEffect(() => {
    if (linesError) console.error(linesError);
  }, [linesError]);
  // Non-null exactly when the redistricting view is showing.
  const shownLines = view.mode === "redistricting" && !linesError ? redistricting : null;
  const mode: ViewMode = shownLines ? "redistricting" : "forecast";
  const year: LinesYear = shownLines ? view.year : 2026;

  const regions = useMemo(
    () => (geo ? regionsFor(geo, view.chamber, model, redistricting, year) : []),
    [geo, view.chamber, model, redistricting, year],
  );
  // Wait for the sheets too, so a redistricting link doesn't flash the forecast first.
  const linesLoaded = redistricting !== null || redistrictingError !== null;

  if (!model) {
    return (
      <main className="empty">
        <p>No model predictions found. Each model writes models/&lt;name&gt;/predictions.csv.</p>
        {MODEL_ERRORS.map((e) => (
          <p key={e} className="error">
            {e}
          </p>
        ))}
      </main>
    );
  }

  return (
    <div className="app">
      <header className="controls">
        <h1>2026 Congress</h1>
        <label className="model-picker">
          <span className="visually-hidden">Model</span>
          <select value={model.id} onChange={(e) => setView((v) => ({ ...v, modelId: e.target.value }))}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Chamber">
          {CHAMBERS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === view.chamber}
              onClick={() => setView((v) => ({ ...v, chamber: c, mode: c === "Senate" ? "forecast" : v.mode }))}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="View">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === mode}
              disabled={m === "redistricting" && !!linesError}
              title={m === "redistricting" ? (linesError ?? "House districts redrawn for 2026, on the old and new lines") : undefined}
              onClick={() => setView((v) => ({ ...v, mode: m, chamber: m === "redistricting" ? "House" : v.chamber }))}
            >
              {label}
            </button>
          ))}
        </div>
        {shownLines && (
          <div className="segmented" role="group" aria-label="District lines">
            {LINES_YEARS.map((y) => (
              <button key={y} type="button" aria-pressed={y === year} onClick={() => setView((v) => ({ ...v, year: y }))}>
                {y} lines
              </button>
            ))}
          </div>
        )}
        <button type="button" className="table-toggle" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
          Table
        </button>
      </header>

      <main className="stage">
        {geo && linesLoaded ? (
          <>
            <div className="map-view" hidden={showTable}>
              <ElectionMap geo={geo} chamber={view.chamber} mode={mode} year={year} regions={regions} modelName={model.name} />
            </div>
            {showTable &&
              (shownLines ? (
                <RedistrictingTable regions={regions} modelName={model.name} />
              ) : (
                <RaceTable regions={regions} chamber={view.chamber} modelName={model.name} />
              ))}
          </>
        ) : (
          <p className="status">{geoError ? `Couldn't load the map: ${geoError}` : "Loading map…"}</p>
        )}
      </main>

      {geo && linesLoaded && (
        <footer>
          {shownLines ? (
            <RedistrictingLegend regions={regions} redistricting={shownLines} year={year} />
          ) : (
            <Legend regions={regions} chamber={view.chamber} />
          )}
        </footer>
      )}
    </div>
  );
}
