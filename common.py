"""Shared data layer for every model: downloads, raw-data cache, parsers and CSV helpers.

Standard library only. Network calls live here and in decide.py (Kalshi) and nowhere else;
every download is cached under data/raw/<source>/ with its retrieval date.
"""

import csv
import datetime as dt
import io
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OVERRIDES = ROOT / "data" / "overrides"
MODELS = ROOT / "models"
TEMPLATES = ROOT / "submission" / "templates"
USER_AGENT = "model-citizens-forecast/0.1 (https://github.com/srivatsav-kannan/upset-desk)"

SHEET_URL = "https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}"
SOURCES = {
    # The Downballot: 2020 & 2024 presidential results by congressional district.
    # https://www.the-downballot.com/p/the-downballots-calculations-of-presidential
    "downballot_2026_lines": ("1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0", "1491069057"),
    "downballot_2024_lines": ("1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo", "1491069057"),
    # Historical sheets (percentages, not votes), named by the first cycle that used the lines.
    "downballot_2022_lines": ("1CKngqOp8fzU22JOlypoxNsxL6KSAH920Whc-rd7ebuM", "1871835782"),
    "downballot_2020_lines": ("1XbUXnI9OyfAuhP5P3vWtMuGc5UJlrhXbzZo3AwMuHtk", "0"),
    "downballot_2018_lines": ("1zLNAuRqPauss00HDz4XbTH2HqsCzMe0pR8QmD1K8jk8", "0"),
    "downballot_2016_lines": ("1VfkHtzBTP5gf4jAu8tcVQgsBJ1IDvXEHjuMqYlOgYbA", "0"),
    "downballot_2012_lines": ("1xn6nCNM97oFDZ4M-HQgoUT3X4paOiSDsRMSuxbaOBdg", "0"),  # used 2012 and 2014
    "downballot_2006_lines": ("1l7W130tPRF6dQ4JoqlQJSJexnEg4rZct-7kwDXqgoLE", "429358610"),  # 2006-2010
}

# FiveThirtyEight's archived data, pinned to commits (538 shut down in 2025).
FTE_RESULTS = "https://raw.githubusercontent.com/fivethirtyeight/election-results/d7a7cff101da28f4ff77114450a964874800ca54/"
FTE_DATA = "https://raw.githubusercontent.com/fivethirtyeight/data/4c1ff5e3aef1816ae04af63218015066e186c147/"
FTE_FILES = {
    "election_results_house": FTE_RESULTS + "election_results_house.csv",
    "election_results_presidential": FTE_RESULTS + "election_results_presidential.csv",
    "election_results_generichouse": FTE_RESULTS + "election_results_generichouse.csv",  # national House vote
    "election_results_senate": FTE_RESULTS + "election_results_senate.csv",
    "races": FTE_RESULTS + "races.csv",  # incumbent party per race
    # Every poll in the final weeks of a race, 1998-2022, with the result (pollster-ratings input).
    "raw_polls": FTE_DATA + "pollster-ratings/raw_polls.csv",
    "generic_topline_historical": FTE_DATA + "congress-generic-ballot/generic_topline_historical.csv",  # <= 2016
    "generic_ballot_averages_old_model": FTE_DATA + "polls/old_model/generic_ballot_averages_old_model.csv",  # 2018+
}

ELECTION_DAY = {2010: "2010-11-02", 2012: "2012-11-06", 2014: "2014-11-04", 2016: "2016-11-08",
                2018: "2018-11-06", 2020: "2020-11-03", 2022: "2022-11-08", 2024: "2024-11-05",
                2026: "2026-11-03"}
MIDTERMS = {2010, 2014, 2018, 2022}
PRES_DEM = {2008: "Obama", 2012: "Obama", 2016: "Clinton", 2020: "Biden"}

WIKI_API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=parse&page="
GENERIC_BALLOT_PAGE = "2026_United_States_House_of_Representatives_elections"
GENERIC_BALLOT_SECTION = "Generic congressional ballot aggregate polls"
SENATE_PAGE = "2026_United_States_Senate_elections"
SENATE_SECTIONS = ["Special elections during the preceding Congress", "Elections leading to the next Congress"]

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN",
    "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

RACE_ID = re.compile(r"^[A-Z]{2}-(\d{2}|AL)$")

# Every model writes models/<name>/predictions.csv with these columns, one row per race in
# the order of the full-congress template. p_d is the probability that the Democrat (or the
# strongest non-Republican, e.g. an independent) wins, unrounded; projected_margin may be blank.
PREDICTION_FIELDS = ["race_id", "chamber", "projected_margin", "p_d", "predicted_winner_party", "win_probability"]


# ---------------------------------------------------------------- download + cache

def http_get(url: str) -> bytes:
    """GET with exponential backoff on HTTP 429 (Kalshi rate-limits aggressively)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"rate-limited too many times: {url}")


_REFRESHED = set()  # sources already re-downloaded in this run, so several models share one download


def cached(folder: str, name: str, ext: str, refresh: bool, download) -> Path:
    """Return the newest cached raw file for a source, calling download() if needed."""
    d = RAW / folder
    d.mkdir(parents=True, exist_ok=True)
    hits = sorted(d.glob(f"{name}_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].{ext}"))  # exact name + date
    if hits and (not refresh or (folder, name) in _REFRESHED):
        return hits[-1]
    path = d / f"{name}_{dt.date.today().isoformat()}.{ext}"
    path.write_bytes(download())
    _REFRESHED.add((folder, name))
    return path


def fetch(name: str, refresh: bool) -> Path:
    sheet_id, gid = SOURCES[name]
    return cached("downballot", name, "csv", refresh,
                  lambda: http_get(SHEET_URL.format(id=sheet_id, gid=gid)))


def fetch_fte(name: str, refresh: bool) -> Path:
    return cached("fivethirtyeight", name, "csv", refresh, lambda: http_get(FTE_FILES[name]))


def fetch_generic_ballot(refresh: bool) -> Path:
    """Wikipedia's table of generic-ballot aggregator averages (wikitext + revision id)."""
    def download() -> bytes:
        sections = json.loads(http_get(WIKI_API + GENERIC_BALLOT_PAGE + "&prop=sections"))
        idx = next(s["index"] for s in sections["parse"]["sections"] if s["line"] == GENERIC_BALLOT_SECTION)
        return http_get(WIKI_API + GENERIC_BALLOT_PAGE + f"&prop=wikitext|revid&section={idx}")
    return cached("wikipedia", "generic_ballot", "json", refresh, download)


def fetch_wiki(name: str, page: str, sections: list, refresh: bool) -> Path:
    """Wikitext of whole page (sections=[]) or of the named sections, with the revision id."""
    def download() -> bytes:
        if not sections:
            return http_get(WIKI_API + page + "&prop=wikitext|revid")
        index = {s["line"]: s["index"] for s in json.loads(http_get(WIKI_API + page + "&prop=sections"))["parse"]["sections"]}
        parts = [json.loads(http_get(WIKI_API + page + f"&prop=wikitext|revid&section={index[t]}"))["parse"] for t in sections]
        return json.dumps({"parse": {"revid": parts[0]["revid"], "wikitext": "\n".join(p["wikitext"] for p in parts)}}).encode()
    return cached("wikipedia", name, "json", refresh, download)


def fetch_house_ratings(year: int, refresh: bool) -> Path:
    """Wikipedia's "<year> United States House of Representatives election ratings" page."""
    return fetch_wiki(f"house_ratings_{year}", f"{year}_United_States_House_of_Representatives_election_ratings", [],
                      refresh)


def fetch_senate_page(year: int, refresh: bool) -> Path:
    """Wikipedia's "<year> United States Senate elections" page (its ratings table is parsed below)."""
    return fetch_wiki(f"senate_page_{year}", f"{year}_United_States_Senate_elections", [], refresh)


def fetch_senate_race_page(year: int, state: str, special: bool, refresh: bool) -> Path:
    """Wikipedia's page for one Senate race (polling tables, candidates)."""
    name = next(k for k, v in STATES.items() if v == state)
    kind = "special_election" if special else "election"
    return fetch_wiki(f"senate_race_{year}_{state}{'_special' if special else ''}",
                      f"{year}_United_States_Senate_{kind}_in_{name.replace(' ', '_')}", [], refresh)


def fetch_house_state_page(year: int, state: str, at_large: bool, refresh: bool) -> Path:
    """Wikipedia's page of one state's House races (a section per district, with polling tables).

    An at-large state has a single-race page. A state split into sub-pages (California's
    "(districts 1–26)" and "(districts 27–52)") is fetched with them, joined into one snapshot.
    """
    name = next(k for k, v in STATES.items() if v == state).replace(" ", "_")

    def get(page: str) -> dict:
        return json.loads(http_get(WIKI_API + urllib.parse.quote(page.replace(" ", "_")) + "&prop=wikitext|revid"))["parse"]

    def download() -> bytes:
        main = get(f"{year}_United_States_House_of_Representatives_election{'' if at_large else 's'}_in_{name}")
        subs = re.findall(r"\{\{main\|([^}|]*\(districts [^)]*\))\}\}", main["wikitext"])
        text = "\n".join([main["wikitext"]] + [get(s)["wikitext"] for s in subs])
        return json.dumps({"parse": {"revid": main["revid"], "wikitext": text}}).encode()
    return cached("wikipedia", f"house_state_{year}_{state}", "json", refresh, download)


# ---------------------------------------------------------------- 2026 inputs

PARTY_WORD = {"Democratic": "D", "DFL": "D", "Republican": "R", "Independent": "I"}
# "Incumbent renominated", "Incumbent advanced to general", "Interim appointee nominated", ...
RUNNING = re.compile(r"Incumbent (renominated|advanced|running|nominated)|appointee nominated", re.I)
NOT_RUNNING = re.compile(r"retir|lost|defeated|resign|died|withdr", re.I)


def _status_running(status: str) -> bool:
    return bool(RUNNING.search(status)) and not NOT_RUNNING.search(status)


def load_house_incumbents_2026(path: Path) -> dict:
    """{race_id: [{"party", "running"}]} for each member listed against a 2026 district.

    Parsed from the per-state tables on Wikipedia's 2026 House page. A district can list
    several members (redistricting pairings) or none ("new seat"); "running" means the member
    is the nominee in that district (status "Incumbent renominated" or similar).
    """
    text = json.loads(path.read_text())["parse"]["wikitext"]
    out, rid = {}, None
    for row in re.split(r"\n\|-", text):
        m = re.search(r"^\s*!.*?\{\{ushr\|([A-Z]{2})\|(\w+)\|", row, re.M)
        if m:
            rid = f"{m[1]}-{'AL' if m[2].upper() == 'AL' else m[2].zfill(2)}"
            out.setdefault(rid, [])
        if rid is None:
            continue
        if re.search(r"\{\{ushr\|[A-Z]{2}\|\w+\|X\}\}", row) is None and m is None and not re.search(r"\{\{sortname", row):
            continue
        party = re.search(r"^\|[^\n]*?\|\s*(Democratic|Republican|Independent)\s*$", row, re.M)
        status = re.search(r"^\|[^\n]*?(Incumbent[^\n]*|New representative[^\n]*|Vacant[^\n]*)$", row, re.M)
        if party and status and re.search(r"\{\{sortname|\[\[", row.split(party.group(0))[0]):
            out[rid].append({"party": PARTY_WORD[party[1]], "running": _status_running(status[1])})
        if row.strip().startswith("}") or "\n|}" in row:
            rid = None
    return out


def load_senate_incumbents_2026(path: Path) -> dict:
    """{state: {"party", "running"}} for the seat up in 2026 (specials included), from Wikipedia."""
    text = json.loads(path.read_text())["parse"]["wikitext"]
    out = {}
    for row in re.split(r"\n\|-", text):
        m = re.search(r"^\s*!\s*\[\[2026 United States Senate (?:special )?election in ([^|\]]+)\|", row, re.M)
        party = re.search(r"\{\{Party shading/\w+\}\}\s*\|\s*(Democratic|DFL|Republican|Independent)\s*$", row, re.M)
        status = re.search(r"\|\s*(Incumbent[^\n]*|Interim appointee[^\n]*)$", row, re.M)
        if m and party and status and m[1] in STATES:
            out[STATES[m[1]]] = {"party": PARTY_WORD[party[1]], "running": _status_running(status[1])}
    return out

# ---------------------------------------------------------------- expert ratings (any cycle)

# Rating levels on a -3 (Safe R) .. +3 (Safe D) scale. Independents count with the D side:
# a model's p_d is the probability that the strongest non-Republican wins.
RATING_LEVEL = {"safe": 3, "solid": 3, "likely": 2, "favored": 2, "lean": 1, "tilt": 0.5, "tossup": 0, "toss-up": 0}
RATING_CELL = re.compile(r"\{\{USRaceRating\|\s*([A-Za-z-]+)\s*(?:\|\s*([DRI])\b)?[^}]*\}\}"
                         r"|\{\{sort\|\d+\|\s*(Safe|Solid|Likely|Lean|Tilt|Toss-?up)\s*([DRI])?", re.I)
NOT_RUNNING_CELL = re.compile(r"retir|lost|defeated|resign|died|withdr|running for|seeking|not running|"
                              r"term.limited|appointee not", re.I)


def rating_score(level: str, party: str) -> float:
    v = RATING_LEVEL[level.lower()]
    return 0.0 if v == 0 else (-v if party == "R" else v)


def load_ratings(path: Path, chamber: str) -> dict:
    """Final pre-election expert ratings from a Wikipedia ratings table.

    House: {race_id: row}; Senate: {(state, special): row}. Each row has "scores" (one per
    rater, -3 Safe R .. +3 Safe D), plus "inc_party" and "inc_running" read from the incumbent
    cell. Only rating cells are read: tables that also show the winner keep it in a separate
    column, which is ignored (no leakage). A "Median" column, where present, is skipped.
    """
    text = json.loads(path.read_text())["parse"]["wikitext"]
    out = {}
    for row in re.split(r"\n\|-", text):
        head = row.strip().split("\n")[0]
        if chamber == "House":
            m = re.search(r"\{\{ushr\|([A-Z]{2})\|(\w+)\|", head)
            if not m or not head.lstrip().startswith("!"):
                continue
            key = f"{m[1]}-{'AL' if m[2].upper() in ('AL', '0') else m[2].zfill(2)}"
        else:
            m = re.match(r"\s*!\s*\[\[[^|\]]*\|([^\]]+)\]\]", head)  # [[#Ohio|Ohio]] or [[2026 ... in Ohio|Ohio]]
            name = re.sub(r"<br\s*/?>.*|\s*\(.*\)", "", m[1]).strip() if m else ""
            if name not in STATES:
                continue
            key = (STATES[name], "special" in head.lower())
        lines = [ln for ln in row.split("\n")[1:] if "Median" not in ln]
        scores = [rating_score(c[0] or c[2], (c[1] or c[3] or "").upper()) for c in RATING_CELL.findall("\n".join(lines))]
        if len(scores) < 2:
            continue
        inc = next((ln for ln in lines if ("sortname" in ln or "[[" in ln) and "Party shading" in ln.replace("party shading", "Party shading")
                    and not RATING_CELL.search(ln) and "%" not in ln.split("|")[-1]), "")
        party = re.search(r"[Pp]arty shading/(Democratic|DFL|Republican|Independent)", inc)
        prev = out.get(key)
        if prev and len(prev["scores"]) >= len(scores):
            continue
        out[key] = {"scores": scores, "inc_party": PARTY_WORD[party[1]] if party else "",
                    "inc_running": bool(inc) and not NOT_RUNNING_CELL.search(inc)}
    return out


# ---------------------------------------------------------------- Senate results + polls (backtests)

def load_senate_results(path: Path, cycles: set) -> dict:
    """Senate general elections as {(cycle, state, special): contest}.

    The deciding contest is a runoff if there was one, else the general or jungle primary;
    ranked-choice races use the final round. "margin" is the strongest non-Republican's share
    minus the strongest Republican's, in points of the total vote, and "winner" is R or D
    (D meaning any non-Republican, as in p_d), and "non_r_party" says whether that strongest
    non-Republican was a Democrat or an independent. "non_r_id" and "r_id" are the two
    candidates' 538 ids. Contested means both sides were on the ballot. Party fixes (e.g. a
    Republican re-elected as a write-in) come from data/overrides/senate_candidate_party.csv.
    """
    fixes = {r["candidate_id"]: r["party"] for r in read_rows(OVERRIDES / "senate_candidate_party.csv")}
    contests = {}
    for r in read_rows(path):
        if (r["office_name"] == "U.S. Senate" and r["cycle"].isdigit() and int(r["cycle"]) in cycles
                and r["party"] == "" and r["stage"] in STAGE_RANK):
            key = (int(r["cycle"]), r["state_abbrev"], r["special"] == "true")
            contests.setdefault(key, {}).setdefault(r["race_id"], []).append(r)
    out = {}
    for key, by_race in contests.items():
        race = max(by_race, key=lambda k: STAGE_RANK[by_race[k][0]["stage"]])
        rows = by_race[race]
        rounds = [int(r["ranked_choice_round"]) for r in rows if r["ranked_choice_round"]]
        if rounds:
            rows = [r for r in rows if r["ranked_choice_round"] == str(max(rounds))]
        cands = {}
        for r in rows:
            c = cands.setdefault(r["candidate_id"] or f"row{r['id']}",
                                 {"id": r["candidate_id"], "votes": 0, "rep": False, "dem": False, "winner": False})
            c["votes"] += int(float(r["votes"])) if r["votes"] else 0
            c["rep"] |= r["ballot_party"] == "REP" or fixes.get(r["candidate_id"]) == "R"
            c["dem"] |= r["ballot_party"] == "DEM"
            c["winner"] |= r["winner"] == "true"
        cs = list(cands.values())
        total = sum(c["votes"] for c in cs)
        top_rep = max((c for c in cs if c["rep"]), key=lambda c: c["votes"], default={"id": "", "votes": 0})
        top_non = max((c for c in cs if not c["rep"]), key=lambda c: c["votes"], default={"id": "", "votes": 0, "dem": True})
        rep, non = top_rep["votes"], top_non["votes"]
        winner = next((c for c in cs if c["winner"]), max(cs, key=lambda c: c["votes"]))
        out[key] = {"winner": "R" if winner["rep"] else "D", "contested": rep > 0 and non > 0 and total > 0,
                    "non_r_party": "D" if top_non["dem"] else "I", "non_r_id": top_non["id"], "r_id": top_rep["id"],
                    "margin": 100 * (non - rep) / total if total else None}
    return out


def state_pres_margins(path: Path) -> dict:
    """{(year, state): D-R presidential margin in points} from 538's statewide general rows."""
    pct = {}
    for r in read_rows(path):
        if (r["office_name"] == "U.S. President" and r["stage"] == "general" and r["state_abbrev"]
                and not r.get("district", "") and r["ballot_party"] in ("DEM", "REP") and r["percent"]):
            k = (int(r["cycle"]), r["state_abbrev"])
            pct.setdefault(k, {})
            pct[k][r["ballot_party"]] = max(pct[k].get(r["ballot_party"], 0.0), float(r["percent"]))
    return {k: v["DEM"] - v["REP"] for k, v in pct.items() if len(v) == 2}


def load_raw_polls(path: Path) -> list:
    """538's archived polls of general elections, with the margin oriented as non-R minus R.

    Returns [{type, cycle, key, pollster, partisan, sponsor, days, n, margin_poll, margin_actual,
    non_r_id, r_id}] for Senate (key (cycle, state, special)) and House (key (cycle, race_id))
    generals; polls of runoffs and same-party matchups are dropped. The ids are the polled
    candidates' 538 ids, the same ids as in 538's results. sponsor is the partisan sponsor's
    party, D or R ("" for nonpartisan polls and the rare poll sponsored by both).
    """
    out = []
    for r in read_rows(path):
        t = r["race"].split("_")[1] if r["race"].count("_") >= 2 else ""
        if t not in ("Sen-G", "Sen-GS", "House-G"):
            continue
        p1, p2 = r["cand1_party"], r["cand2_party"]
        if (p1 == "REP") == (p2 == "REP"):
            continue
        sign = -1 if p1 == "REP" else 1
        cycle = int(r["cycle"])
        if t == "House-G":
            st, _, n = r["location"].partition("-")
            key = (cycle, f"{st}-{'AL' if n in ('AL', '0', '') else n.zfill(2)}")
        else:
            key = (cycle, r["location"], t == "Sen-GS")
        out.append({"type": "House" if t == "House-G" else "Senate", "cycle": cycle, "key": key,
                    "pollster": r["pollster"], "partisan": r["partisan"] not in ("", "NA"),
                    "sponsor": {"DEM": "D", "REP": "R"}.get(r["partisan"], ""),
                    "days": int(r["time_to_election"]), "n": float(r["samplesize"] or 0),
                    "margin_poll": sign * float(r["margin_poll"]), "margin_actual": sign * float(r["margin_actual"]),
                    "non_r_id": r["cand2_id"] if p1 == "REP" else r["cand1_id"],
                    "r_id": r["cand1_id"] if p1 == "REP" else r["cand2_id"]})
    return out


MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                         "september", "october", "november", "december"], 1)}


def poll_end_date(text: str, year: int):
    """Last day of a Wikipedia poll's field dates ("October 20–26, 2026", "Sep 30 – Oct 2, 2026")."""
    text = re.sub(r"\{\{[^}]*\}\}|<[^>]+>", " ", text)
    found = re.findall(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*[–-]\s*(\d{1,2})\b(?!\s*[A-Za-z]))?", text)
    found = [(MONTHS.get(next((k for k in MONTHS if k.startswith(m.lower()[:3])), ""), 0), d1, d2) for m, d1, d2 in found]
    found = [f for f in found if f[0]]
    if not found:
        return None
    mo, d1, d2 = found[-1]
    y = re.findall(r"\b(20\d\d)\b", text)
    return dt.date(int(y[-1]) if y else year, mo, int(d2 or d1))


def _cells(row: str) -> list:
    cells = []
    for ln in row.split("\n"):
        ln = ln.strip()
        if ln.startswith("|") and not ln.startswith("|}") and not ln.startswith("|-"):
            cells += [c for c in ln[1:].split("||")]
    return cells


def _cell_text(cell: str) -> str:
    """Drop a cell's attributes ('style=... |' or '{{party shading/X}} |') and its references."""
    cell = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", cell, flags=re.S)
    depth, cut = 0, -1
    for i, ch in enumerate(cell):  # the attribute separator is a '|' outside templates and links
        depth += {"{": 1, "[": 1, "}": -1, "]": -1}.get(ch, 0)
        if ch == "|" and depth == 0:
            cut = i
            break
    return cell[cut + 1:] if cut >= 0 else cell


def load_wiki_polls(path: Path, year: int) -> list:
    """Individual general-election polls from a Wikipedia race page's first head-to-head table.

    Only the first table under the "General election" polling heading with a "Poll source"
    header is read (later tables are hypothetical matchups). Candidate columns are the ones
    whose header names a party, (D)/(DFL)/(I) vs (R). Rows split by rowspan (LV and RV
    versions of one poll) inherit the pollster and dates of the row above. Returns
    [{pollster, partisan, end, n, pop, margin, non_r_party}] with margin = strongest non-R
    candidate minus the Republican, and non_r_party D or I for that candidate.
    """
    return parse_wiki_polls(json.loads(path.read_text(encoding="utf-8"))["parse"]["wikitext"], year)


def load_wiki_house_polls(path: Path, year: int) -> dict:
    """{district: polls} from a state's House page (fetch_house_state_page), as load_wiki_polls.

    Districts are "01".."52", read from each "== District N ==" section; a page with no
    district sections (an at-large state) is one race, returned as "AL".
    """
    text = json.loads(path.read_text(encoding="utf-8"))["parse"]["wikitext"]
    parts = re.split(r"\n==\s*District (\d+)\s*==[ \t]*\n", text)
    if len(parts) == 1:
        return {"AL": parse_wiki_polls(text, year)}
    return {n.zfill(2): parse_wiki_polls("\n" + body, year) for n, body in zip(parts[1::2], parts[2::2])}


def parse_wiki_polls(text: str, year: int) -> list:
    """load_wiki_polls on wikitext: a whole race page, or one district's section of a state page."""
    g = re.search(r"\n==+\s*General election\s*==+", text)
    if not g:
        return []
    body = text[g.end():]
    nxt = re.search(r"\n==\s*[^=]", body)  # the next level-2 section ends the general election
    body = body[:nxt.start()] if nxt else body
    hyp = re.search(r"\n=+\s*Hypothetical", body)
    body = body[:hyp.start()] if hyp else body
    for tbl in re.findall(r"\{\|.*?\n\|\}", body, re.S):
        if "Poll source" not in tbl:
            continue
        rows = re.split(r"\n\|-", tbl)
        heads = [h for r in rows[:3] for h in re.findall(r"^!\s*(.*)$", r, re.M)]
        heads = [re.sub(r"^[^|]*style=[^|]*\|", "", h) for h in heads]
        cols = {}
        for i, h in enumerate(heads):
            p = re.search(r"\((D|DFL|R|I)\)", h)
            if p:
                cols[i] = "D" if p[1] == "DFL" else p[1]
        if "R" not in cols.values() or set(cols.values()) == {"R"}:
            continue
        polls, prev = [], []
        for r in rows[1:]:
            cells = _cells(r)
            if len(cells) < len(heads) - 2:
                continue
            if len(cells) < len(heads):  # rowspan: inherit leading cells from the row above
                cells = prev[:len(heads) - len(cells)] + cells
            prev = cells
            txt = [_cell_text(c) for c in cells]
            if "Average" in txt[0] or "aggregat" in txt[0].lower():
                continue
            pct = {}
            for i, party in cols.items():
                m = re.search(r"(\d+(?:\.\d+)?)\s*%", txt[i]) if i < len(txt) else None
                if m:
                    pct[party] = max(pct.get(party, 0.0), float(m[1]))
            end = poll_end_date(txt[1], year) if len(txt) > 1 else None
            if "R" not in pct or len(pct) < 2 or end is None:
                continue
            non_r = max((p for p in pct if p != "R"), key=pct.get)
            n = re.search(r"([\d,]+)\s*\((LV|RV|A|V)\)", txt[2]) if len(txt) > 2 else None
            pop = re.search(r"\((LV|RV|A|V)\)", txt[2]) if len(txt) > 2 else None
            pollster = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", re.sub(r"\{\{[^}]*\}\}", "", txt[0])).strip()
            polls.append({"pollster": pollster, "partisan": bool(re.search(r"\((D|R)\)", pollster)), "end": end,
                          "n": float(n[1].replace(",", "")) if n else 0.0, "pop": pop[1] if pop else "",
                          "margin": pct[non_r] - pct["R"], "non_r_party": non_r})
        return polls
    return []


def load_generic_ballot(path: Path) -> list:
    """Parse the aggregator rows into [{source, dem, rep, margin}] (our own average, not theirs)."""
    page = json.loads(path.read_text())["parse"]
    rows = []
    for block in page["wikitext"].split("|-")[1:]:
        source = re.search(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", block)
        pcts = [float(x) for x in re.findall(r"([\d.]+)%", block)]
        if not source or "Average" in block or len(pcts) < 2:
            continue
        rep, dem = pcts[0], pcts[1]  # column order: Republicans, Democrats, Other, Margin
        rows.append({"source": source.group(1), "dem": dem, "rep": rep, "margin": round(dem - rep, 2),
                     "wikipedia_revid": page["revid"]})
    assert len(rows) >= 3, f"{path.name}: expected several generic-ballot aggregators, got {len(rows)}"
    return rows


def to_int(s: str) -> int:
    return int(s.replace(",", "")) if s.strip() else 0


def load_districts(path: Path) -> dict:
    """Parse a Downballot 'Vote totals' tab into {race_id: row}."""
    rows = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8"))))
    header = next(r for r in rows if "Harris" in r)
    h, t, tot = header.index("Harris"), header.index("Trump"), header.index("Total")
    b = header.index("Biden")
    out = {}
    for r in rows:
        if not RACE_ID.match(r[0]):
            continue
        d = {
            "race_id": r[0],
            "state": r[0][:2],
            "incumbent": r[1].strip(),
            "incumbent_party": r[2].strip("() "),
            "harris": to_int(r[h]),
            "trump": to_int(r[t]),
            "total": to_int(r[tot]),
            "biden": to_int(r[b]),
            "trump20": to_int(r[b + 1]),
            "total20": to_int(r[b + 2]),
        }
        d["margin24"] = 100 * (d["harris"] - d["trump"]) / d["total"]
        d["margin20"] = 100 * (d["biden"] - d["trump20"]) / d["total20"] if d["total20"] else None
        out[r[0]] = d
    assert len(out) == 435, f"{path.name}: expected 435 districts, got {len(out)}"
    return out


def national_margin(districts: dict) -> float:
    h = sum(d["harris"] for d in districts.values())
    t = sum(d["trump"] for d in districts.values())
    return 100 * (h - t) / sum(d["total"] for d in districts.values())


def state_margins(districts: dict) -> dict:
    agg = {}
    for d in districts.values():
        a = agg.setdefault(d["state"], [0, 0, 0])
        a[0] += d["harris"]
        a[1] += d["trump"]
        a[2] += d["total"]
    return {s: 100 * (h - t) / tot for s, (h, t, tot) in agg.items()}


# ---------------------------------------------------------------- historical inputs (backtests)

def read_rows(path: Path) -> list:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_pres_pct(path: Path, year: int) -> dict:
    """Parse a historical Downballot sheet into {race_id: D-R presidential margin} for one year.

    These sheets give percentages. A row of years sits above the header, except on
    single-election sheets, where the Democrat's name identifies the column.
    """
    rows = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8"))))
    h = next(i for i, r in enumerate(rows) if len(r) > 2 and r[1] == "Incumbent")
    years = rows[h - 1] if h else []
    col = years.index(str(year)) if str(year) in years else rows[h].index(PRES_DEM[year])
    out = {r[0]: float(r[col]) - float(r[col + 1]) for r in rows[h + 1:] if RACE_ID.match(r[0]) and r[col].strip()}
    # Some states were never recomputed on new lines (e.g. 2008 on CA's 2012 map, 2012 on FL's
    # 2016 map). Those states are skipped for that cycle; a partly blank state is an error.
    ids = [r[0] for r in rows[h + 1:] if RACE_ID.match(r[0])]
    for s in {i[:2] for i in ids}:
        have = sum(k[:2] == s for k in out)
        assert have in (0, sum(i[:2] == s for i in ids)), f"{path.name}: {s} has {year} results for only some districts"
    assert len(ids) == 435 and len(out) >= 380, f"{path.name}: {len(out)} of {len(ids)} districts with {year} results"
    return out


STAGE_RANK = {"jungle primary": 0, "general": 1, "runoff": 2}  # the deciding contest wins


def load_house_results(path: Path, races_path: Path, cycles: set) -> dict:
    """Regular House general elections as {(cycle, state, district number): contest}.

    Per seat, the deciding contest is a runoff if there was one (Louisiana), else the November
    general or jungle primary; ranked-choice races (AK, ME) use the final round. Fusion lines
    (NY's WFP, CON, ...) are summed into the candidate, whose party is D or R if any line is.
    Each of "cands" carries its 538 candidate id ("cid"), the id 538's polls use.
    """
    incumbent = {r["id"]: {"DEM": "D", "REP": "R"}.get(r["incumbent_party"], "") for r in read_rows(races_path)}
    contests = {}
    for r in read_rows(path):
        if (r["office_name"] == "U.S. House" and r["cycle"].isdigit() and int(r["cycle"]) in cycles
                and r["special"] == "false" and r["party"] == "" and r["stage"] in STAGE_RANK):
            key = (int(r["cycle"]), r["state_abbrev"], int(r["office_seat_name"].split()[-1]))
            contests.setdefault(key, {}).setdefault(r["race_id"], []).append(r)
    out = {}
    for key, by_race in contests.items():
        race = max(by_race, key=lambda k: STAGE_RANK[by_race[k][0]["stage"]])
        rows = by_race[race]
        rounds = [int(r["ranked_choice_round"]) for r in rows if r["ranked_choice_round"]]
        if rounds:
            rows = [r for r in rows if r["ranked_choice_round"] == str(max(rounds))]
        cands = {}
        for r in rows:
            c = cands.setdefault(r["candidate_id"] or f"row{r['id']}",
                                 {"votes": 0, "party": "O", "winner": False, "pid": r["politician_id"],
                                  "cid": r["candidate_id"]})
            c["votes"] += int(float(r["votes"])) if r["votes"] else 0
            if r["ballot_party"] == "DEM":
                c["party"] = "D"
            elif r["ballot_party"] == "REP" and c["party"] != "D":
                c["party"] = "R"
            c["winner"] |= r["winner"] == "true"
        cs = list(cands.values())
        winner = next((c for c in cs if c["winner"]), max(cs, key=lambda c: c["votes"]))
        total = sum(c["votes"] for c in cs)
        d = sum(c["votes"] for c in cs if c["party"] == "D")
        rep = sum(c["votes"] for c in cs if c["party"] == "R")
        parties = {c["party"] for c in cs}
        out[key] = {"winner": winner["party"], "contested": {"D", "R"} <= parties and total > 0,
                    "votes": (d, rep, total),
                    "margin": 100 * (d - rep) / total if total else None, "incumbent": incumbent.get(race, ""),
                    "cands": [{"pid": c["pid"], "cid": c["cid"], "party": c["party"], "winner": c["winner"],
                               "votes": c["votes"]} for c in cs]}
    return out


def house_members_by_cycle(path: Path, cycles: set) -> dict:
    """{cycle: {politician_id}} of sitting House members going into each cycle's election.

    Members are the previous cycle's general-election winners plus anyone who won a special
    election since (538 politician ids). A candidate in that cycle's race who is in this set
    is an incumbent running, even after redistricting moves them to a new district number.
    """
    winners = {}
    for r in read_rows(path):
        if r["office_name"] == "U.S. House" and r["winner"] == "true" and r["politician_id"] and r["cycle"].isdigit():
            winners.setdefault(int(r["cycle"]), {})[r["politician_id"]] = r["special"] == "true"
    out = {}
    for y in cycles:
        members = {pid for pid, special in winners.get(y - 2, {}).items() if not special}
        members |= {pid for c in (y - 2, y - 1) for pid, special in winners.get(c, {}).items() if special}
        out[y] = members
    return out


def national_vote_margins(path: Path) -> dict:
    """{cycle: national D-R margin in points} from 538's national (state-blank) general rows."""
    out = {}
    for r in read_rows(path):
        if r["state_abbrev"] == "" and r["stage"] == "general" and r["ballot_party"] in ("DEM", "REP"):
            out.setdefault(int(r["cycle"]), {})[r["ballot_party"]] = float(r["percent"])
    return {y: v["DEM"] - v["REP"] for y, v in out.items() if len(v) == 2}


def load_generic_ballot_history(hist_path: Path, recent_path: Path) -> dict:
    """{cycle: 538's last generic-ballot average (D-R) published before Election Day}."""
    out = {}
    hist = read_rows(hist_path)
    recent = read_rows(recent_path)
    for y, day in ELECTION_DAY.items():
        before = [(dt.datetime.strptime(r["modeldate"], "%m/%d/%Y").date().isoformat(), r) for r in hist]
        before = [(d, r) for d, r in before if d < day and d > f"{y - 1}-11-30"]
        if before:
            d, r = max(before, key=lambda x: x[0])
            out[y] = {"date": d, "margin": float(r["dem_estimate"]) - float(r["rep_estimate"])}
            continue
        rows = [r for r in recent if r["cycle"] == str(y) and r["date"] < day]
        if rows:
            d = max(r["date"] for r in rows)
            pct = {r["candidate"]: float(r["pct_estimate"]) for r in rows if r["date"] == d}
            out[y] = {"date": d, "margin": pct["Democrats"] - pct["Republicans"]}
    return out


# ---------------------------------------------------------------- probability helpers

# Win probabilities are P(D) = F(margin / scale) for a Student-t F, fit by maximum likelihood
# on past winners (shared by every model's backtest).
T_DF_GRID = [1, 2, 3, 4, 6, 10, 30, None]  # Student-t degrees of freedom tried; None = normal


def phi(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2))


def cdf(x: float, df=None) -> float:
    """Student-t CDF for integer df (closed form, Abramowitz & Stegun 26.7.3-4); df=None is the normal."""
    if df is None:
        return phi(x)
    th = math.atan(abs(x) / math.sqrt(df))
    c2 = math.cos(th) ** 2
    if df % 2:
        term = s = math.cos(th)
        for j in range(1, (df - 1) // 2):
            term *= c2 * 2 * j / (2 * j + 1)
            s += term
        a = 2 / math.pi * (th + (math.sin(th) * s if df > 1 else 0.0))
    else:
        term = s = 1.0
        for j in range(1, df // 2):
            term *= c2 * (2 * j - 1) / (2 * j)
            s += term
        a = math.sin(th) * s
    return 0.5 + 0.5 * a if x >= 0 else 0.5 - 0.5 * a


def log_loss(races: list, scale: float, key: str = "pred", df=None) -> float:
    """Mean negative log-likelihood (nats) of the actual winners under P(D) = F(margin / scale)."""
    return -sum(math.log(max(cdf(r["sign"] * r[key] / scale, df), 1e-300)) for r in races) / len(races)


def fit_sigma(races: list, key: str = "pred", df=None) -> float:
    """Maximum-likelihood scale (golden-section search on log scale; the likelihood is unimodal)."""
    lo, hi = math.log(0.5), math.log(60.0)
    g = (math.sqrt(5) - 1) / 2
    for _ in range(36):
        a, b = hi - g * (hi - lo), lo + g * (hi - lo)
        if log_loss(races, math.exp(a), key, df) < log_loss(races, math.exp(b), key, df):
            hi = b
        else:
            lo = a
    return math.exp((lo + hi) / 2)


def fit_t(races: list, key: str = "pred") -> tuple:
    """(df, scale) with the best likelihood over T_DF_GRID."""
    fits = [(df, fit_sigma(races, key, df)) for df in T_DF_GRID]
    return min(fits, key=lambda f: log_loss(races, f[1], key, f[0]))


def wilson(k: int, n: int, z: float = 1.96) -> tuple:
    if n == 0:
        return 0.0, 1.0
    p, den = k / n, 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, c - h), min(1.0, c + h)


def rms(xs: list) -> float:
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else float("nan")


# ---------------------------------------------------------------- outputs

def load_template(name: str) -> list:
    with open(TEMPLATES / name, newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list, fields: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def validate_predictions(path: Path) -> list:
    """Check a model's predictions.csv against the contract above and return its rows."""
    rows = read_rows(path)
    assert [r["race_id"] for r in rows] == [t["race_id"] for t in load_template("full_congress_track_template.csv")], \
        f"{path}: race_ids differ from the full-congress template"
    for r in rows:
        assert r["predicted_winner_party"] in {"D", "R", "I"}, r
        assert 0.0 <= float(r["p_d"]) <= 1.0 and 0.0 <= float(r["win_probability"]) <= 1.0, r
    return rows


def validate_submission(path: Path, template: list) -> None:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    ids = [r["race_id"] for r in rows]
    assert ids == [t["race_id"] for t in template], f"{path.name}: race_ids differ from template"
    for r in rows:
        assert r["predicted_winner_party"] in {"D", "R", "I"}, r
        assert 0.0 <= float(r["win_probability"]) <= 1.0, r
