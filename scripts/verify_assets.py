"""Verify every referenced bank PNG decodes and contains visible content.

Run after import_bank.py --validate-only. This does not modify the question bank.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def inspect_asset(item):
    filename, references = item
    try:
        with Image.open(ROOT / "public" / filename.lstrip("/")) as image:
            image.verify()
        with Image.open(ROOT / "public" / filename.lstrip("/")) as image:
            histogram = image.convert("L").histogram()
            ink_pixels = sum(histogram[:200])
            if ink_pixels < 20:
                raise ValueError(f"Suspicious blank image: {ink_pixels} dark pixels")
        return None
    except Exception as error:
        return {"asset": filename, "questionIds": sorted(references), "error": str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=ROOT / "reports" / "asset-validation.json")
    args = parser.parse_args()
    bank = json.loads((ROOT / "public/bank/questions.json").read_text(encoding="utf-8"))
    references = {}
    for question in bank:
        paths = [path for key in ("assets", "sourceAssets", "rationaleAssets", "passageAssets")
                 for path in question.get(key, [])]
        paths.extend(path for choice in question["choices"] for path in choice.get("assets", []))
        for filename in paths:
            references.setdefault(filename, set()).add(question["questionId"])
    with ThreadPoolExecutor(max_workers=8) as pool:
        issues = [issue for issue in pool.map(inspect_asset, references.items()) if issue]
    report = {"questions": len(bank), "uniqueReferencedAssets": len(references), "issues": issues}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    raise SystemExit(bool(issues))


if __name__ == "__main__":
    main()
