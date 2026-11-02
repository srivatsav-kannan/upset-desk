import { useDeferredValue, useMemo, useState } from "react";
import { isStrategic, marketProbability } from "../data/forecast";
import type { Party } from "../data/models";
import { readingOrder, type RaceView } from "../data/races";
import { bucketOf, fillOf } from "../map/scale";
import { PARTY_LONG, lastName, pct, ratingOf } from "../ui/words";

type Chamber = "All" | "Senate" | "House";
type Filter = "all" | "close" | "strategic" | "flips";

const FILTERS: [Filter, string][] = [
  ["all", "All races"],
  ["close", "Competitive"],
  ["flips", "Changing party"],
  ["strategic", "Strategic picks"],
];

const partyVar = (p: Party) => (p === "R" ? "var(--r-likely)" : "var(--d-likely)");
/** The party that won this seat last time it was on the ballot. */
const lastWinner = (v: RaceView): Party | undefined => v.extras.history?.past[0]?.winner.party;
const flips = (v: RaceView) => {
  const last = lastWinner(v);
  return !!last && (last === "R") !== (v.race.winner === "R");
};

function nameOf(v: RaceView, side: "r" | "other"): string {
  const n = v.extras.candidates[side];
  return n || (side === "r" ? "" : PARTY_LONG[v.extras.nonRParty]);
}

function haystack(v: RaceView): string {
  const c = v.extras.candidates;
  return `${v.stateName} ${v.stateId} ${v.id} ${v.seat} ${c.r} ${c.other} ${v.extras.call?.name ?? ""}`.toLowerCase();
}

interface Props {
  views: Map<string, RaceView>;
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function RacesView({ views, onSelect, selectedId }: Props) {
  const [query, setQuery] = useState("");
  const [chamber, setChamber] = useState<Chamber>("All");
  const [filter, setFilter] = useState<Filter>("all");
  const [descending, setDescending] = useState(false);
  const q = useDeferredValue(query.trim().toLowerCase());
  const all = useMemo(() => [...views.values()], [views]);
  const index = useMemo(() => new Map(all.map((v) => [v.id, haystack(v)])), [all]);

  const rows = useMemo(() => {
    const terms = q.split(/\s+/).filter(Boolean);
    const out = all.filter(
      (v) =>
        (chamber === "All" || v.chamber === chamber) &&
        (filter === "all" ||
          (filter === "close" && (bucketOf(v.race) === "tilt" || bucketOf(v.race) === "lean" || v.race.winProbability < 0.8)) ||
          (filter === "strategic" && isStrategic(v)) ||
          (filter === "flips" && flips(v))) &&
        terms.every((t) => index.get(v.id)?.includes(t)),
    );
    // Z to A flips the states only: within a state the Senate race still comes first.
    return out.sort(descending ? (a, b) => b.stateName.localeCompare(a.stateName) || readingOrder(a, b) : readingOrder);
  }, [all, index, q, chamber, filter, descending]);

  const counts = useMemo(
    () => ({ strategic: all.filter(isStrategic).length, flips: all.filter(flips).length }),
    [all],
  );

  return (
    <div className="races-view">
      <div className="races-tools">
        <label className="search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <span className="visually-hidden">Search races</span>
          <input type="search" placeholder="Search a state, district or candidate" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Chamber">
          {(["All", "Senate", "House"] as Chamber[]).map((c) => (
            <button key={c} type="button" aria-pressed={c === chamber} onClick={() => setChamber(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Show">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" className="chip" aria-pressed={f === filter} onClick={() => setFilter(f)}>
              {label}
              {f === "strategic" && <span className="chip-count">{counts.strategic}</span>}
              {f === "flips" && <span className="chip-count">{counts.flips}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="races-scroll">
        <table className="races">
          <caption className="visually-hidden">2026 races, {rows.length} shown</caption>
          <thead>
            <tr>
              <th scope="col" aria-sort={descending ? "descending" : "ascending"}>
                <button type="button" className="sort-head" onClick={() => setDescending((d) => !d)}>
                  Race
                  <svg viewBox="0 0 12 12" aria-hidden="true" className={descending ? "sort-arrow sort-arrow-down" : "sort-arrow"}>
                    <path d="M6 2.5v7M3 5.5l3-3 3 3" />
                  </svg>
                  <span className="visually-hidden">{descending ? "sorted Z to A" : "sorted A to Z"}</span>
                </button>
              </th>
              <th scope="col">Matchup and our forecast</th>
              <th scope="col">Rating</th>
              <th scope="col">Prediction market</th>
              <th scope="col">Our pick</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const { race, extras } = v;
              const r = nameOf(v, "r");
              const o = nameOf(v, "other");
              const fav = extras.market?.favorite;
              const favName = fav ? (fav === "R" ? r : o) : "";
              return (
                <tr
                  key={v.id}
                  className={v.id === selectedId ? "row-active" : undefined}
                  tabIndex={0}
                  onClick={() => onSelect(v.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(v.id))}
                >
                  <th scope="row">
                    <span className="race-state">{v.stateName}</span>
                    <span className="race-seat">{v.seat}</span>
                  </th>
                  <td>
                    <div className="mini-matchup">
                      <span className={race.winner === "R" ? "mm-name mm-lead" : "mm-name"}>
                        {r && (
                          <>
                            {lastName(r)} <b>{pct(1 - race.pD)}</b>
                          </>
                        )}
                      </span>
                      <span className={race.winner !== "R" ? "mm-name mm-lead mm-right" : "mm-name mm-right"}>
                        {extras.candidates.other && (
                          <>
                            <b>{pct(race.pD)}</b> {lastName(o)}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="split split-thin" aria-hidden="true">
                      <div style={{ flexGrow: 1 - race.pD, background: partyVar("R") }} />
                      <div style={{ flexGrow: race.pD, background: partyVar(extras.nonRParty) }} />
                    </div>
                  </td>
                  <td>
                    <span className="rating-inline">
                      <span className="rating-swatch" style={{ background: fillOf(race) }} aria-hidden="true" />
                      {ratingOf(race)}
                    </span>
                  </td>
                  <td className="muted">
                    {extras.market && fav ? (
                      <>
                        {favName ? lastName(favName) : PARTY_LONG[fav]} {pct(marketProbability(extras.market, fav))}
                      </>
                    ) : (
                      "No market"
                    )}
                  </td>
                  <td>
                    {extras.call && (
                      <span className="call-inline">
                        <span className={`party-dot party-dot-${extras.call.party}`} aria-hidden="true" />
                        {lastName(extras.call.name)}
                        {isStrategic(v) && <span className="badge-upset">Strategic</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty-note">No races match.</p>}
      </div>
    </div>
  );
}
