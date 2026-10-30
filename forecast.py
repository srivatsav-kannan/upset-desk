"""Model Citizens 2026 forecast runner (standard library only).

Run:  python3 forecast.py                        # every model in models/, using cached raw data
      python3 forecast.py --model uniform_swing  # one model (repeatable)
      python3 forecast.py --refresh              # re-download raw data first
      python3 forecast.py --swing 0              # uniform_swing: override the national swing

A model is any folder models/<name>/ with a model.py that defines run(args) and writes
models/<name>/predictions.csv (format: common.PREDICTION_FIELDS). A model that reads another
model's outputs lists it in DEPENDS_ON, and that model runs first. The SUBMISSION_MODEL's
submission CSVs are also copied to the top-level submission/ folder. For each model, decide.py
then compares the predictions with Kalshi and writes that model's results/ and submission/.
"""

import argparse
import importlib
import shutil

import decide
from common import MODELS, TEMPLATES

# The model whose picks are the team's submission: after it runs, its submission CSVs are
# copied to submission/ as <model>_<rule>_<track>.csv (both pick rules, until we choose one).
SUBMISSION_MODEL = "ensemble"


def available() -> list:
    return sorted(p.parent.name for p in MODELS.glob("*/model.py"))


def with_dependencies(names: list, modules: dict) -> list:
    """Run order: a model's DEPENDS_ON models (whose outputs it reads) run before it."""
    order = []

    def visit(name: str) -> None:
        if name not in order:
            for dep in getattr(modules[name], "DEPENDS_ON", []):
                visit(dep)
            order.append(name)
    for n in names:
        visit(n)
    return order


def main() -> None:
    names = available()
    modules = {n: importlib.import_module(f"models.{n}.model") for n in names}
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download raw data")
    ap.add_argument("--model", action="append", choices=names, help="run only this model (repeatable)")
    for m in modules.values():
        if hasattr(m, "add_arguments"):
            m.add_arguments(ap)
    args = ap.parse_args()

    for name in with_dependencies(args.model or names, modules):
        print(f"== {name}")
        modules[name].run(args)
        d = decide.run(MODELS / name, args.refresh)
        print(f"Kalshi snapshot {d['retrieved']}: markets for {d['markets']} of 470 races")
        for r in d["summary"]:
            print(f"  {r['scope']:6} {r['strategy']:21} underdog picks {r['underdog_picks']:3}  "
                  f"E[pts] model {r['expected_points_model']:6.2f}  if Kalshi right {r['expected_points_if_kalshi_right']:6.2f}")
        print(f"wrote models/{name}/predictions.csv, results/ and submission/")
        if name == SUBMISSION_MODEL:
            for f in sorted((MODELS / name / "submission").glob("*.csv")):
                shutil.copyfile(f, TEMPLATES.parent / f"{name}_{f.name}")
            print(f"copied {name}'s submission CSVs to submission/")


if __name__ == "__main__":
    main()
