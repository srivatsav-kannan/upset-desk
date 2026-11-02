import { LINES_YEARS } from "../data/redistricting";
import { formatPres, presFillOf, shiftOf, winnerChange } from "./redistricting";
import { byStateThenDistrict, type Region } from "./regions";
import { ratingOf } from "../ui/words";

/** The redistricting view's table twin: each redrawn district on both maps, plus the forecast. */
export function RedistrictingTable({ regions }: { regions: Region[] }) {
  const rows = regions.filter((r) => r.lines?.redrawn).sort(byStateThenDistrict);
  const states = new Set(rows.map((r) => r.stateId)).size;
  return (
    <div className="table-view">
      <table>
        <caption>
          {rows.length} districts in {states} states redrawn for 2026, with the 2024 vote for president inside the old and new lines
        </caption>
        <thead>
          <tr>
            <th scope="col">District</th>
            <th scope="col" className="num">Old map</th>
            <th scope="col" className="num">2026 map</th>
            <th scope="col" className="num">Shift</th>
            <th scope="col">2024 winner</th>
            <th scope="col">2026 forecast</th>
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
                <td>{race ? ratingOf(race) : ""}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}
