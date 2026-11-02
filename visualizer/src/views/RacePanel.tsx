import { useEffect, useRef } from "react";
import { marketProbability, pointsFor, type PastRace } from "../data/forecast";
import type { Party } from "../data/models";
import type { RaceView } from "../data/races";
import { fillOf } from "../map/scale";
import { PARTY_ADJ, PARTY_LONG, expertLabel, lastName, marginLabel, pct, points, presLabel, ratingOf } from "../ui/words";

const partyVar = (p: Party) => (p === "R" ? "var(--r-likely)" : "var(--d-likely)");

function Dot({ party }: { party: Party }) {
  return <span className={`party-dot party-dot-${party}`} aria-hidden="true" />;
}

/** A bar from the centre: left for the Republican, right for the non-Republican. */
function Lean({ value, nonR }: { value: number; nonR: Party }) {
  const v = Math.max(-1, Math.min(1, value));
  return (
    <div className="lean" aria-hidden="true">
      <div
        className="lean-fill"
        style={{
          left: v < 0 ? `${50 + v * 50}%` : "50%",
          width: `${Math.abs(v) * 50}%`,
          background: v < 0 ? partyVar("R") : partyVar(nonR),
        }}
      />
      <div className="lean-mid" />
    </div>
  );
}

function Matchup({ view }: { view: RaceView }) {
  const { race, extras } = view;
  const { candidates, market, nonRParty } = extras;
  const pOther = race.pD;
  const sameParty = !market && (!candidates.r || !candidates.other);
  if (sameParty || (market && !candidates.r)) {
    const party: Party = candidates.r ? "R" : nonRParty;
    const name = candidates.r || candidates.other;
    const note = market
      ? "No Republican is on the ballot."
      : `Both candidates on the ballot are ${PARTY_ADJ[party]}s, so the party is settled. We name the June primary leader.`;
    return (
      <div className="matchup">
        <div className="cand cand-lead">
          <Dot party={party} />
          <div className="cand-name">
            {name}
            <span className="cand-party">{PARTY_LONG[party]}</span>
          </div>
          <div className="cand-pct">{pct(party === "R" ? 1 - pOther : pOther)}</div>
        </div>
        <p className="panel-note">{note}</p>
      </div>
    );
  }
  const rows: { party: Party; name: string; p: number }[] = [
    { party: "R" as Party, name: candidates.r || "Republican", p: 1 - pOther },
    { party: nonRParty, name: candidates.other || PARTY_LONG[nonRParty], p: pOther },
  ].sort((a, b) => b.p - a.p);
  return (
    <div className="matchup">
      {rows.map((c, i) => (
        <div key={c.party} className={i === 0 ? "cand cand-lead" : "cand"}>
          <Dot party={c.party} />
          <div className="cand-name">
            {c.name}
            <span className="cand-party">{PARTY_LONG[c.party]}</span>
          </div>
          <div className="cand-pct">{pct(c.p)}</div>
        </div>
      ))}
      <div className="split" aria-hidden="true">
        <div style={{ flexGrow: 1 - pOther, background: partyVar("R") }} />
        <div style={{ flexGrow: pOther, background: partyVar(nonRParty) }} />
      </div>
      {view.stateId === "LA" && view.chamber === "House" && (
        <p className="panel-note">
          Louisiana holds an open primary on Election Day, with every candidate on one ballot. If nobody wins a majority, the top two
          meet in a December runoff.
        </p>
      )}
    </div>
  );
}

function OurCall({ view }: { view: RaceView }) {
  const { race, extras } = view;
  const { call, market, candidates } = extras;
  if (!call) return null;
  const last = lastName(call.name);
  const p = call.probability;
  let headline: string;
  let body: string;
  if (!market) {
    headline = `We pick ${call.name}`;
    body = "No prediction market covers this race, so there are no odds to beat. We pick the likely winner.";
  } else {
    const pm = marketProbability(market, call.party);
    const pts = pointsFor(pm).toFixed(2);
    if (call.party !== race.winner) {
      const fav = race.winner === "R" ? candidates.r : candidates.other;
      const favPts = pointsFor(marketProbability(market, race.winner)).toFixed(2);
      const favLast = fav ? lastName(fav) : PARTY_LONG[race.winner];
      headline = `A calculated long shot: ${call.name}`;
      body =
        p >= pm * 1.15
          ? `Our forecast favors ${favLast}, but the market prices ${last} at just ${pct(pm)}. We think ${last}'s real chance is ` +
            `${pct(p)}, ${(p / pm).toFixed(1)}× the market's, and a win would earn ${pts} points instead of ${favPts}. ` +
            `Bets like this come out ahead across many races.`
          : `${favLast} is the favorite, by our forecast and the market's. But a ${last} win would earn ${pts} points against ` +
            `${favPts} for ${favLast}, so even at our ${pct(p)} chance (the market says ${pct(pm)}), ${last} is worth more points ` +
            `on average. It's a cheap ticket.`;
    } else if (call.party !== market.favorite) {
      headline = `Against the market: ${call.name}`;
      body = `We give ${last} a ${pct(p)} chance; the market gives ${pct(pm)}. If ${last} wins, the call earns ${pts} points.`;
    } else {
      headline = `We pick ${call.name}`;
      body = `The market agrees, at ${pct(pm)}, so a correct call earns ${pts} points.`;
    }
  }
  const upset = !!market && call.party !== market.favorite;
  return (
    <section className={upset ? "call call-upset" : "call"} aria-label="Our submitted pick">
      <div className="call-eyebrow">{upset ? "Upset call" : "Our call"}</div>
      <div className="call-headline">
        <Dot party={call.party} /> {headline}
      </div>
      <p>{body}</p>
    </section>
  );
}

function Factors({ view }: { view: RaceView }) {
  const { race, extras } = view;
  const f = extras.factors;
  if (!f) return null;
  const nonR = extras.nonRParty;
  const rows = [
    {
      label: "How the area votes",
      value: f.lean / 25,
      text:
        `${marginLabel(f.lean, nonR)}, from the 2024 vote and this year's national mood` +
        (f.incumbentRunning ? `, with the ${f.incumbentRunning > 0 ? PARTY_ADJ[nonR] : "Republican"} incumbent running.` : "."),
    },
    {
      label: "Expert forecasters",
      value: (f.rating ?? 0) / 3,
      text: f.rating === null ? "Not rated: the forecasters see it as safe for the favorite." : `${f.raters} forecasters rate it ${expertLabel(f.rating, nonR)} on average.`,
    },
    {
      label: "Polls",
      value: (f.poll ?? 0) / 25,
      text:
        f.poll === null
          ? "No public polls in the last four weeks."
          : `${marginLabel(f.poll, nonR)} on average across ${f.pollsters} ${f.pollsters === 1 ? "pollster" : "pollsters"} in the last four weeks.`,
    },
  ];
  return (
    <section className="panel-section" aria-label="What drives the forecast">
      <h3>What drives the forecast</h3>
      <ul className="factors">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="factor-head">
              <span>{r.label}</span>
              <Lean value={r.value} nonR={nonR} />
            </div>
            <p>{r.text}</p>
          </li>
        ))}
        {f.news && (
          <li>
            <div className="factor-head">
              <span>Candidates &amp; news</span>
              {Math.abs(f.newsShift) >= 0.05 && (
                <span className="factor-tag">
                  {f.newsShift > 0 ? PARTY_ADJ[nonR] : "Republican"} +{Math.abs(f.newsShift).toFixed(1)}
                </span>
              )}
            </div>
            <p>{f.news}</p>
          </li>
        )}
      </ul>
      {race.margin !== null && (
        <p className="factor-total">
          Weighed together by how well each has predicted past races: <strong>{marginLabel(race.margin, nonR)}</strong>, a{" "}
          <strong>{pct(race.winProbability)}</strong> chance for the {PARTY_LONG[race.winner]}.
        </p>
      )}
    </section>
  );
}

function PastRow({ r }: { r: PastRace }) {
  const total = r.winner.pct + (r.runnerUp?.pct ?? 0) || 1;
  return (
    <li className="past-row">
      <span className="past-year">
        {r.year}
        {r.special && <span className="past-special">special</span>}
      </span>
      <div className="past-body">
        <div className="past-names">
          <span>
            <Dot party={r.winner.party} /> {r.winner.name} <b>{r.winner.pct.toFixed(1)}%</b>
          </span>
          {r.runnerUp ? (
            <span className="past-loser">
              {r.runnerUp.name} {r.runnerUp.pct.toFixed(1)}%
            </span>
          ) : (
            <span className="past-loser">Unopposed</span>
          )}
        </div>
        <div className="past-bar" aria-hidden="true">
          <div style={{ flexGrow: r.winner.pct / total, background: partyVar(r.winner.party) }} />
          {r.runnerUp && <div style={{ flexGrow: r.runnerUp.pct / total, background: partyVar(r.runnerUp.party), opacity: 0.45 }} />}
        </div>
      </div>
    </li>
  );
}

function Past({ view, redrawn }: { view: RaceView; redrawn: boolean }) {
  const h = view.extras.history;
  if (!h) return null;
  const pres = Object.entries(h.president)
    .filter((e): e is [string, number] => typeof e[1] === "number")
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  const house = view.chamber === "House";
  return (
    <section className="panel-section" aria-label="Past results">
      <h3>Past results</h3>
      {pres.length > 0 && (
        <div className="pres">
          <span className="pres-label">For president{house ? ", inside the 2026 lines" : ""}</span>
          {pres.map(([y, m]) => (
            <span key={y} className="pres-chip">
              <span className="pres-year">{y}</span> {presLabel(m, y)}
            </span>
          ))}
        </div>
      )}
      {house && redrawn && <p className="panel-note">This district was redrawn for 2026, so the results below are from its old lines.</p>}
      <ol className="past">
        {h.past.map((r, i) => (
          <PastSeries key={`${r.year}-${r.special}`} r={r} divider={house && r.year === 2020 && i > 0} />
        ))}
      </ol>
      {!house && <p className="panel-note">The same Senate seat, each time it was on the ballot.</p>}
    </section>
  );
}

function PastSeries({ r, divider }: { r: PastRace; divider: boolean }) {
  return (
    <>
      {divider && <li className="past-divider">Lines redrawn after the 2020 census</li>}
      <PastRow r={r} />
    </>
  );
}

interface Props {
  view: RaceView;
  redrawn: boolean;
  onClose: () => void;
}

export function RacePanel({ view, redrawn, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.id, onClose]);

  const { race } = view;
  return (
    <aside className="panel" role="dialog" aria-label={view.title} key={view.id}>
      <header className="panel-head">
        <div>
          <div className="eyebrow">
            {view.stateName} · {view.chamber}
          </div>
          <h2>{view.seat}</h2>
        </div>
        <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </header>
      <div className="panel-scroll">
        <div className="rating-pill">
          <span className="rating-swatch" style={{ background: fillOf(race) }} aria-hidden="true" />
          {ratingOf(race)}
          {race.margin !== null && Math.abs(race.margin) >= 0.95 && (
            <span className="rating-margin">projected to win by {points(race.margin)}</span>
          )}
        </div>
        <Matchup view={view} />
        <OurCall view={view} />
        <Factors view={view} />
        <Past view={view} redrawn={redrawn} />
      </div>
    </aside>
  );
}
