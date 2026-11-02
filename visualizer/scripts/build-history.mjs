#!/usr/bin/env node
/**
 * Builds src/data/history.json: past results for every 2026 race, for the race panel.
 *
 *   npm run history
 *
 * Reads the newest raw files the Python pipeline already downloaded (never edits them):
 * - data/raw/fivethirtyeight/election_results_{house,senate,presidential}_*.csv (538's archive):
 *   House results by district number since 2012, the Senate seat's past races (same class),
 *   and each state's presidential margin.
 * - data/raw/downballot/downballot_2026_lines_*.csv: the 2024 and 2020 presidential margin
 *   inside each district's 2026 lines.
 * - submission/templates/full_congress_track_template.csv: the race ids.
 *
 * A district number's past winners sat on older lines (2012, 2022 and mid-decade redraws), so
 * the panel labels the lines; the presidential margins are always on the 2026 lines.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RAW = join(ROOT, "data", "raw");
const OUT = join(HERE, "..", "src", "data", "history.json");
const HOUSE_FROM = 2012; // the first cycle on post-2010-census lines
const PRES_YEARS = [2016, 2020, 2024];
// 2026's regular Senate seats are Class II (last up 2020, 2014, 2008); the OH and FL specials are Class III.
const SPECIALS = new Set(["OH-SEN", "FL-SEN"]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

const records = (rows) => {
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
};

function newest(folder, prefix) {
  const hits = readdirSync(join(RAW, folder)).filter((f) => /_\d{4}-\d{2}-\d{2}\.csv$/.test(f) && f.startsWith(prefix)).sort();
  if (!hits.length) throw new Error(`no ${folder}/${prefix}*.csv: run python3 forecast.py first`);
  return join(RAW, folder, hits.at(-1));
}

const read = (folder, prefix) => records(parseCsv(readFileSync(newest(folder, prefix), "utf8")));
const PARTY = { DEM: "D", DFL: "D", REP: "R" };
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * One contest's result: the final stage (runoff, else general, else a Louisiana-style jungle
 * primary) and the final ranked-choice round. Fusion candidates (NY, CT) appear once per
 * ballot line: their votes are summed and they take their major party.
 */
function result(rows) {
  const stage = ["runoff", "general", "jungle primary"].find((s) => rows.some((r) => r.stage === s));
  let pick = rows.filter((r) => r.stage === stage);
  const rounds = pick.map((r) => Number(r.ranked_choice_round) || 0);
  pick = pick.filter((r) => (Number(r.ranked_choice_round) || 0) === Math.max(...rounds));
  const byCand = new Map();
  for (const r of pick) {
    const c = byCand.get(r.candidate_id) ?? { name: r.candidate_name, party: "I", votes: 0, pct: 0, won: false, unopposed: false };
    if (PARTY[r.ballot_party]) c.party = PARTY[r.ballot_party];
    c.votes += Number(r.votes) || 0;
    c.pct += Number(r.percent) || 0;
    c.won ||= r.winner === "true";
    c.unopposed ||= r.unopposed === "true";
    byCand.set(r.candidate_id, c);
  }
  const cands = [...byCand.values()].sort((a, b) => b.won - a.won || b.pct - a.pct);
  const [w, l] = cands;
  if (!w?.won) return null;
  const side = (c) => (c ? { name: c.name, party: c.party, pct: round1(c.pct) } : null);
  return { winner: side(w), runnerUp: w.unopposed ? null : side(l) };
}

function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    if (k) out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

const raceIds = records(parseCsv(readFileSync(join(ROOT, "submission", "templates", "full_congress_track_template.csv"), "utf8"))).map((r) => r.race_id);
const atLarge = new Set(raceIds.filter((id) => id.endsWith("-AL")).map((id) => id.slice(0, 2)));

// House: each district number's past general elections (not specials).
const house = read("fivethirtyeight", "election_results_house_").filter((r) => Number(r.cycle) >= HOUSE_FROM && r.special !== "true" && Number(r.cycle) % 2 === 0);
const houseBy = groupBy(house, (r) => {
  const n = r.office_seat_name.match(/District (\d+)/)?.[1];
  const id = atLarge.has(r.state_abbrev) ? `${r.state_abbrev}-AL` : n ? `${r.state_abbrev}-${n.padStart(2, "0")}` : null;
  return id && `${id}|${r.cycle}`;
});

// Senate: the same seat's past races (by class), specials for that class included.
const senate = read("fivethirtyeight", "election_results_senate_").filter((r) => Number(r.cycle) >= 2002);
const senateBy = groupBy(senate, (r) => `${r.state_abbrev}|${r.office_seat_name}|${r.cycle}|${r.special}`);

// Presidential margin by state (Democrat minus Republican, share of the total vote).
const pres = read("fivethirtyeight", "election_results_presidential_").filter((r) => PRES_YEARS.includes(Number(r.cycle)) && r.stage === "general");
const presBy = groupBy(pres, (r) => `${r.state_abbrev}|${r.cycle}`);
const stateMargin = (st, y) => {
  const rows = presBy.get(`${st}|${y}`);
  if (!rows) return null;
  const share = (p) => rows.filter((r) => PARTY[r.ballot_party] === p).reduce((s, r) => s + Number(r.percent || 0), 0);
  return round1(share("D") - share("R"));
};

// Presidential margin inside each district's 2026 lines (The Downballot).
const sheet = parseCsv(readFileSync(newest("downballot", "downballot_2026_lines_"), "utf8"));
const districtPres = new Map();
for (const r of sheet) {
  if (!/^[A-Z]{2}-(\d{2}|AL)$/.test(r[0] ?? "")) continue;
  const pct = (s) => (s && s.trim() ? round1(Number(s.replace("%", ""))) : null);
  districtPres.set(r[0], { 2024: pct(r[9]), 2020: pct(r[16]) });
}

const out = { source: "538 election results archive; The Downballot presidential results by 2026 district", races: {} };
for (const id of raceIds) {
  const st = id.slice(0, 2);
  const races = [];
  if (id.endsWith("-SEN")) {
    const cls = SPECIALS.has(id) ? "Class III" : "Class II";
    const years = SPECIALS.has(id) ? [2022, 2016, 2010, 2004] : [2020, 2014, 2008, 2002];
    for (const y of years) {
      for (const special of ["false", "true"]) {
        const rows = senateBy.get(`${st}|${cls}|${y}|${special}`);
        const res = rows && result(rows);
        if (res) races.push({ year: y, special: special === "true", ...res });
      }
    }
    const presYears = Object.fromEntries(PRES_YEARS.map((y) => [y, stateMargin(st, y)]));
    out.races[id] = { past: races, president: presYears };
  } else {
    for (let y = 2024; y >= HOUSE_FROM; y -= 2) {
      const rows = houseBy.get(`${id}|${y}`);
      const res = rows && result(rows);
      if (res) races.push({ year: y, ...res });
    }
    out.races[id] = { past: races, president: districtPres.get(id) ?? {} };
  }
}

writeFileSync(OUT, JSON.stringify(out));
const empty = raceIds.filter((id) => !out.races[id].past.length);
console.log(`wrote ${OUT}: ${raceIds.length} races, ${empty.length} without past results${empty.length ? ` (${empty.join(" ")})` : ""}`);
