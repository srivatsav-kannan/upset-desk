import { useMemo } from "react";
import { CALIBRATION, OUTLOOK, SCORE, TRACK_RECORD, isStrategic, marketProbability, pointsFor, type ChamberOutlook } from "../data/forecast";
import type { RaceView } from "../data/races";
import { PARTY_LONG, lastName, pct } from "../ui/words";

const REPO = "https://github.com/srivatsav-kannan/election-prediction";

/** Points for a correct pick against the market's probability for it. */
function PointsCurve() {
  const W = 520;
  const H = 220;
  const pad = { l: 44, r: 16, t: 14, b: 36 };
  const x = (p: number) => pad.l + (p / 1) * (W - pad.l - pad.r);
  const y = (pts: number) => H - pad.b - (pts / 7) * (H - pad.t - pad.b);
  const path = Array.from({ length: 199 }, (_, i) => (i + 1) / 200)
    .map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(pointsFor(p)).toFixed(1)}`)
    .join("");
  const marks: [number, string][] = [
    [0.9, "90% favorite"],
    [0.5, "Coin flip"],
    [0.25, "25% underdog"],
    [0.05, "5% long shot"],
  ];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points for a correct pick fall as the market's probability rises: 0.15 for a 90% favorite, 1 for a coin flip, 2 for a 25% underdog, 4.3 for a 5% long shot.">
        {[0, 2, 4, 6].map((t) => (
          <g key={t} className="grid">
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text key={t} className="axis" x={x(t)} y={H - pad.b + 18} textAnchor="middle">
            {Math.round(t * 100)}%
          </text>
        ))}
        <defs>
          <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="curve-fill-top" />
            <stop offset="100%" className="curve-fill-bottom" />
          </linearGradient>
        </defs>
        <path d={`${path}L${x(0.995).toFixed(1)},${y(0).toFixed(1)}L${x(0.005).toFixed(1)},${y(0).toFixed(1)}Z`} fill="url(#curve-fill)" />
        <path d={path} className="curve" />
        {marks.map(([p, label]) => (
          <g key={p} className="mark">
            <circle cx={x(p)} cy={y(pointsFor(p))} r={4.5} />
            <text x={x(p) + 9} y={y(pointsFor(p)) - 8}>
              {label}: {pointsFor(p).toFixed(2)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>Points for a correct pick, by the market's probability for that candidate</figcaption>
    </figure>
  );
}

function Calibration({ chamber }: { chamber: "House" | "Senate" }) {
  const bins = CALIBRATION.filter((b) => b.chamber === chamber && b.races > 0);
  const edge = (x: number) => (x < 0.01 ? `${+(x * 100).toFixed(2)}%` : `${Math.round(x * 100)}%`);
  const label = (b: (typeof bins)[number]) => (b.from === 0 ? `Under ${edge(b.to)}` : `${edge(b.from).replace("%", "")}–${edge(b.to)}`);
  return (
    <figure className="chart calib">
      <div className="calib-head">
        <span>Underdog's chance</span>
        <span>Upsets we expected vs. upsets that happened</span>
      </div>
      {bins.map((b) => (
        <div key={b.from} className="calib-row">
          <span className="calib-label">{label(b)}</span>
          {/* Each row on its own scale: the point is expected vs. happened, not one band vs. another. */}
          <div className="calib-bars">
            <div className="calib-bar calib-expected" style={{ width: `${(b.expected / Math.max(b.expected, b.observed, 1e-9)) * 100}%` }} />
            <div className="calib-bar calib-observed" style={{ width: `${(b.observed / Math.max(b.expected, b.observed, 1e-9)) * 100}%` }} />
          </div>
          <span className="calib-num">
            {b.expected.toFixed(1)} <span className="muted">vs</span> {b.observed}
            <span className="muted"> of {b.races}</span>
          </span>
        </div>
      ))}
      <figcaption>
        <span className="key key-expected" /> Expected <span className="key key-observed" /> Happened · {chamber} races, 2010–2022, each year
        predicted without seeing it
      </figcaption>
    </figure>
  );
}

function Seats({ outlook, chamber }: { outlook: ChamberOutlook; chamber: "House" | "Senate" }) {
  const W = 520;
  const H = 180;
  const pad = { l: 8, r: 8, t: 10, b: 30 };
  const seats = outlook.distribution.map(([s]) => s);
  const lo = Math.min(...seats, outlook.needs - 2);
  const hi = Math.max(...seats, outlook.needs + 2);
  const maxP = Math.max(...outlook.distribution.map(([, p]) => p));
  const bw = (W - pad.l - pad.r) / (hi - lo + 1);
  const x = (s: number) => pad.l + (s - lo) * bw;
  const y = (p: number) => H - pad.b - (p / maxP) * (H - pad.t - pad.b);
  const ticks = chamber === "House" ? seats.filter((s) => s % 10 === 0) : seats;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chamber}: Democrats and allied independents win ${outlook.median} seats in the middle simulation, ${outlook.low} to ${outlook.high} in 90% of them, and a majority in ${pct(outlook.pMajority)}.`}>
        {outlook.distribution.map(([s, p]) => (
          <rect
            key={s}
            x={x(s) + bw * 0.08}
            width={bw * 0.84}
            y={y(p)}
            height={H - pad.b - y(p)}
            rx={Math.min(2, bw * 0.2)}
            className={s >= outlook.needs ? "bar-d" : "bar-r"}
          />
        ))}
        <line className="majority" x1={x(outlook.needs) - bw * 0.04} x2={x(outlook.needs) - bw * 0.04} y1={pad.t - 6} y2={H - pad.b + 4} />
        <text className="majority-label" x={x(outlook.needs) + 4} y={pad.t + 4}>
          Majority: {outlook.needs}
        </text>
        {ticks.map((s) => (
          <text key={s} className="axis" x={x(s) + bw / 2} y={H - pad.b + 18} textAnchor="middle">
            {s}
          </text>
        ))}
      </svg>
      <figcaption>
        Seats won by Democrats {chamber === "Senate" && "and allied independents "}across {outlook.simulations.toLocaleString()} simulated elections
        {chamber === "Senate" && ", counting the seats not up this year"}
      </figcaption>
    </figure>
  );
}

/** The three rules for picking against our own forecast (decide.py: EDGE, MIN_CALL_P, the market clause). */
const EDGE = 1.25;
const FLOOR = 0.05;
const breakEven = (m: number) => (EDGE * pointsFor(1 - m)) / (pointsFor(m) + EDGE * pointsFor(1 - m));

type Kind = "strategic" | "forecast" | "left";
interface Dot {
  v: RaceView;
  m: number;
  p: number;
  kind: Kind;
  name: string;
}

/** Every pick against the market, plus the bets the market rule turned down. */
function picksAgainstMarket(views: RaceView[]): Dot[] {
  return views.flatMap((v): Dot[] => {
    const { market, call, candidates } = v.extras;
    if (!market || !call) return [];
    if (call.party !== market.favorite) {
      return [{ v, m: marketProbability(market, call.party), p: call.probability, name: lastName(call.name), kind: isStrategic(v) ? "strategic" : "forecast" }];
    }
    // We stayed with the favorite. Would the underdog have passed every rule except the market one?
    const u = market.favorite === "R" ? v.extras.nonRParty : "R";
    const p = u === "R" ? 1 - v.race.pD : v.race.pD;
    const m = marketProbability(market, u);
    const worth = p * pointsFor(m) >= EDGE * (1 - p) * pointsFor(1 - m);
    if (p >= FLOOR && p <= m && worth && p < 0.5) {
      const name = u === "R" ? candidates.r : candidates.other;
      return [{ v, m, p, name: name ? lastName(name) : PARTY_LONG[u], kind: "left" }];
    }
    return [];
  });
}

/** A short sample of a rule's line, drawn exactly as on the chart. */
function RuleSample({ kind }: { kind: "edge" | "market" | "floor" }) {
  return (
    <svg className="rule-sample" viewBox="0 0 28 10" aria-hidden="true">
      <line className={`rule rule-${kind}`} x1={2} x2={26} y1={5} y2={5} />
    </svg>
  );
}

function PicksChart({ dots }: { dots: Dot[] }) {
  const W = 580;
  const H = 380;
  const pad = { l: 46, r: 78, t: 18, b: 44 };
  const X1 = 0.5;
  const Y1 = 0.85;
  const x = (m: number) => pad.l + (m / X1) * (W - pad.l - pad.r);
  const y = (p: number) => H - pad.b - (p / Y1) * (H - pad.t - pad.b);
  const ms = Array.from({ length: 99 }, (_, i) => 0.005 + i * 0.005);
  const line = (f: (m: number) => number) => ms.map((m, i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(f(m)).toFixed(1)}`).join("");
  const lower = (m: number) => Math.max(m, breakEven(m), FLOOR);
  // The band where a strategic pick qualifies: above all three rules, below even odds.
  const band =
    ms.map((m, i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(Math.min(lower(m), 0.5)).toFixed(1)}`).join("") +
    `L${x(X1).toFixed(1)},${y(0.5).toFixed(1)}L${x(ms[0]).toFixed(1)},${y(0.5).toFixed(1)}Z`;

  // Label the most telling dots first. A label sits right of its dot, or left near the right edge,
  // and is skipped if its box would overlap one already placed or another dot.
  const LABEL_W = 118;
  const placed: { x0: number; x1: number; y: number }[] = [];
  const labels = new Map<string, "start" | "end">();
  const priority = (d: Dot) => (d.kind === "forecast" ? 1 : 0) + (d.p - d.m);
  for (const d of [...dots].filter((d) => d.kind !== "left").sort((a, b) => priority(b) - priority(a))) {
    const [cx, cy] = [x(d.m), y(d.p)];
    // Dots sitting on top of this one (ME-02 and KY-06) share its label rather than block it.
    const others = dots.filter((o) => Math.hypot(x(o.m) - cx, y(o.p) - cy) > 5);
    for (const side of ["start", "end"] as const) {
      const [x0, x1] = side === "start" ? [cx + 8, cx + 8 + LABEL_W] : [cx - 8 - LABEL_W, cx - 8];
      const clear =
        x0 > 2 &&
        x1 < W &&
        placed.every((q) => Math.abs(q.y - cy) > 14 || q.x1 < x0 || q.x0 > x1) &&
        others.every((o) => Math.abs(y(o.p) - cy) > 8 || x(o.m) < x0 - 4 || x(o.m) > x1 + 4);
      if (labels.size < 11 && clear) {
        placed.push({ x0, x1, y: cy });
        labels.set(d.v.id, side);
        break;
      }
    }
  }

  const count = (k: Kind) => dots.filter((d) => d.kind === k).length;
  return (
    <figure className="chart picks-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Our picks against the market. ${count("forecast")} candidates our forecast favors sit above even odds; ${count("strategic")} strategic picks sit in the band above all three rules; ${count("left")} bets fell below the market line and were left out.`}
      >
        <rect className="zone-win" x={x(0)} y={y(Y1)} width={x(X1) - x(0)} height={y(0.5) - y(Y1)} />
        <path className="zone-band" d={band} />
        {[0, 0.25, 0.5, 0.75].map((t) => (
          <g key={t} className="grid">
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {t * 100}%
            </text>
          </g>
        ))}
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => (
          <text key={t} className="axis" x={x(t)} y={H - pad.b + 18} textAnchor="middle">
            {Math.round(t * 100)}%
          </text>
        ))}
        <text className="zone-label" x={x(0.012)} y={y(Y1) + 16}>
          Our forecast favors them
        </text>
        <text className="zone-label zone-label-band" x={x(0.012)} y={y(0.5) + 16}>
          Strategic picks
        </text>
        <line className="even-line" x1={x(0)} x2={x(X1)} y1={y(0.5)} y2={y(0.5)} />
        <path className="rule rule-market" d={line((m) => m)} />
        <path className="rule rule-edge" d={line(breakEven)} />
        <line className="rule rule-floor" x1={x(0)} x2={x(X1)} y1={y(FLOOR)} y2={y(FLOOR)} />
        {/* Each rule is labelled at the right end of its line, in the margin, clear of the dots. */}
        <text className="line-label" x={x(X1) + 8} y={y(breakEven(X1)) + 4}>
          1 · pays off
        </text>
        <text className="line-label" x={x(X1) + 8} y={y(X1) + 6}>
          2 · market
        </text>
        <text className="line-label" x={x(X1) + 8} y={y(FLOOR) + 4}>
          3 · 1 in 20
        </text>
        {dots.map((d) => (
          <g key={d.v.id} className={`pick-dot pick-dot-${d.kind}`}>
            <circle cx={x(d.m)} cy={y(d.p)} r={d.kind === "left" ? 4.5 : 5.5} />
            {labels.has(d.v.id) && (
              <text
                x={labels.get(d.v.id) === "end" ? x(d.m) - 9 : x(d.m) + 9}
                y={y(d.p) + 4}
                textAnchor={labels.get(d.v.id) === "end" ? "end" : "start"}
              >
                {d.name} <tspan className="pick-dot-id">{d.v.id}</tspan>
              </text>
            )}
          </g>
        ))}
        <text className="axis-title" x={(W + pad.l) / 2} y={H - 6} textAnchor="middle">
          The market's chance for the candidate
        </text>
        <text className="axis-title" transform={`translate(12,${(H - pad.b + pad.t) / 2}) rotate(-90)`} textAnchor="middle">
          Our chance
        </text>
      </svg>
      <figcaption className="picks-legend">
        <div className="legend-col">
          <div className="legend-head">Races</div>
          <span>
            <i className="key-dot key-dot-strategic" /> Strategic pick: our forecast expects them to lose, but we back them ({count("strategic")})
          </span>
          <span>
            <i className="key-dot key-dot-forecast" /> Our forecast's favorite, who the market sees as the underdog ({count("forecast")})
          </span>
          <span>
            <i className="key-dot key-dot-left" /> Would pay off, but the market rates them as highly as we do, so we pass ({count("left")})
          </span>
        </div>
        <div className="legend-col">
          <div className="legend-head">Rules a strategic pick has to clear</div>
          <span>
            <RuleSample kind="edge" /> 1 · Backing them pays off on average, by a clear margin
          </span>
          <span>
            <RuleSample kind="market" /> 2 · We rate them above the market
          </span>
          <span>
            <RuleSample kind="floor" /> 3 · We give them at least a 1 in 20 chance
          </span>
        </div>
      </figcaption>
    </figure>
  );
}

export function MethodView({ views }: { views: Map<string, RaceView> }) {
  const list = useMemo(() => [...views.values()], [views]);
  const t = TRACK_RECORD;
  const right = (r: { races: number; wrong: number } | null) => (r ? r.races - r.wrong : 0);
  const share = (r: { races: number; wrong: number } | null) => (r ? `${(((r.races - r.wrong) / r.races) * 100).toFixed(1)}%` : "");
  const dots = useMemo(() => picksAgainstMarket(list), [list]);
  const counts = { strategic: dots.filter((d) => d.kind === "strategic").length, forecast: dots.filter((d) => d.kind === "forecast").length };

  return (
    <article className="method">
      <header className="method-hero">
        <div className="eyebrow">How it works</div>
        <h2>How we forecast every race, and where we bet against the market</h2>
        <p className="lede">
          We forecast all 470 House and Senate races on the 2026 ballot and then choose a candidate to back in each one. Usually that's the
          favorite, but the scoring pays far more for a correct upset than for a safe call, so in a handful of races we back the underdog on
          purpose.
        </p>
      </header>

      <section>
        <div className="eyebrow">The scoring</div>
        <h3>The game</h3>
        <p>
          Each correct pick earns points based on how unlikely the Kalshi prediction market thought it was on November 1, and a wrong pick
          earns nothing. A 90% favorite is worth 0.15 points, a coin flip is worth 1 and a 25% underdog is worth 2, so most of the points on
          offer sit in the races where the market might be wrong.
        </p>
        <PointsCurve />
      </section>

      <section>
        <div className="eyebrow">The evidence</div>
        <h3>Four kinds of evidence</h3>
        <div className="steps">
          <div className="step">
            <span className="step-n">1</span>
            <h4>How the place votes</h4>
            <p>
              We start with how each district voted for president in 2024, redrawn onto its 2026 lines, then shift it by this year's
              national mood (Democrats lead the generic congressional ballot by about 9 points) and give incumbents running again a boost.
            </p>
          </div>
          <div className="step">
            <span className="step-n">2</span>
            <h4>Expert forecasters</h4>
            <p>
              We average up to 11 professional ratings per race from Cook, Sabato's Crystal Ball, Inside Elections and others. They pick
              up candidate quality, fundraising and local polling, which the vote history misses.
            </p>
          </div>
          <div className="step">
            <span className="step-n">3</span>
            <h4>Polls</h4>
            <p>
              We use every public poll from the last four weeks in each Senate race and in the 57 House districts that have them, giving
              more weight to recent and larger polls of the two candidates actually on the ballot.
            </p>
          </div>
          <div className="step">
            <span className="step-n">4</span>
            <h4>Candidates and news</h4>
            <p>
              We researched the 105 most competitive races for scandals, strong recruits and late news, and scored each one on a fixed
              checklist. This moves a race by a point or two at most.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="eyebrow">The track record</div>
        <h3>Weighed by what has worked before</h3>
        <p>
          The weight each kind of evidence gets comes from history. We fit the weights on every House and Senate race from 2010 to 2022,
          and to keep the test honest, each year was predicted using only the other years. Expert ratings turned out to be the strongest
          single signal, and polls help most in well-polled Senate races.
        </p>
        <div className="stats">
          <div className="stat">
            <strong>{share(t.House)}</strong>
            <span>
              of House races called right ({right(t.House).toLocaleString()} of {t.House?.races.toLocaleString()})
            </span>
          </div>
          <div className="stat">
            <strong>{share(t.Senate)}</strong>
            <span>
              of Senate races called right ({right(t.Senate)} of {t.Senate?.races})
            </span>
          </div>
          <div className="stat">
            <strong>{share(t.simple)}</strong>
            <span>of House races with vote history and national mood alone, before experts and polls</span>
          </div>
        </div>
        <p>
          Most races are lopsided, so calling them right is the easy part. For scoring, what matters is whether our odds can be taken at face
          value: if we give a hundred underdogs a 10% chance each, about ten of them should win. The chart groups past races by the chance
          we gave the underdog and compares the upsets we expected with the ones that happened, and in every group the two land close
          together.
        </p>
        <Calibration chamber="House" />
      </section>

      {OUTLOOK.House && OUTLOOK.Senate && (
        <section>
          <div className="eyebrow">The simulation</div>
          <h3>Simulating the election {OUTLOOK.House.simulations.toLocaleString()} times</h3>
          <p>
            Polls and forecasts tend to miss in the same direction in the same year, so we simulate whole elections at once. Each run draws
            one national surprise that every race shares, plus a smaller local surprise for each race.
          </p>
          <div className="duo">
            <div>
              <div className="outlook">
                <strong>{pct(OUTLOOK.House.pMajority)}</strong> chance Democrats win the House
              </div>
              <Seats outlook={OUTLOOK.House} chamber="House" />
            </div>
            <div>
              <div className="outlook">
                <strong>{pct(OUTLOOK.Senate.pMajority)}</strong> chance Democrats and allied independents win the Senate
              </div>
              <Seats outlook={OUTLOOK.Senate} chamber="Senate" />
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="eyebrow">The picks</div>
        <h3>From forecast to picks</h3>
        <p>
          Everything above is the forecast: our honest estimate for each race, and it would be the same however the contest were scored.
          Choosing a candidate to submit is a separate step, because the challenge pays more for calling an unlikely result. A correct pick
          on a 90% favorite is worth 0.15 points, and a correct pick on a 25% underdog is worth 2.
        </p>
        <p>
          In almost every race we pick the candidate our forecast favors. In {counts.forecast} of them that candidate is the market's
          underdog, which makes those picks a plain disagreement with the market. In {counts.strategic} more races we pick a candidate
          our own forecast expects to lose, because backing them is the better bet. We make that kind of pick only when three things are
          all true:
        </p>
        <ol className="rules">
          <li>
            <span className="rule-badge">
              <span className="rule-n">1</span>
              <RuleSample kind="edge" />
            </span>
            <span>
              <strong>It pays off on average, by a clear margin.</strong> Our chance for the underdog, times what a correct pick is worth,
              comes to at least a quarter more than the same sum for the favorite.
            </span>
          </li>
          <li>
            <span className="rule-badge">
              <span className="rule-n">2</span>
              <RuleSample kind="market" />
            </span>
            <span>
              <strong>We rate the underdog above the market.</strong> The scoring is generous enough that a long shot can pay off even at a
              fair price, so this keeps every strategic pick a real disagreement with the market.
            </span>
          </li>
          <li>
            <span className="rule-badge">
              <span className="rule-n">3</span>
              <RuleSample kind="floor" />
            </span>
            <span>
              <strong>The underdog has a real chance.</strong> We give them at least a 1 in 20 shot, so we never back a candidate with no
              realistic path to winning.
            </span>
          </li>
        </ol>
        <PicksChart dots={dots} />
        <p>
          Read each dot by where it sits. Going across is the market's chance for the candidate, and going up is ours, so anything above
          the dashed line is a candidate we like more than the market does. A strategic pick has to sit above all three lines and below
          even odds, which is the gold band. Above even odds our forecast already favors the candidate, so those picks need no special
          rule. The hollow circles would pay off on average, but they sit on or under the dashed line, so we stay with the favorite.
        </p>
        {SCORE.ours && SCORE.favorites && (
          <div className="stats">
            <div className="stat">
              <strong>{SCORE.ours.mean.toFixed(1)}</strong>
              <span>
                points expected with our picks, and {SCORE.ours.low.toFixed(0)} to {SCORE.ours.high.toFixed(0)} in 8 of 10 simulations
              </span>
            </div>
            <div className="stat">
              <strong>{SCORE.favorites.mean.toFixed(1)}</strong>
              <span>points expected from picking every market favorite</span>
            </div>
          </div>
        )}
        <p className="muted">
          All {counts.strategic} strategic picks are Republicans, because in those races the market leans further toward the Democrat than
          our forecast does. They will tend to win or lose together, which is the main risk in this part of the entry.
        </p>
      </section>

      <section>
        <div className="eyebrow">The risks</div>
        <h3>What could go wrong</h3>
        <ul className="risks">
          <li>
            <strong>A single national surprise moves every race.</strong> If Democrats beat their polls, most of our strategic picks miss
            together.
          </li>
          <li>
            <strong>We learned from seven elections.</strong> A national mood this favorable to one party is rarer than most of what the
            model trained on.
          </li>
          <li>
            <strong>Most House races have no polls,</strong> so 378 districts rely on vote history and expert ratings alone.
          </li>
          <li>
            <strong>Alaska's Senate race is our biggest disagreement with the market.</strong> Our forecast favors Dan Sullivan, while Mary Peltola led the August
            primary 49.5% to 41.4%, a result our model doesn't take into account.
          </li>
        </ul>
      </section>

      <footer className="method-foot">
        <p>
          Built for Stanford Democracy Day's Model Citizens challenge. Every number on this site is regenerated from our code and public
          data: past results from the MIT Election Lab and FiveThirtyEight, district lines from the Census Bureau, presidential results by
          district from The Downballot, ratings and polls from Wikipedia, and market odds from Kalshi on November 1.
        </p>
        <p>
          <a href={REPO}>Code and full method on GitHub</a>
        </p>
      </footer>
    </article>
  );
}
