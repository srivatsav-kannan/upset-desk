import type { Chamber } from "../data/models";
import { LINES_YEARS } from "../data/redistricting";
import { formatPres, presFillOf, shiftOf, winnerChange } from "./redistricting";
import { byStateThenDistrict, type Region } from "./regions";
import { BUCKET_LABEL, PARTY_NAME, bucketOf, fillOf, formatMargin, formatProbability } from "./scale";

/** The map's table twin: every value the map and tooltip show, readable without hovering. */
export function RaceTable({ regions, chamber, modelName }: { regions: Region[]; chamber: Chamber; modelName: string }) {
  const rows = regions.filter((r) => r.race).sort(byStateThenDistrict);
  return (
    <div className="table-view">
      <table>
        <caption>
          {chamber} predictions · {modelName} · {rows.length} races
        </caption>
        <thead>
          <tr>
            <th scope="col">Race</th>
            <th scope="col">Pick</th>
            <th scope="col" className="num">Margin</th>
            <th scope="col" className="num">Win probability</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, title, race }) =>
            race ? (
              <tr key={id}>
                <th scope="row">{title}</th>
                <td>
                  <span className="line-key" style={{ background: fillOf(race) }} aria-hidden="true" />
                  {PARTY_NAME[race.winner]}
                </td>
                <td className="num">{formatMargin(race)}</td>
                <td className="num">{formatProbability(race.winProbability)}</td>
                <td>
                  {BUCKET_LABEL[bucketOf(race)]} {race.winner}
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The redistricting view's table twin: each redrawn district on both maps, plus the forecast. */
export function RedistrictingTable({ regions, modelName }: { regions: Region[]; modelName: string }) {
  const rows = regions.filter((r) => r.lines?.redrawn).sort(byStateThenDistrict);
  const states = new Set(rows.map((r) => r.stateId)).size;
  return (
    <div className="table-view">
      <table>
        <caption>
          {rows.length} districts in {states} states redrawn for 2026 · 2024 presidential margin on each map (The Downballot) · Forecast: {modelName}
        </caption>
        <thead>
          <tr>
            <th scope="col">District</th>
            <th scope="col" className="num">2024 lines</th>
            <th scope="col" className="num">2026 lines</th>
            <th scope="col" className="num">Shift</th>
            <th scope="col">2024 winner</th>
            <th scope="col" className="num">2026 forecast</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, title, lines, race }) =>
            lines ? (
              <tr key={id}>
                <th scope="row">{title}</th>
                {LINES_YEARS.map((y) => (
                  <td key={y} className="num">
                    <span className="line-key" style={{ background: presFillOf(lines.vote[y].margin) }} aria-hidden="true" />
                    {formatPres(lines.vote[y].margin)}
                  </td>
                ))}
                <td className="num">{formatPres(shiftOf(lines))}</td>
                <td>{winnerChange(lines)}</td>
                <td className="num">{race ? formatMargin(race) : ""}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}
