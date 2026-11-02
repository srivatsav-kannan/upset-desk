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
      <figcaption>Our {pts.length} upset calls, with our chance for each candidate going up and the market's going across. The gray line marks where we agree with the market, and the gold line is where an upset call starts to pay off under our rule.</figcaption>
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
          Long shots pay much more when they hit, and under this scoring an underdog the market prices fairly is worth more points on average
          than the favorite. We still pick the favorite in almost every race because our forecast is usually more confident in the favorite
          than the market is, which makes the safe call the better bet.
        </p>
        <p>
          We back an underdog only when our own odds make it clearly worth it. Its expected points have to beat the favorite's by at least a
          quarter, and we have to give it at least a 1 in 20 chance, so every upset call is a candidate with a realistic path to winning. That
          leaves {upsets} upset calls. In some of them we think the market badly underrates the underdog, and the rest are cheap tickets where
          we roughly agree with the market but a win pays three or four times as much.
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
          Most of our upset calls are Republicans, because in those races the market leans further toward the Democrat than our forecast
          does. They tend to win or lose together, which is why we keep only the strongest ones.
        </p>
      </section>

      <section>
        <div className="eyebrow">The risks</div>
        <h3>What could go wrong</h3>
        <ul className="risks">
          <li>
            <strong>A single national surprise moves every race.</strong> If Democrats beat their polls, most of our upset calls miss
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
            <strong>Alaska's Senate race is our biggest Senate upset call.</strong> We back Dan Sullivan, while Mary Peltola led the August
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
