"""Convert the supplied College Board Question Bank PDF export layout to .satpack.

Reuses the already validated PDF extraction only when both PDF SHA-256 hashes
match its manifest. A changed edition is extracted in an isolated temp folder
using import_bank.py; the built-in bank is never rewritten.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
PDF_NAMES = ("math-question-bank.pdf", "reading-writing-question-bank.pdf")
ASSET_FIELDS = ("assets", "sourceAssets", "rationaleAssets", "passageAssets")
SOURCE_ID = "college-board-sat-suite-qb-pdf"
NUMERIC = re.compile(r"^[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*/\s*[+\-−]?(?:\d+(?:\.\d*)?|\.\d+))?$")


def write_review_md(report: dict, path: Path) -> None:
    validation = report.get("validation", "pending")
    if isinstance(validation, dict):
        validation = f"{validation['result']} ({validation['valid']} valid, {validation['skipped']} skipped, {validation['missingAssets']} missing assets)"
    lines = ["# College Board PDF → .satpack review", "",
             f"Detected: **{report['detected']:,}** · Packed: **{report['packed']:,}** · Review needed: **{report['reviewNeeded']}**",
             f"Assets packaged: **{report['assetsPackaged']:,}** · Metadata inferred: **{report['metadataInferred']}**",
             f"Missing/uncertain answers: **{report['missingOrUncertainAnswers']}** · Uncertain crops: **{report['uncertainImageCrops']}**",
             f"Answers recovered from explicit explanations where the separate answer field was absent: **{report['answersRecoveredFromRationale']}**",
             f"Native validation: **{validation}**",
             "", "The PDF export explicitly supplies Question ID, Test, Domain, Skill, Difficulty, Correct Answer, and Rationale. Choices are A–D where applicable; Math also has numeric entry. The PDF uses vector math and images; faithful question, choice, passage-visual, and explanation crops were made by the source-specific importer. Some questions span pages.",
             "", "The text layer may omit PDF-only math symbols. The associated source-format image preserves them. These exports are also the built-in bank, so loading the optional pack creates a second source with the same study content.",
             "", "## Manual review", "", "| Question ID | Pages | Finding |", "|---|---|---|"]
    for finding in report["findings"]:
        lines.append(f"| {finding['questionId']} | {', '.join(map(str, finding['pages']))} | {'; '.join(finding['issues'])} |")
    if not report["findings"]:
        lines.append("| — | — | None |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_asset(reference: str) -> str:
    if not isinstance(reference, str) or not reference.startswith("/bank/assets/"):
        raise ValueError(f"Unsafe or unexpected asset path: {reference!r}")
    name = reference.removeprefix("/bank/assets/")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)", name):
        raise ValueError(f"Unsafe asset name: {name!r}")
    return f"assets/{name}"


def pack_question(original: dict) -> tuple[dict, set[str]]:
    question = original.copy()
    question["id"] = original["questionId"]
    if original.get("questionType") == "numeric" and original.get("acceptedAnswers"):
        # The PDF's Correct Answer line sometimes lists several equivalent
        # representations. SAT Practice stores one primary answer plus all
        # source-accepted alternatives.
        question["sourceCorrectAnswer"] = original["correctAnswer"]
        question["correctAnswer"] = original["acceptedAnswers"][0]
    paths: set[str] = set()
    for field in ASSET_FIELDS:
        refs = [local_asset(item) for item in original.get(field, [])]
        question[field] = refs
        paths.update(refs)
    question["choices"] = []
    for choice in original.get("choices", []):
        item = choice.copy()
        item["assets"] = [local_asset(ref) for ref in choice.get("assets", [])]
        paths.update(item["assets"])
        question["choices"].append(item)
    return question, paths


def run(source_dir: Path, bank_dir: Path, import_report: Path, output: Path, review_report: Path, workers: int) -> dict:
    source_hashes = {name: sha256(source_dir / name) for name in PDF_NAMES}
    existing = json.loads((bank_dir / "manifest.json").read_text(encoding="utf-8")) if (bank_dir / "manifest.json").is_file() else {}
    reusable = (bank_dir / "questions.json").is_file() and import_report.is_file() and \
        {s["file"]: s["sha256"] for s in existing.get("sources", [])} == source_hashes
    temporary = TemporaryDirectory(prefix="satpack-source-") if not reusable else None
    try:
        if temporary:
            folder = Path(temporary.name)
            bank_dir, import_report = folder / "bank", folder / "reports" / "import-report.json"
            subprocess.run([sys.executable, str(ROOT / "scripts" / "import_bank.py"),
                            "--source-dir", str(source_dir), "--output", str(bank_dir),
                            "--report-dir", str(import_report.parent), "--workers", str(workers)], check=True)
            existing = json.loads((bank_dir / "manifest.json").read_text(encoding="utf-8"))
        questions = json.loads((bank_dir / "questions.json").read_text(encoding="utf-8"))
        extraction = json.loads(import_report.read_text(encoding="utf-8"))
        if len(questions) != sum(s["questionStarts"] for s in existing["sources"]):
            raise ValueError("Detected PDF question count differs from extracted count")
        if extraction["errors"] or extraction["quarantined"]:
            raise ValueError("PDF extraction contains errors or quarantined questions; inspect its report")
        packed, referenced, ids, issues = [], set(), set(), []
        counts = Counter()
        for original in questions:
            qid = original.get("questionId", "(missing ID)")
            try:
                if qid in ids:
                    raise ValueError("duplicate source question ID")
                ids.add(qid)
                item, assets = pack_question(original)
                if not item.get("stem") and not item.get("passage") and not item.get("assets"):
                    raise ValueError("missing question content")
                if not item.get("rationale") or not item.get("correctAnswer"):
                    raise ValueError("missing answer or explanation")
                if item["questionType"] == "multiple-choice":
                    if [c["label"] for c in item["choices"]] != list("ABCD") or item["correctAnswer"] not in "ABCD":
                        raise ValueError("invalid answer choices or key")
                elif item["questionType"] == "numeric":
                    if item["choices"] or not item.get("acceptedAnswers") or any(not NUMERIC.fullmatch(a) for a in item["acceptedAnswers"]):
                        raise ValueError("invalid numeric answer")
                else:
                    raise ValueError("unknown question type")
                packed.append(item)
                referenced.update(assets)
                counts[item["test"]] += 1
            except (KeyError, TypeError, ValueError) as error:
                issues.append({"questionId": qid, "issue": str(error)})
        assets_root = bank_dir / "assets"
        for relative in sorted(referenced):
            path = assets_root / relative.removeprefix("assets/")
            if not path.is_file() or path.stat().st_size < 80:
                issues.append({"asset": relative, "issue": "missing or empty"})
            elif path.stat().st_size > 8_000_000:
                issues.append({"asset": relative, "issue": "exceeds .satpack per-asset limit"})
        if issues:
            raise ValueError(f"{len(issues)} unsafe records/assets; first: {issues[0]}")
        manifest = {"schemaVersion": 1, "sourceId": SOURCE_ID,
                    "sourceName": "College Board SAT Suite Question Bank PDF exports",
                    "packVersion": hashlib.sha256("".join(source_hashes.values()).encode()).hexdigest()[:12],
                    "questionCount": len(packed),
                    "description": "Source-specific conversion of the supplied Math and Reading and Writing PDF exports.",
                    "sourceFiles": [{"file": name, "sha256": value} for name, value in source_hashes.items()]}
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, "w", allowZip64=True) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), compress_type=ZIP_DEFLATED)
            archive.writestr("questions.json", json.dumps(packed, ensure_ascii=False, separators=(",", ":")), compress_type=ZIP_DEFLATED)
            for relative in sorted(referenced):
                archive.write(assets_root / relative.removeprefix("assets/"), relative, compress_type=ZIP_STORED)
        report = {"source": list(source_hashes), "detected": sum(s["questionStarts"] for s in existing["sources"]),
                  "packed": len(packed), "bySubject": counts, "reviewNeeded": len(extraction["findings"]),
                  "findings": extraction["findings"], "missingOrUncertainAnswers": 0,
                  "uncertainImageCrops": 0, "duplicatesOrSkipped": 0,
                  "metadataInferred": 0, "assetsPackaged": len(referenced),
                  "answersRecoveredFromRationale": len(extraction.get("recoveredFromRationale", [])),
                  "reusedValidatedExtraction": reusable, "packBytes": output.stat().st_size,
                  "sourceId": SOURCE_ID, "validation": "structural precheck passed; run native SAT Practice validator separately"}
        review_report.parent.mkdir(parents=True, exist_ok=True)
        review_report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        write_review_md(report, review_report.with_suffix(".md"))
        print(json.dumps({k: v for k, v in report.items() if k != "findings"}, ensure_ascii=False, indent=2))
        return report
    finally:
        if temporary:
            temporary.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "source-pdfs")
    parser.add_argument("--bank-dir", type=Path, default=ROOT / "public" / "bank")
    parser.add_argument("--import-report", type=Path, default=ROOT / "reports" / "import-report.json")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs" / "satpacks" / "CollegeBoardSATQuestionBank.satpack")
    parser.add_argument("--review-report", type=Path, default=ROOT / "outputs" / "satpacks" / "CollegeBoardSATQuestionBank-review.json")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    run(args.source_dir, args.bank_dir, args.import_report, args.output, args.review_report, args.workers)


if __name__ == "__main__":
    main()
