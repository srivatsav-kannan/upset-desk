"""Model Citizens 2026 forecast pipeline (single file, standard library only).

Run:  python3 forecast.py            # use cached raw data
      python3 forecast.py --refresh  # re-download raw data first

      python3 forecast.py --swing 0  # override the national swing (0 = pure 2024 replay)

Baseline v1 ("2024 on the 2026 map + generic ballot swing"):
  Each race is predicted from the 2024 presidential margin inside its 2026 boundaries,
  plus a uniform national swing. House districts use The Downballot's 2024 presidential
  results recomputed on the lines used in 2026; Senate races use the statewide 2024
  presidential margin (sum of a state's districts).
  Swing = (mean of the published generic-ballot averages listed on Wikipedia, D minus R)
          - (2024 national presidential margin, summed from all 435 districts).
  Win probability = Phi(margin / SIGMA), where SIGMA is the RMS change in district
  presidential margin from 2020 to 2024 on identical lines (estimated from the data).
"""

import argparse
import csv
import datetime as dt
import io
import json
import math
import re
import statistics
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
RESULTS = ROOT / "results"
SUBMISSION = ROOT / "submission"
TEMPLATES = SUBMISSION / "templates"

SWING_GRID = [-2, 0, 2, 4, 6, 8, 10, 12]

SHEET_URL = "https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}"
SOURCES = {
    # The Downballot: 2020 & 2024 presidential results by congressional district.
    # https://www.the-downballot.com/p/the-downballots-calculations-of-presidential
    "downballot_2026_lines": ("1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0", "1491069057"),
    "downballot_2024_lines": ("1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo", "1491069057"),
}

WIKI_API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&action=parse&page="
GENERIC_BALLOT_PAGE = "2026_United_States_House_of_Representatives_elections"
GENERIC_BALLOT_SECTION = "Generic congressional ballot aggregate polls"
USER_AGENT = "model-citizens-forecast/0.1 (https://github.com/srivatsav-kannan/election-prediction)"

RACE_ID = re.compile(r"^[A-Z]{2}-(\d{2}|AL)$")


# ---------------------------------------------------------------- ingest

def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def cached(folder: str, name: str, ext: str, refresh: bool, download) -> Path:
    """Return the newest cached raw file for a source, calling download() if needed."""
    d = RAW / folder
    d.mkdir(parents=True, exist_ok=True)
    hits = sorted(d.glob(f"{name}_*.{ext}"))
    if hits and not refresh:
        return hits[-1]
    path = d / f"{name}_{dt.date.today().isoformat()}.{ext}"
    path.write_bytes(download())
    return path


def fetch(name: str, refresh: bool) -> Path:
    sheet_id, gid = SOURCES[name]
    return cached("downballot", name, "csv", refresh,
                  lambda: http_get(SHEET_URL.format(id=sheet_id, gid=gid)))


def fetch_generic_ballot(refresh: bool) -> Path:
    """Wikipedia's table of generic-ballot aggregator averages (wikitext + revision id)."""
    def download() -> bytes:
        sections = json.loads(http_get(WIKI_API + GENERIC_BALLOT_PAGE + "&prop=sections"))
        idx = next(s["index"] for s in sections["parse"]["sections"] if s["line"] == GENERIC_BALLOT_SECTION)
        return http_get(WIKI_API + GENERIC_BALLOT_PAGE + f"&prop=wikitext|revid&section={idx}")
    return cached("wikipedia", "generic_ballot", "json", refresh, download)


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


def load_template(name: str) -> list:
    with open(TEMPLATES / name, newline="") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- model

def estimate_sigma(old_lines: dict) -> float:
    """RMS 2020->2024 change in district presidential margin on unchanged (2024) lines."""
    diffs = [d["margin24"] - d["margin20"] for d in old_lines.values() if d["margin20"] is not None]
    return math.sqrt(sum(x * x for x in diffs) / len(diffs))


def win_prob_d(margin: float, sigma: float) -> float:
    return statistics.NormalDist().cdf(margin / sigma)


def predict(margin: float, sigma: float) -> tuple:
    p_d = win_prob_d(margin, sigma)
    return ("D", p_d) if margin > 0 else ("R", 1 - p_d)


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


# ---------------------------------------------------------------- outputs

def write_csv(path: Path, rows: list, fields: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def validate_submission(path: Path, template: list) -> None:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    ids = [r["race_id"] for r in rows]
    assert ids == [t["race_id"] for t in template], f"{path.name}: race_ids differ from template"
    for r in rows:
        assert r["predicted_winner_party"] in {"D", "R", "I"}, r
        assert 0.0 <= float(r["win_probability"]) <= 1.0, r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download raw data")
    ap.add_argument("--swing", type=float, help="override the national swing to D, in points")
    args = ap.parse_args()

    new = load_districts(fetch("downballot_2026_lines", args.refresh))
    old = load_districts(fetch("downballot_2024_lines", args.refresh))
    sigma = estimate_sigma(old)

    # National environment: our own mean of the published generic-ballot averages,
    # expressed as a swing from the 2024 presidential national margin.
    gb = load_generic_ballot(fetch_generic_ballot(args.refresh))
    gb_margin = statistics.mean(r["margin"] for r in gb)
    pres_margin = national_margin(new)
    swing_to_d = args.swing if args.swing is not None else gb_margin - pres_margin
    env = gb + [
        {"source": "MEAN of aggregators", "margin": round(gb_margin, 2)},
        {"source": "2024 presidential national margin", "margin": round(pres_margin, 2)},
        {"source": "APPLIED swing to D", "margin": round(swing_to_d, 2)},
    ]
    write_csv(RESULTS / "national_environment.csv", env, ["source", "dem", "rep", "margin", "wikipedia_revid"])

    # House: one row per 2026 district, compared with the same-numbered 2024 district.
    house = []
    for rid in sorted(new):
        n, o = new[rid], old[rid]
        margin = n["margin24"] + swing_to_d
        party, prob = predict(margin, sigma)
        house.append({
            "race_id": rid,
            "state": n["state"],
            "incumbent": n["incumbent"],
            "incumbent_party": n["incumbent_party"],
            "margin_2024_old_lines": round(o["margin24"], 2),
            "margin_2024_new_lines": round(n["margin24"], 2),
            "lines_changed": (n["harris"], n["trump"]) != (o["harris"], o["trump"]),
            "old_lines_winner": "D" if o["margin24"] > 0 else "R",
            "new_lines_winner": "D" if n["margin24"] > 0 else "R",
            "projected_margin": round(margin, 2),
            "predicted_party": party,
            "win_probability": round(prob, 4),
        })
    for h in house:
        h["notional_flip"] = h["old_lines_winner"] != h["new_lines_winner"]
        h["crossover"] = h["incumbent_party"] in {"D", "R"} and h["incumbent_party"] != h["new_lines_winner"]
        h["flips_with_swing"] = h["predicted_party"] != h["new_lines_winner"]

    # Senate: statewide 2024 presidential margin (identical on any district map).
    st_new, st_old = state_margins(new), state_margins(old)
    for s in st_new:
        assert abs(st_new[s] - st_old[s]) < 0.5, f"{s}: statewide totals disagree across maps"
    senate = []
    for t in load_template("senate_track_template.csv"):
        s = t["race_id"][:2]
        margin = st_new[s] + swing_to_d
        party, prob = predict(margin, sigma)
        senate.append({"race_id": t["race_id"], "state": s, "margin_2024": round(st_new[s], 2),
                       "projected_margin": round(margin, 2), "predicted_party": party,
                       "win_probability": round(prob, 4),
                       "flips_with_swing": party != ("D" if st_new[s] > 0 else "R")})

    hf = list(house[0].keys())
    write_csv(RESULTS / "house_2024_on_2026_map.csv", house, hf)
    write_csv(RESULTS / "senate_2024_baseline.csv", senate, list(senate[0].keys()))

    # Redistricting impact by state (only states whose lines changed).
    by_state = []
    for s in sorted({h["state"] for h in house if h["lines_changed"]}):
        hs = [h for h in house if h["state"] == s]
        by_state.append({
            "state": s,
            "seats": len(hs),
            "districts_changed": sum(h["lines_changed"] for h in hs),
            "trump_seats_old": sum(h["old_lines_winner"] == "R" for h in hs),
            "trump_seats_new": sum(h["new_lines_winner"] == "R" for h in hs),
            "net_r_change": sum(h["new_lines_winner"] == "R" for h in hs) - sum(h["old_lines_winner"] == "R" for h in hs),
        })
    write_csv(RESULTS / "redistricting_by_state.csv", by_state, list(by_state[0].keys()))

    # Seat totals under a uniform national swing.
    swing = []
    for x in SWING_GRID:
        swing.append({
            "swing_to_d": x,
            "house_d_old_lines": sum(old[r]["margin24"] + x > 0 for r in old),
            "house_d_new_lines": sum(new[r]["margin24"] + x > 0 for r in new),
            "senate_d_of_35": sum(st_new[r["race_id"][:2]] + x > 0 for r in senate),
        })
    write_csv(RESULTS / "seats_by_national_swing.csv", swing, list(swing[0].keys()))

    # Submissions in the official template format.
    preds = {r["race_id"]: r for r in house} | {r["race_id"]: r for r in senate}
    for tmpl, out in [("senate_track_template.csv", "baseline_senate.csv"),
                      ("full_congress_track_template.csv", "baseline_full_congress.csv")]:
        template = load_template(tmpl)
        rows = [{**t, "predicted_winner_party": preds[t["race_id"]]["predicted_party"],
                 "win_probability": preds[t["race_id"]]["win_probability"]} for t in template]
        write_csv(SUBMISSION / out, rows, list(template[0].keys()))
        validate_submission(SUBMISSION / out, template)

    d_new = sum(h["new_lines_winner"] == "D" for h in house)
    d_old = sum(h["old_lines_winner"] == "D" for h in house)
    d_pred = sum(h["predicted_party"] == "D" for h in house)
    d_exp = sum(win_prob_d(h["projected_margin"], sigma) for h in house)
    print(f"sigma (RMS 2020->2024 district shift): {sigma:.2f} pts")
    print(f"generic ballot (mean of {len(gb)} averages): D{gb_margin:+.2f};  2024 pres: D{pres_margin:+.2f};  "
          f"swing applied: D{swing_to_d:+.2f}{' (override)' if args.swing is not None else ''}")
    print(f"House, 2024 replay: old lines D {d_old} / R {435 - d_old};  2026 lines D {d_new} / R {435 - d_new}")
    print(f"House, with swing: D {d_pred} / R {435 - d_pred} (expected D seats {d_exp:.1f}); "
          f"{sum(h['flips_with_swing'] for h in house)} seats flip from the replay")
    print(f"districts with changed lines: {sum(h['lines_changed'] for h in house)}")
    print(f"crossover seats (incumbent party != 2024 winner on new lines): {sum(h['crossover'] for h in house)}")
    print(f"Senate, with swing: D {sum(r['predicted_party'] == 'D' for r in senate)} of 35 "
          f"(2024 replay: {sum(st_new[r['race_id'][:2]] > 0 for r in senate)})")
    print(f"wrote {RESULTS.relative_to(ROOT)}/ and {SUBMISSION.relative_to(ROOT)}/baseline_*.csv")


if __name__ == "__main__":
    main()
