// Build the map geometry: src/geo/us-2026.json (SVG paths for states and House districts).
//
//   npm run geo                 # uses cached Census files in data/raw/census/, downloads missing ones
//   npm run geo -- --refresh    # re-downloads them first
//
// Source: US Census Bureau TIGER/Line 2026 congressional districts (cd120 = the 120th Congress,
// i.e. the lines used in 2026), public domain. Districts are clipped to the shoreline using the
// 2025 cartographic-boundary states, simplified with shared borders kept consistent, then
// dissolved into states, so the House and Senate maps line up exactly. Projection: Albers USA
// (Alaska and Hawaii as insets), fitted to a 975 x 610 viewBox.
//
// Lines must match the lines our predictions use (The Downballot's 2026 sheet). They agree in
// every state except Missouri: Census has Missouri's new 2025 map, but The Downballot (and so
// every model) keeps Missouri on its 2022 lines. Missouri is therefore drawn on its 2024
// (cd119) lines; see SAME_AS_2024 below.
//
// Redistricting view: the 2024 lines (cd119) of every state that redrew for 2026, plus each
// map's interior district lines in those states (for the dashed overlay). A state counts as
// redrawn when any district's area changes by more than REDRAWN_AREA_CHANGE between cd119 and
// cd120; unchanged states differ by at most ~0.02% (Census edits). Old and new districts are
// simplified together, so a boundary that didn't move is drawn identically on both maps.

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { geoAlbersUsa, geoArea, geoPath } from "d3-geo";
import mapshaper from "mapshaper";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const RAW = join(REPO, "data", "raw", "census");
const OUT = join(HERE, "..", "src", "geo", "us-2026.json");
const REFRESH = process.argv.includes("--refresh");

const WIDTH = 975;
const HEIGHT = 610;
// Simplification tolerance in meters: coarse enough for a small file, fine enough that city
// districts still read when zoomed in. Override with --interval=<meters>.
const SIMPLIFY_INTERVAL_M = Number(process.argv.find((a) => a.startsWith("--interval="))?.split("=")[1] ?? 1000);
const SAME_AS_2024 = ["29"]; // Missouri: predictions use the pre-2025 map (see header)
// Redrawn states change some district's area by 26% or more; unchanged ones by under 0.02%.
const REDRAWN_AREA_CHANGE = 0.01;

const STATES = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"], "05": ["AR", "Arkansas"],
  "06": ["CA", "California"], "08": ["CO", "Colorado"], "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"],
  "11": ["DC", "District of Columbia"], "12": ["FL", "Florida"], "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"],
  "16": ["ID", "Idaho"], "17": ["IL", "Illinois"], "18": ["IN", "Indiana"], "19": ["IA", "Iowa"],
  "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"], "22": ["LA", "Louisiana"], "23": ["ME", "Maine"],
  "24": ["MD", "Maryland"], "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"], "29": ["MO", "Missouri"], "30": ["MT", "Montana"], "31": ["NE", "Nebraska"],
  "32": ["NV", "Nevada"], "33": ["NH", "New Hampshire"], "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"],
  "36": ["NY", "New York"], "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"], "39": ["OH", "Ohio"],
  "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"], "42": ["PA", "Pennsylvania"], "44": ["RI", "Rhode Island"],
  "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"], "47": ["TN", "Tennessee"], "48": ["TX", "Texas"],
  "49": ["UT", "Utah"], "50": ["VT", "Vermont"], "51": ["VA", "Virginia"], "53": ["WA", "Washington"],
  "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"], "56": ["WY", "Wyoming"],
};

// ---------------------------------------------------------------- cached downloads

async function cached(name, url) {
  mkdirSync(RAW, { recursive: true });
  const hits = readdirSync(RAW).filter((f) => f.startsWith(`${name}_`) && f.endsWith(".zip")).sort();
  if (hits.length && !REFRESH) return join(RAW, hits.at(-1));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const path = join(RAW, `${name}_${new Date().toISOString().slice(0, 10)}.zip`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${relative(REPO, path)}`);
  return path;
}

const lines2026 = {}; // fips -> the file our predictions' lines come from
const lines2024 = {}; // fips -> cd119 (2024 lines), for states not already drawn on them
for (const fips of Object.keys(STATES)) {
  const cd119 = await cached(`tl_2025_${fips}_cd119`, `https://www2.census.gov/geo/tiger/TIGER2025/CD/tl_2025_${fips}_cd119.zip`);
  if (SAME_AS_2024.includes(fips)) {
    lines2026[fips] = cd119;
  } else {
    lines2026[fips] = await cached(`tl_2026_${fips}_cd120`, `https://www2.census.gov/geo/tiger/TIGER2026/CD/tl_2026_${fips}_cd120.zip`);
    lines2024[fips] = cd119;
  }
}
const landFile = await cached("cb_2025_us_state_500k", "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_500k.zip");

const rel = (p) => relative(REPO, p).replaceAll("\\", "/");
const prev = process.cwd();
process.chdir(REPO);

// ---------------------------------------------------------------- which states redrew

// Unsimplified areas of every district on both maps (attributes only, no geometry kept).
const areaRows = JSON.parse(String(Object.values(await mapshaper.applyCommands([
  `-i ${[...Object.values(lines2026), ...Object.values(lines2024)].map(rel).join(" ")} combine-files`,
  `-merge-layers force`,
  `-each "CD = typeof CD120FP == 'string' ? CD120FP : CD119FP, LINES = typeof CD120FP == 'string' ? 2026 : 2024, AREA = this.area"`,
  `-filter "CD != 'ZZ'"`,
  `-filter-fields STATEFP,CD,LINES,AREA`,
  `-o format=json`,
].join(" ")))[0]));
const areas = {}; // fips -> CD -> {2024, 2026}
for (const r of areaRows) {
  if (SAME_AS_2024.includes(r.STATEFP)) continue; // drawn on cd119 for both years
  ((areas[r.STATEFP] ??= {})[r.CD] ??= {})[r.LINES] = r.AREA;
}
const redrawnFips = Object.keys(areas)
  .filter((fips) => Object.values(areas[fips]).some((a) => !a[2024] || !a[2026] || Math.abs(a[2026] / a[2024] - 1) > REDRAWN_AREA_CHANGE))
  .sort();
const isRedrawn = `[${redrawnFips.map((f) => `'${f}'`).join(",")}].includes(STATEFP)`;

// ---------------------------------------------------------------- clip, simplify, dissolve

// One topology for both maps: boundaries that didn't move share arcs, so they simplify alike.
const cmd = [
  `-i ${[...Object.values(lines2026), ...redrawnFips.map((f) => lines2024[f])].map(rel).join(" ")} combine-files`,
  `-merge-layers force name=districts`,
  `-each "CD = typeof CD120FP == 'string' ? CD120FP : CD119FP, LINES = typeof CD120FP == 'string' || !${isRedrawn} ? 2026 : 2024"`,
  `-filter "CD != 'ZZ'"`, // ZZ = water not assigned to any district
  `-filter-fields STATEFP,CD,LINES`,
  `-i ${rel(landFile)} name=land`,
  `-filter "+STATEFP <= 56" target=land`, // 50 states + DC (no territories)
  `-clip land target=districts`,
  `-simplify interval=${SIMPLIFY_INTERVAL_M} keep-shapes target=districts`,
  `-filter "LINES == 2024" + name=districts2024 target=districts`,
  `-filter "LINES == 2026" target=districts`,
  `-dissolve STATEFP copy-fields= + name=states target=districts`,
  `-filter "CD != '98'" target=districts`, // 98 = DC's non-voting delegate: a state shape, not a race
  // Interior district lines of each map in the redrawn states; state borders are left out.
  `-filter "${isRedrawn}" + name=lines2026 target=districts`,
  `-innerlines where="A.STATEFP == B.STATEFP" target=lines2026`,
  `-innerlines where="A.STATEFP == B.STATEFP" + name=lines2024 target=districts2024`,
  `-o format=geojson precision=0.00001 target=districts,states,districts2024,lines2024,lines2026`,
].join(" ");

const files = await mapshaper.applyCommands(cmd);
process.chdir(prev);

const layer = (name) => JSON.parse(String(Object.entries(files).find(([f]) => f.replace(/\.json$/, "") === name)[1]));
const districts = layer("districts");
const states = layer("states");
const districts2024 = layer("districts2024");

// d3-geo is spherical: a polygon whose rings wind the "wrong" way covers the rest of the globe.
// Simplification can flip a ring's winding, so flip back any polygon larger than a hemisphere.
function rewind(geometry) {
  const fix = (rings) => (geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings);
  if (geometry.type === "Polygon") geometry.coordinates = fix(geometry.coordinates);
  if (geometry.type === "MultiPolygon") geometry.coordinates = geometry.coordinates.map(fix);
}
for (const f of [...districts.features, ...states.features, ...districts2024.features]) rewind(f.geometry);

// ---------------------------------------------------------------- project to SVG paths

const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], states);
const path = geoPath(projection).digits(1);
const box = (f) => path.bounds(f).flat().map((v) => Math.round(v * 10) / 10);
const district = (f) => {
  const st = STATES[f.properties.STATEFP][0];
  return { id: `${st}-${f.properties.CD === "00" ? "AL" : f.properties.CD}`, state: st, bbox: box(f), d: path(f) };
};

const outStates = states.features
  .map((f) => ({ id: STATES[f.properties.STATEFP][0], name: STATES[f.properties.STATEFP][1], bbox: box(f), d: path(f) }))
  .sort((a, b) => a.id.localeCompare(b.id));
const outDistricts = districts.features.map(district).sort((a, b) => a.id.localeCompare(b.id));
const outDistricts2024 = districts2024.features.map(district).sort((a, b) => a.id.localeCompare(b.id));
const redrawn = redrawnFips.map((f) => STATES[f][0]).sort();

// The overlay shows only where a boundary moved: the segments of one map's interior lines that
// the other map doesn't share. Shared boundaries have identical coordinates (one topology).
// mapshaper writes an attribute-less layer as a GeometryCollection.
const lineStrings = (layer) =>
  (layer.geometries ?? layer.features.map((f) => f.geometry)).flatMap((g) =>
    g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [],
  );
const segment = (a, b) => [String(a), String(b)].sort().join(" ");
function moved(lines, other) {
  const unmoved = new Set(lineStrings(other).flatMap((l) => l.slice(1).map((p, i) => segment(l[i], p))));
  const runs = [];
  for (const line of lineStrings(lines)) {
    let run = [line[0]];
    for (let i = 1; i < line.length; i++) {
      if (!unmoved.has(segment(line[i - 1], line[i]))) {
        run.push(line[i]);
        continue;
      }
      if (run.length > 1) runs.push(run);
      run = [line[i]];
    }
    if (run.length > 1) runs.push(run);
  }
  return { type: "MultiLineString", coordinates: runs };
}
const outLines2024 = path(moved(layer("lines2024"), layer("lines2026"))) ?? "";
const outLines2026 = path(moved(layer("lines2026"), layer("lines2024"))) ?? "";

const ids = new Set(outDistricts.map((d) => d.id));
if (outStates.length !== 51) throw new Error(`expected 51 states incl. DC, got ${outStates.length}`);
if (outDistricts.length !== 435 || ids.size !== 435) throw new Error(`expected 435 unique districts, got ${outDistricts.length}`);
for (const f of [...outStates, ...outDistricts, ...outDistricts2024]) if (!f.d) throw new Error(`${f.id}: empty path after projection`);
const stateBox = Object.fromEntries(outStates.map((s) => [s.id, s.bbox]));
for (const d of [...outDistricts, ...outDistricts2024]) {
  const [x0, y0, x1, y1] = stateBox[d.state];
  const inside = d.bbox[0] >= x0 - 1 && d.bbox[1] >= y0 - 1 && d.bbox[2] <= x1 + 1 && d.bbox[3] <= y1 + 1;
  if (!inside) throw new Error(`${d.id}: bounds ${d.bbox} fall outside ${d.state}'s ${stateBox[d.state]} (bad winding?)`);
}
// No reapportionment mid-decade: a redrawn state has the same district IDs on both maps.
const idsIn = (list, st) => list.filter((d) => d.state === st).map((d) => d.id).join(" ");
for (const st of redrawn) {
  if (idsIn(outDistricts2024, st) !== idsIn(outDistricts, st)) {
    throw new Error(`${st}: 2024 districts (${idsIn(outDistricts2024, st)}) don't match 2026 (${idsIn(outDistricts, st)})`);
  }
}
if (redrawn.length && !(outLines2024 && outLines2026)) throw new Error("redrawn states but no interior district lines");

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify({
  source: "US Census Bureau TIGER/Line 2026 cd120 (Missouri: 2025 cd119), clipped to cb_2025_us_state_500k; " +
    "2024 lines of redrawn states: TIGER/Line 2025 cd119",
  width: WIDTH,
  height: HEIGHT,
  states: outStates,
  districts: outDistricts,
  redrawn,
  districts2024: outDistricts2024,
  lines2024: outLines2024,
  lines2026: outLines2026,
});
writeFileSync(OUT, json + "\n");
const vertices = (json.match(/[ML]/g) || []).length;
console.log(`wrote ${rel(OUT)}: ${outStates.length} states, ${outDistricts.length} districts, ` +
  `${outDistricts2024.length} districts on the 2024 lines of ${redrawn.length} redrawn states (${redrawn.join(" ")}), ` +
  `~${vertices.toLocaleString()} path commands, ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
