"""Shared data layer for every model: downloads, raw-data cache, parsers and CSV helpers.

Standard library only. Network calls live here and in decide.py (Kalshi) and nowhere else;
every download is cached under data/raw/<source>/ with its retrieval date.
"""

import csv
import datetime as dt
import io
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
MODELS = ROOT / "models"
TEMPLATES = ROOT / "submission" / "templates"
USER_AGENT = "model-citizens-forecast/0.1 (https://github.com/srivatsav-kannan/election-prediction)"

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
    "races": FTE_RESULTS + "races.csv",  # incumbent party per race
    "generic_topline_historical": FTE_DATA + "congress-generic-ballot/generic_topline_historical.csv",  # <= 2016
    "generic_ballot_averages_old_model": FTE_DATA + "polls/old_model/generic_ballot_averages_old_model.csv",  # 2018+
}

ELECTION_DAY = {2010: "2010-11-02", 2012: "2012-11-06", 2014: "2014-11-04", 2016: "2016-11-08",
                2018: "2018-11-06", 2020: "2020-11-03", 2022: "2022-11-08", 2024: "2024-11-05"}
MIDTERMS = {2010, 2014, 2018, 2022}
PRES_DEM = {2008: "Obama", 2012: "Obama", 2016: "Clinton", 2020: "Biden"}

WIKI_API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=parse&page="
GENERIC_BALLOT_PAGE = "2026_United_States_House_of_Representatives_elections"
GENERIC_BALLOT_SECTION = "Generic congressional ballot aggregate polls"

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
    hits = sorted(d.glob(f"{name}_*.{ext}"))
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


# ---------------------------------------------------------------- 2026 inputs

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
            c = cands.setdefault(r["candidate_id"] or f"row{r['id']}", {"votes": 0, "party": "O", "winner": False})
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
                    "margin": 100 * (d - rep) / total if total else None, "incumbent": incumbent.get(race, "")}
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
