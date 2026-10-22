import { useEffect, useMemo, useState } from "react";
import { MODELS, MODEL_ERRORS, type Chamber } from "./data/models";
import { ElectionMap } from "./map/ElectionMap";
import { loadGeometry, type UsGeometry } from "./map/geo";
import { Legend } from "./map/Legend";
import { RaceTable } from "./map/RaceTable";
import { regionsFor } from "./map/regions";

const CHAMBERS: Chamber[] = ["Senate", "House"];

/** The view lives in the URL (?model=...&chamber=...) so a link opens the same map. */
function viewFromUrl(): { modelId: string; chamber: Chamber } {
  const q = new URLSearchParams(window.location.search);
  const model = MODELS.find((m) => m.id === q.get("model")) ?? MODELS[0];
  return { modelId: model?.id ?? "", chamber: q.get("chamber") === "senate" ? "Senate" : "House" };
}

export function App() {
  const [view, setView] = useState(viewFromUrl);
  const [geo, setGeo] = useState<UsGeometry | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const model = MODELS.find((m) => m.id === view.modelId);

  useEffect(() => {
    loadGeometry().then(setGeo, (e: unknown) => setGeoError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("model", view.modelId);
    q.set("chamber", view.chamber.toLowerCase());
    window.history.replaceState(null, "", `?${q}`);
  }, [view]);

  const regions = useMemo(() => (geo ? regionsFor(geo, view.chamber, model) : []), [geo, view.chamber, model]);

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
            <button key={c} type="button" aria-pressed={c === view.chamber} onClick={() => setView((v) => ({ ...v, chamber: c }))}>
              {c}
            </button>
          ))}
        </div>
        <button type="button" className="table-toggle" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
          Table
        </button>
      </header>

      <main className="stage">
        {geo ? (
          <>
            <div className="map-view" hidden={showTable}>
              <ElectionMap geo={geo} chamber={view.chamber} regions={regions} modelName={model.name} />
            </div>
            {showTable && <RaceTable regions={regions} chamber={view.chamber} modelName={model.name} />}
          </>
        ) : (
          <p className="status">{geoError ? `Couldn't load the map: ${geoError}` : "Loading map…"}</p>
        )}
      </main>

      {geo && (
        <footer>
          <Legend regions={regions} chamber={view.chamber} />
        </footer>
      )}
    </div>
  );
}
