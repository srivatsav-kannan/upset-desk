import type { Chamber } from "../data/models";
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
