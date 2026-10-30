"""Tests for the shared parsers, the ensemble's backtest and every model's outputs.

Run: python3 -m unittest discover tests   (standard library only; uses the cached raw data)
"""

import csv
import datetime as dt
import json
import random
import re
import tempfile
import unittest
from pathlib import Path

import common
from models.ensemble import backtest, model

ROOT = Path(__file__).resolve().parent.parent


class TestRatings(unittest.TestCase):
    def test_2026_tables(self):
        house = common.load_ratings(common.fetch_house_ratings(2026, False), "House")
        senate = common.load_ratings(common.fetch_senate_page(2026, False), "Senate")
        template = {t["race_id"] for t in common.load_template("senate_track_template.csv")}
        self.assertGreater(len(house), 100)
        self.assertEqual({f"{s}-SEN" for s, _ in senate}, template)
        for row in list(house.values()) + list(senate.values()):
            self.assertTrue(all(-3 <= x <= 3 for x in row["scores"]))
            self.assertGreaterEqual(len(row["scores"]), 2)

    def test_every_backtest_year_parses(self):
        for y in backtest.CYCLES:
            self.assertGreater(len(common.load_ratings(common.fetch_house_ratings(y, False), "House")), 60, y)
            self.assertGreaterEqual(len(common.load_ratings(common.fetch_senate_page(y, False), "Senate")), 30, y)

    def test_winner_column_is_ignored(self):
        """A results column next to the ratings must never be read as a rating (no leakage)."""
        row = ("\n|-\n! {{ushr|AL|2|X}}\n| {{Shading PVI|R|16}}\n| {{Party shading/Democratic}} | [[Bobby Bright]] (D)\n"
               "| 50.23% D\n| {{USRaceRating|Tossup}}\n| {{USRaceRating|Lean|D}}\n"
               "| data-sort-value=1 {{Party shading/Republican}} | [[Martha Roby]] (R)\n|}")
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.json"
            p.write_text(json.dumps({"parse": {"wikitext": row}}))
            out = common.load_ratings(p, "House")
        self.assertEqual(out["AL-02"]["scores"], [0.0, 1])
        self.assertEqual(out["AL-02"]["inc_party"], "D")

    def test_rating_score(self):
        self.assertEqual(common.rating_score("Safe", "R"), -3)
        self.assertEqual(common.rating_score("Tilt", "D"), 0.5)
        self.assertEqual(common.rating_score("Lean", "I"), 1)
        self.assertEqual(common.rating_score("Tossup", ""), 0.0)


class TestPolls(unittest.TestCase):
    def test_end_dates(self):
        self.assertEqual(common.poll_end_date("October 20–26, 2026", 2026), dt.date(2026, 10, 26))
        self.assertEqual(common.poll_end_date("September 30 – October 2, 2026", 2026), dt.date(2026, 10, 2))
        self.assertEqual(common.poll_end_date("Oct 7, 2026", 2026), dt.date(2026, 10, 7))

    def test_maine_table(self):
        polls = common.load_wiki_polls(common.fetch_senate_race_page(2026, "ME", False, False), 2026)
        self.assertGreater(len(polls), 10)
        for p in polls:
            self.assertLess(abs(p["margin"]), 40)
            self.assertIn(p["non_r_party"], ("D", "I"))
            self.assertLessEqual(p["end"], dt.date(2026, 10, 30))

    def test_independents_detected(self):
        """Osborn (NE) is the main non-Republican: the model must treat NE-SEN as an independent race."""
        _, _, non_r, _ = model.senate_polls("NE", False)
        self.assertEqual(non_r, "I")

    def test_poll_average(self):
        polls = [
            {"pollster": "A", "partisan": False, "days": 5, "n": 1000, "margin": 4.0, "pop": "LV"},
            {"pollster": "A", "partisan": False, "days": 5, "n": 1000, "margin": 10.0, "pop": "RV"},  # LV wins
            {"pollster": "A", "partisan": False, "days": 20, "n": 1000, "margin": -50.0},  # older poll, same pollster
            {"pollster": "B", "partisan": True, "days": 5, "n": 1000, "margin": -2.0},  # half weight
            {"pollster": "C", "partisan": False, "days": 40, "n": 1000, "margin": 99.0},  # outside the window
        ]
        avg, n = backtest.poll_average(polls)
        self.assertEqual(n, 2)
        self.assertAlmostEqual(avg, (4.0 * 1 + -2.0 * 0.5) / 1.5)
        self.assertEqual(backtest.poll_average([]), (None, 0))

    def test_raw_polls_orientation(self):
        """538 polls are oriented non-R minus R whichever candidate is listed first."""
        polls = common.load_raw_polls(common.fetch_fte("raw_polls", False))
        az = [p for p in polls if p["key"] == (2020, "AZ", True)]
        tx = [p for p in polls if p["key"] == (2018, "TX", False)]
        self.assertTrue(az and tx)
        self.assertTrue(all(p["margin_actual"] > 0 for p in az))  # Kelly (D) won the 2020 AZ special
        self.assertTrue(all(p["margin_actual"] < 0 for p in tx))  # Cruz (R) beat O'Rourke in 2018


class TestBacktest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.races = backtest.history(False)

    def test_solve_recovers_coefficients(self):
        rng = random.Random(1)
        rows = []
        for _ in range(200):
            x = [rng.uniform(-10, 10), rng.uniform(-3, 3), 1.0]
            rows.append((x, 0.4 * x[0] + 6.0 * x[1] - 1.5))
        for got, want in zip(backtest.solve(rows), [0.4, 6.0, -1.5]):
            self.assertAlmostEqual(got, want, places=5)

    def test_history_shape(self):
        house = [r for r in self.races if r["chamber"] == "House"]
        senate = [r for r in self.races if r["chamber"] == "Senate"]
        self.assertEqual(len(house), 2655)  # same scored seats as uniform_swing's backtest
        self.assertGreater(len(senate), 200)
        self.assertGreater(sum(r["poll"] is not None for r in senate), 180)
        for r in self.races:
            self.assertIn(r["sign"], (1, -1))

    def test_unrated_seat_side(self):
        """Unrated = Safe for the favorite: a crossover incumbent only within a few points of lean."""
        self.assertEqual(backtest.safe_side({"pred": 3.0, "x_run": -1}), -1)    # R incumbent, D+3 seat
        self.assertEqual(backtest.safe_side({"pred": 22.8, "x_run": -1}), 1)    # CA-01 after the 2025 redraw
        self.assertEqual(backtest.safe_side({"pred": -15.0, "x_run": 0}), -1)   # open seat follows the lean

    def test_held_out_cycle_cannot_see_its_results(self):
        """Leakage test: scrambling 2018's results must not change 2018's out-of-sample forecasts."""
        spec = backtest.VARIANTS[backtest.FINAL]
        pats = {backtest.pattern(r, spec) for r in self.races}
        for r in self.races:
            r["gb_correction"] = 0.0

        def forecast(races):
            params = backtest.fit([r for r in races if r["cycle"] != 2018], spec, pats)
            return [backtest.predict(r, spec, params)[1] for r in races if r["cycle"] == 2018]

        before = forecast(self.races)
        scrambled = [dict(r, actual=-r["actual"], sign=-r["sign"]) if r["cycle"] == 2018 else dict(r)
                     for r in self.races]
        self.assertEqual(before, forecast(scrambled))

    def test_ensemble_beats_baseline_out_of_sample(self):
        scores = {(r["scope"], r["variant"]): float(r["log_loss"])
                  for r in common.read_rows(backtest.RESULTS / "backtest_scores.csv")}
        for scope in ("House", "House midterms"):
            self.assertLess(scores[(scope, backtest.FINAL)], scores[(scope, "uniform_swing v2")])
        for scope in ("Senate", "Senate midterms"):
            self.assertLess(scores[(scope, backtest.FINAL)], scores[(scope, "fundamentals")])

    def test_calibrated(self):
        """Observed upsets fall inside the 95% interval of the expected rate in every probability bin."""
        for c in common.read_rows(backtest.RESULTS / "backtest_calibration.csv"):
            n = int(c["races"])
            if n < 20:
                continue
            rate = float(c["expected_upsets"]) / n
            lo, hi = common.wilson(int(c["observed_upsets"]), n)
            self.assertTrue(lo - 0.005 <= rate <= hi + 0.005, c)


class TestNewsLayer(unittest.TestCase):
    def test_frozen_research_file(self):
        rows = common.read_rows(sorted((common.RAW / "llm_news").glob("news_*.csv"))[-1])
        template = {t["race_id"] for t in common.load_template("full_congress_track_template.csv")}
        self.assertEqual(len({r["race_id"] for r in rows}), len(rows))
        for r in rows:
            self.assertIn(r["race_id"], template)
            self.assertIn(int(r["quality_edge"]), range(-2, 3))
            self.assertIn(int(r["news_edge"]), range(-2, 3))
            self.assertNotRegex(r["sources"], re.compile(r"kalshi|polymarket|predictit", re.I))

    def test_adjustments_are_centred_and_bounded(self):
        news, _, _, _ = model.load_news()
        adj = [r["adjustment"] for r in news.values()]
        self.assertAlmostEqual(sum(adj) / len(adj), 0.0, places=9)
        self.assertTrue(all(abs(a) <= 2.5 + 1.0 for a in adj))


class TestSimulation(unittest.TestCase):
    def test_seeded_and_reproducible(self):
        races = [{"chamber": "House", "m": m, "p_d": common.cdf(m / 6.0, 30), "scale": 6.0, "df": 30}
                 for m in (-3.0, 0.5, 2.0, 40.0)]
        races += [{"chamber": "Senate", "m": 1.0, "p_d": common.cdf(1.0 / 5.0, 4), "scale": 5.0, "df": 4}]
        a = model.simulate([dict(r) for r in races], 2.2)
        b = model.simulate([dict(r) for r in races], 2.2)
        self.assertEqual(a, b)
        self.assertTrue(all(1 <= s <= 4 for s in a["House"]))  # the 40-point seat is always won


class TestOutputs(unittest.TestCase):
    def test_every_model_predictions_valid(self):
        for p in sorted(common.MODELS.glob("*/predictions.csv")):
            rows = common.validate_predictions(p)
            for r in rows:
                self.assertEqual(r["predicted_winner_party"] == "R", float(r["p_d"]) <= 0.5, (p, r))

    def test_ensemble_independents(self):
        rows = {r["race_id"]: r for r in common.read_rows(common.MODELS / "ensemble" / "predictions.csv")}
        for rid in ("NE-SEN", "MT-SEN", "SD-SEN"):
            self.assertIn(rows[rid]["predicted_winner_party"], ("I", "R"))

    def test_every_submission_valid(self):
        templates = {"senate": common.load_template("senate_track_template.csv"),
                     "full_congress": common.load_template("full_congress_track_template.csv")}
        files = sorted(common.MODELS.glob("*/submission/*.csv")) + sorted((ROOT / "submission").glob("*.csv"))
        self.assertTrue(files)
        for f in files:
            track = "senate" if f.stem.endswith("senate") else "full_congress"
            common.validate_submission(f, templates[track])
            with open(f, newline="") as fh:
                self.assertEqual(next(csv.reader(fh)), list(templates[track][0].keys()))

    def test_models_never_read_kalshi(self):
        """Hard rule 4: only decide.py touches market prices."""
        for p in common.MODELS.glob("*/*.py"):
            text = p.read_text()
            self.assertNotRegex(text, re.compile(r"kalshi|^\s*(import|from)\s+decide", re.I | re.M), p)


if __name__ == "__main__":
    unittest.main()
