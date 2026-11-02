import { useMemo } from "react";
import { CALIBRATION, OUTLOOK, SCORE, TRACK_RECORD, marketProbability, pointsFor, type ChamberOutlook } from "../data/forecast";
import type { RaceView } from "../data/races";
import { lastName, pct } from "../ui/words";

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

function UpsetScatter({ views }: { views: RaceView[] }) {
  const pts = views.flatMap((v) => {
    const { market, call } = v.extras;
    if (!market || !call || call.party === market.favorite) return [];
    return [{ v, m: marketProbability(market, call.party), p: call.probability, name: lastName(call.name) }];
  });
  const W = 520;
  const H = 300;
  const pad = { l: 44, r: 16, t: 14, b: 38 };
  const x = (m: number) => pad.l + (m / 0.5) * (W - pad.l - pad.r);
  const y = (p: number) => H - pad.b - p * (H - pad.t - pad.b);
  // Label the biggest disagreements first, skipping any label that would collide with one already placed.
  const placed: { x: number; y: number }[] = [];
  const labelled = new Set<string>();
  for (const d of [...pts].sort((a, b) => b.p - b.m - (a.p - a.m))) {
    const [lx, ly] = [x(d.m), y(d.p)];
    if (placed.length < 6 && placed.every((q) => Math.abs(q.y - ly) > 14 || Math.abs(q.x - lx) > 110)) {
      placed.push({ x: lx, y: ly });
      labelled.add(d.v.id);
    }
  }
  // Our rule's break-even: the long shot's expected points beat the favorite's by EDGE.
  const EDGE = 1.25;
  const breakEven = Array.from({ length: 49 }, (_, i) => 0.01 + i * 0.01)
    .map((m) => [m, (EDGE * pointsFor(1 - m)) / (pointsFor(m) + EDGE * pointsFor(1 - m))] as const)
    .map(([m, p], i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(p).toFixed(1)}`)
    .join("");
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Our ${pts.length} upset calls: each sits above the line where our chance equals the market's.`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
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
        <line className="diagonal" x1={x(0)} y1={y(0)} x2={x(0.5)} y2={y(0.5)} />
        <text className="diagonal-label" x={x(0.5)} y={y(0.5) + 34} textAnchor="end">
          same as the market
        </text>
        <path className="break-even" d={breakEven} />
        <text className="break-even-label" x={x(0.2)} y={y(0.2 * 0.62) + 26}>
          worth the bet above this line
        </text>
        {pts.map((d) => (
          <g key={d.v.id} className={`dot dot-${d.v.extras.call?.party}`}>
            <circle cx={x(d.m)} cy={y(d.p)} r={5} />
            {labelled.has(d.v.id) && (
              <text x={x(d.m) + 8} y={y(d.p) + 4}>
                {d.name} ({d.v.id})
              </text>
            )}
          </g>
        ))}
        <text className="axis-title" x={(W + pad.l) / 2} y={H - 4} textAnchor="middle">
          Market's chance for our pick
        </text>
      </svg>
      <figcaption>Our {pts.length} upset calls: our chance for the candidate (up) against the market's (across). Red: Republican, blue: Democrat.</figcaption>
    </figure>
  );
}

export function MethodView({ views }: { views: Map<string, RaceView> }) {
  const list = useMemo(() => [...views.values()], [views]);
  const t = TRACK_RECORD;
  const right = (r: { races: number; wrong: number } | null) => (r ? r.races - r.wrong : 0);
  const share = (r: { races: number; wrong: number } | null) => (r ? `${(((r.races - r.wrong) / r.races) * 100).toFixed(1)}%` : "");
  const upsets = list.filter((v) => v.extras.market && v.extras.call && v.extras.call.party !== v.extras.market.favorite).length;

  return (
    <article className="method">
      <header className="method-hero">
        <div className="eyebrow">How it works</div>
        <h2>Forecasting 470 races, then betting where the market is wrong</h2>
        <p className="lede">
          We predict every House and Senate race on the 2026 ballot. Then we decide which candidate to pick in each one. Those aren't the
          same thing, and the difference is where the points are.
        </p>
      </header>

      <section>
        <h3>The game</h3>
        <p>
          A correct pick scores more the less likely the prediction market thought it was. Calling a 90% favorite earns 0.15 points. A coin
          flip earns 1, and a 25% underdog earns 2. A wrong pick earns nothing. So the goal isn't only to be right. It's to be right where
          the market isn't.
        </p>
        <PointsCurve />
      </section>

      <section>
        <h3>Four kinds of evidence</h3>
        <div className="steps">
          <div className="step">
            <span className="step-n">1</span>
            <h4>How the place votes</h4>
            <p>
              Each district's 2024 presidential vote on its new 2026 lines, shifted by this year's national mood (Democrats lead the
              generic ballot by about 9 points), plus a boost for incumbents running again.
            </p>
          </div>
          <div className="step">
            <span className="step-n">2</span>
            <h4>Expert forecasters</h4>
            <p>
              Up to 11 professional race ratings per race, from Cook, Sabato's Crystal Ball, Inside Elections and others. They see
              candidate quality, money and local polls that the vote history can't.
            </p>
          </div>
          <div className="step">
            <span className="step-n">3</span>
            <h4>Polls</h4>
            <p>
              Every public poll from the last four weeks, for each Senate race and the 57 House districts that have them, weighted toward
              recent, larger polls of the actual two finalists.
            </p>
          </div>
          <div className="step">
            <span className="step-n">4</span>
            <h4>Candidates and news</h4>
            <p>
              We researched 105 competitive races for scandals, recruits and late news, and scored each on a fixed checklist. It can nudge
              a race by a point or two, never more.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3>Weighed by what has worked before</h3>
        <p>
          We don't choose how much each kind of evidence counts. History does. We fit the weights on every House and Senate race from 2010
          to 2022, and to keep ourselves honest, we predicted each year using only the other years. Expert ratings turned out to be the
          strongest single signal; polls add the most in well-polled Senate races.
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
          Calling most races right is easy; most aren't close. What matters for scoring is whether our odds mean what they say: if we give
          a hundred underdogs a 10% chance each, about ten of them should win. In every band, the upsets landed close to what we expected.
        </p>
        <Calibration chamber="House" />
      </section>

      {OUTLOOK.House && OUTLOOK.Senate && (
        <section>
          <h3>Simulating the election {OUTLOOK.House.simulations.toLocaleString()} times</h3>
          <p>
            Polls and forecasts tend to miss in the same direction in the same year, so we simulate whole elections, not single races.
            Every simulation draws one national surprise shared by every race, plus local surprises.
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
        <h3>From forecast to picks</h3>
        <p>
          In most races we pick the favorite. But long shots pay far more when they hit, and that changes the math. If the market's odds
          were exactly right, an underdog would always be worth more points on average than the favorite. What keeps us from picking every
          underdog is that our forecast is often far more confident in the favorite than the market is.
        </p>
        <p>
          So we take the long shot only where our own odds make it clearly worth it: its expected points must beat the favorite's by at least
          a quarter. That leaves {upsets} upset calls. Some are races where we think the market badly underrates the underdog; others are
          cheap tickets where we roughly agree with the market but a win pays three to six times as much.
        </p>
        <UpsetScatter views={list} />
        {SCORE.ours && SCORE.favorites && (
          <div className="stats">
            <div className="stat">
              <strong>{SCORE.ours.mean.toFixed(1)}</strong>
              <span>
                points expected with our picks (80% of simulations: {SCORE.ours.low.toFixed(0)}–{SCORE.ours.high.toFixed(0)})
              </span>
            </div>
            <div className="stat">
              <strong>{SCORE.favorites.mean.toFixed(1)}</strong>
              <span>points expected by picking every market favorite</span>
            </div>
          </div>
        )}
        <p className="muted">
          Our upset calls lean Republican because the market leans further toward Democrats than our forecast does in those races. They tend
          to win or lose together, which is why we keep only the strongest ones.
        </p>
      </section>

      <section>
        <h3>What could go wrong</h3>
        <ul className="risks">
          <li>
            <strong>One national surprise moves everything.</strong> If Democrats outperform, most of our upset calls miss at once.
          </li>
          <li>
            <strong>Seven elections of history.</strong> A national mood this strong for one party is rarer than most of what we trained
            on.
          </li>
          <li>
            <strong>Most House races have no polls.</strong> 378 districts rest on vote history and expert ratings alone.
          </li>
          <li>
            <strong>Alaska's Senate race.</strong> Our biggest Senate upset call is Dan Sullivan, but Mary Peltola led the August primary
            49.5% to 41.4%, which our model doesn't use.
          </li>
        </ul>
      </section>

      <footer className="method-foot">
        <p>
          Built for Stanford Democracy Day's Model Citizens challenge. Every number on this site is
          regenerated from code and public data: past results from the MIT Election Lab and FiveThirtyEight, district lines from the
          Census Bureau, presidential results by district from The Downballot, ratings and polls from Wikipedia, and market odds from Kalshi
          on November 1.
        </p>
        <p>
          <a href={REPO}>Code and full method on GitHub</a>
        </p>
      </footer>
    </article>
  );
}
