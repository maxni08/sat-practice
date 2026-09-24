"""Import College Board question-bank PDFs without losing PDF-only mathematics.

Python 3.11+; run from any working directory. Paths with spaces are supported.
Text is for searching/accessibility; all Math and original-format RW regions are
also rendered directly from source. Question/choice crops never include answers.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from functools import lru_cache
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import re
import sys
import time

import fitz
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
FLAGS = fitz.TEXT_INHIBIT_SPACES | fitz.TEXT_PRESERVE_WHITESPACE
QUESTION_ID = re.compile(r"^Question ID:\s*(\S+)")
CHOICE = re.compile(r"^([A-D])\.\s*(.*)$", re.S)
NUMERIC = re.compile(r"^[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*/\s*[+\-−]?(?:\d+(?:\.\d*)?|\.\d+))?$")


@lru_cache(maxsize=8)
def display_list(doc: fitz.Document, number: int):
    # A page's several answer/rationale crops reuse one parsed display list.
    return doc[number].get_displaylist()


@dataclass
class Line:
    page: int
    rect: fitz.Rect
    text: str


def clean_text(value: str) -> str:
    """Join physical wrapped lines, while retaining real paragraph/list breaks."""
    value = value.replace("\xa0", " ").replace("\u00ad", "")
    return re.sub(r"[ \t]+", " ", value).strip()


def read_lines(page: fitz.Page, number: int) -> list[Line]:
    lines = []
    for block in page.get_text("dict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            text = clean_text("".join(s["text"] for s in line["spans"]))
            if text:
                lines.append(Line(number, fitz.Rect(line["bbox"]), text))
    return sorted(lines, key=lambda x: (round(x.rect.y0, 1), x.rect.x0))


def combine_lines(lines: list[Line]) -> str:
    result = ""
    prev = None
    for line in lines:
        if result:
            gap = line.rect.y0 - prev.rect.y1 if prev.page == line.page else 0
            sep = "\n\n" if gap > 10 else " "
            if line.text.startswith(("•", "Text 1", "Text 2")):
                sep = "\n\n"
            result += sep
        result += line.text
        prev = line
    return clean_text(result)


def split_numeric_answers(answer: str) -> list[str]:
    """Separate source-provided alternatives; never invent an accepted answer."""
    answer = clean_text(answer).replace("−", "-").replace("–", "-")
    # A comma in a grouped number is different from the export's comma-space
    # delimiter. E.g. 1,000 is one value, while 0.66, 0.67 are alternatives.
    answer = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", answer)
    parts = re.split(r"\s*(?:;|\bor\b|\bOR\b|,\s+)\s*", answer)
    return list(dict.fromkeys(clean_text(p) for p in parts if p.strip()))


def rationale_answers(rationale: str, question_type: str) -> list[str]:
    """Recover only explicit source answer declarations, never solve or guess.

    Some official exported questions omit the separate Correct Answer field,
    but give an unambiguous answer or accepted alternatives in the rationale.
    """
    text = ' '.join(rationale.split())
    if question_type == 'multiple-choice':
        match = re.match(r'Choice ([A-D]) is (?:correct|the best answer)\b', text)
        return [match.group(1)] if match else []
    notes = re.findall(r'Note that (.+?) (?:are examples of ways to enter a correct answer|is an example of a way to enter a correct answer)', text)
    declarations = re.findall(r'^The correct answer is (.+?)(?:\.\s|\.$)', text)
    for value in notes + declarations:
        value = re.sub(r'\beither\s+', '', value)
        value = re.sub(r',?\s+\b(?:and|or)\b\s+', ', ', value)
        values = split_numeric_answers(value)
        if values and all(NUMERIC.fullmatch(v) for v in values):
            return values
    return []


def position(line: Line, after: bool = False) -> tuple[int, float]:
    return (line.page, line.rect.y1 + 1.5 if after else line.rect.y0 - 1.5)


def region_lines(lines: list[Line], start: tuple[int, float], end: tuple[int, float]) -> list[Line]:
    return [line for line in lines if start <= (line.page, (line.rect.y0 + line.rect.y1) / 2) < end]


def region_clips(doc: fitz.Document, start: tuple[int, float], end: tuple[int, float]):
    for number in range(start[0], end[0] + 1):
        page = doc[number]
        top = start[1] if number == start[0] else 18
        bottom = end[1] if number == end[0] else page.rect.height - 18
        if bottom > top + .2:
            yield number, fitz.Rect(17, max(0, top), page.rect.width - 17, min(page.rect.height, bottom))


def save_region(doc: fitz.Document, start: tuple[int, float], end: tuple[int, float],
                assets_dir: Path, prefix: str, dpi: int, erase: list[tuple[int, fitz.Rect]] | None = None) -> list[str]:
    files = []
    for part, (number, clip) in enumerate(region_clips(doc, start, end)):
        pix = display_list(doc, number).get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), clip=clip,
                                    colorspace=fitz.csRGB, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        for erased_page, erased in erase or []:
            if erased_page == number:
                scale = dpi / 72
                ImageDraw.Draw(img).rectangle((erased.x0 * scale - pix.x - .5, erased.y0 * scale - pix.y,
                                               erased.x1 * scale - pix.x + .5, erased.y1 * scale - pix.y), fill="white")
        # Trim only blank margins. This preserves diagrams extending below the
        # last extractable line, which text-bbox based cropping would lose.
        difference = ImageChops.difference(img, Image.new("RGB", img.size, "white"))
        bbox = difference.point(lambda v: 255 if v > 20 else 0).getbbox()
        if not bbox:
            continue
        bbox = (max(0, bbox[0] - 5), max(0, bbox[1] - 5), min(img.width, bbox[2] + 5), min(img.height, bbox[3] + 5))
        img = img.crop(bbox)
        filename = f"{prefix}-{part + 1}.png"
        img.save(assets_dir / filename, compress_level=4)
        files.append(f"/bank/assets/{filename}")
    return files


def choice_crop_starts(doc: fitz.Document, boundaries, after_answer):
    """Separate choices through actual white space, preserving tall fractions.

    A label's text bounding box is not the top of its mathematical expression:
    fraction numerators and superscripts can extend above it. A white horizontal
    band between choices provides a safe boundary without clipping or leaking
    fragments of the next choice into the previous one.
    """
    starts = [after_answer]
    for i in range(1, len(boundaries)):
        previous, current = boundaries[i - 1][1], boundaries[i][1]
        top = previous.rect.y1 + .5 if previous.page == current.page else 18
        bottom = current.rect.y0
        split = max(18, bottom - 6)
        if bottom > top + 4:
            clip = fitz.Rect(17, top, doc[current.page].rect.width - 17, bottom)
            pix = display_list(doc, current.page).get_pixmap(matrix=fitz.Matrix(1, 1), clip=clip,
                                                           colorspace=fitz.csGRAY, alpha=False)
            img = Image.frombytes('L', (pix.width, pix.height), pix.samples)
            ink = ImageChops.invert(img).point(lambda p: 255 if p > 20 else 0)
            rows = ink.getprojection()[1]
            runs, begin = [], None
            for row, occupied in enumerate(rows + [1]):
                if not occupied and begin is None:
                    begin = row
                elif occupied and begin is not None:
                    if row - begin >= 4:
                        runs.append((begin, row))
                    begin = None
            if runs:
                a, b = runs[-1]
                split = pix.y + (a + b) / 2
        starts.append((current.page, split))
    return starts


def bottom_choice_labels(doc: fitz.Document, boundaries, after_answer) -> bool:
    if not boundaries:
        return False
    first = boundaries[0][1]
    if first.page == after_answer[0] and first.rect.y0 - after_answer[1] < 60:
        return False
    for number, clip in region_clips(doc, after_answer, position(first)):
        if any(fitz.Rect(i['bbox']).intersects(clip) for i in doc[number].get_image_info()):
            return True
        if any(d['rect'].intersects(clip) and d['rect'].height > 25 for d in doc[number].get_drawings()):
            return True
    return False


def choice_boundaries(doc: fitz.Document, lines: list[Line], rationale: str, issues: list[str]):
    # Scientific-name initials in a wrapped answer are not answer labels.
    boundaries = [(i, line, CHOICE.match(line.text)) for i, line in enumerate(lines)
                  if line.rect.x0 < 30 and CHOICE.match(line.text)]
    if [m.group(1) for _, _, m in boundaries] == list('ABC') and 'Choice D' in rationale:
        # An occasional official export misformats D as one nested bullet after
        # C. Recover only when its actual bullet glyph and unique final item
        # are visible, and leave a developer-visible source-format warning.
        candidates = []
        for i in range(boundaries[-1][0] + 1, len(lines)):
            line = lines[i]
            if line.rect.x0 < 40:
                continue
            glyphs = [d['rect'] for d in doc[line.page].get_drawings()
                      if 2 <= d['rect'].width <= 5 and 2 <= d['rect'].height <= 5
                      and line.rect.x0 - 15 <= d['rect'].x0 < line.rect.x0
                      and line.rect.y0 <= d['rect'].y0 <= line.rect.y1]
            if glyphs:
                candidates.append((i, line))
        if len(candidates) == 1:
            i, original = candidates[0]
            line = Line(original.page, original.rect, 'D. ' + original.text)
            lines[i] = line
            boundaries.append((i, line, CHOICE.match(line.text)))
            issues.append('Source formats final D answer as nested bullet; recovered from unique bullet and explicit Choice D rationale')
    return boundaries


def metadata(page: fitz.Page, lines: list[Line], question: Line) -> dict[str, str]:
    header_names = ["Assessment", "Test", "Domain", "Skill", "Difficulty"]
    headers = {line.text: line for line in lines if line.text in header_names and line.rect.y1 < question.rect.y0}
    data = {}
    for i, key in enumerate(header_names):
        if key not in headers:
            data[key] = ""
            continue
        x0 = headers[key].rect.x0 - 1
        x1 = headers[header_names[i + 1]].rect.x0 - 4 if i < 4 and header_names[i + 1] in headers else page.rect.width - 18
        clip = fitz.Rect(x0, headers[key].rect.y1 + 4, x1, question.rect.y0 - 1)
        data[key] = clean_text(page.get_text("text", clip=clip, flags=FLAGS).replace("\n", " "))
    return data


def find_rw_split(lines: list[Line]) -> int:
    # Prompts begin on their own line in these exports. Keep the complete last
    # prompt paragraph (including continuation lines), not just its final line.
    patterns = (r"Which\b", r"What\b", r"Based on\b", r"According to\b", r"As used in\b", r"The student\b")
    matches = [i for i, line in enumerate(lines) if any(re.match(p, line.text) for p in patterns)]
    for i in reversed(matches):
        if "?" in " ".join(line.text for line in lines[i:]):
            return i
    return 0


def underline_ranges(doc: fitz.Document, pages: list[int], text: str) -> list[dict]:
    """Map printed underline strokes to the native passage's character offsets."""
    ranges = []
    for number in pages:
        page = doc[number]
        strokes = [d['rect'] for d in page.get_drawings()
                   if d['rect'].width > 3 and d['rect'].height < 2
                   and ((d.get('fill') is not None and min(d['fill']) < .2)
                        or (d.get('color') is not None and min(d['color']) < .2))]
        if not strokes:
            continue
        raw = page.get_text('rawdict', flags=FLAGS)
        for block in raw['blocks']:
            for line in block.get('lines', []):
                rect = fitz.Rect(line['bbox'])
                chars = [c for span in line['spans'] for c in span['chars']]
                for stroke in strokes:
                    if abs(stroke.y0 - rect.y1) > 2.8:
                        continue
                    phrase = clean_text(''.join(c['c'] for c in chars
                        if stroke.x0 - .2 <= (c['bbox'][0] + c['bbox'][2]) / 2 <= stroke.x1 + .2))
                    if not phrase:
                        continue
                    start = text.find(phrase)
                    if start >= 0:
                        ranges.append({'start': start, 'end': start + len(phrase)})
    ranges.sort(key=lambda r: r['start'])
    merged = []
    for item in ranges:
        if merged and (item['start'] <= merged[-1]['end'] or not text[merged[-1]['end']:item['start']].strip()):
            merged[-1]['end'] = max(merged[-1]['end'], item['end'])
        else:
            merged.append(item.copy())
    return merged


def rw_graphic_end(doc: fitz.Document, lines: list[Line], start, end):
    """Find a leading chart/table and its captions, ending before prose begins.

    Tables/plots have tall geometry; underlines alone do not. The supplied
    export places visuals before prose, so retain the entire leading region
    (including legend and title) rather than guessing individual diagram parts.
    """
    for page_no, clip in region_clips(doc, start, end):
        page = doc[page_no]
        rects = [fitz.Rect(im["bbox"]) for im in page.get_image_info() if fitz.Rect(im["bbox"]).intersects(clip)]
        for drawing in page.get_drawings():
            rect = drawing["rect"]
            if rect.intersects(clip) and (rect.width > 24 or rect.height > 18):
                # Some PDFs have clipping/background rectangles. Only actual
                # visible strokes or non-white filled content are meaningful.
                fill = drawing.get("fill")
                stroke = drawing.get("color")
                if (fill is not None and min(fill) < .92) or (stroke is not None and min(stroke) < .92):
                    rects.append(rect)
        if not any(rect.height > 18 for rect in rects):
            continue
        last_geometry = max(rect.y1 for rect in rects)
        prose = next((line for line in lines if line.page == page_no and line.rect.y0 > last_geometry + 1
                      and line.rect.x0 < 21 and len(line.text) > 60), None)
        if prose:
            return position(prose)
        return "unresolved"
    return None


def parse_question(doc: fitz.Document, page_numbers: list[int], all_lines: list[Line], assets_dir: Path, dpi: int):
    issues: list[str] = []
    id_line = next(line for line in all_lines if QUESTION_ID.match(line.text))
    qid = QUESTION_ID.match(id_line.text).group(1)
    markers = {name: next((line for line in all_lines if line.text == name), None) for name in ("Question", "Answer", "Rationale")}
    correct = next((line for line in all_lines if line.text.startswith("Correct Answer:")), None)
    if not markers["Question"] or not markers["Rationale"]:
        return None, {"questionId": qid, "pages": [p + 1 for p in page_numbers], "severity": "error", "issues": ["Missing question, correct-answer, or rationale boundary; quarantined"]}
    solution_boundary = correct or markers['Rationale']
    meta = metadata(doc[page_numbers[0]], all_lines, markers["Question"])
    test = meta["Test"]
    if test not in ("Math", "Reading and Writing"):
        issues.append("Unrecognized test metadata")
    for key in ("Domain", "Skill", "Difficulty", "Test"):
        if not meta[key]:
            issues.append(f"Missing metadata: {key}")
    if meta["Difficulty"] not in ("Easy", "Medium", "Hard"):
        issues.append("Unrecognized difficulty")
    body_start = position(markers["Question"], True)
    body_end = position(markers["Answer"] or solution_boundary)
    body_lines = region_lines(all_lines, body_start, body_end)
    rationale_start = position(markers["Rationale"], True)
    rationale_end = (page_numbers[-1], doc[page_numbers[-1]].rect.height - 18)
    rationale_lines = region_lines(all_lines, rationale_start, rationale_end)
    answer = clean_text(correct.text.removeprefix("Correct Answer:")) if correct else ''
    # The numeric answer may wrap to a new line before the Rationale heading.
    answer_tail = region_lines(all_lines, position(correct, True), position(markers["Rationale"])) if correct else []
    if answer_tail:
        answer += " " + combine_lines(answer_tail)
    qtype = "multiple-choice" if markers["Answer"] else "numeric"
    recovered = rationale_answers(combine_lines(rationale_lines), qtype) if not correct else []
    if recovered:
        answer = ', '.join(recovered)
    choices = []
    choice_boundaries = []
    if qtype == "multiple-choice":
        choice_lines = region_lines(all_lines, position(markers["Answer"], True), position(solution_boundary))
        choice_boundaries = globals()['choice_boundaries'](doc, choice_lines, combine_lines(rationale_lines), issues)
        if [m.group(1) for _, _, m in choice_boundaries] != list("ABCD"):
            issues.append("Expected precisely A, B, C, D choice boundaries")
        after_answer = position(markers['Answer'], True)
        labels_below = test == 'Math' and bottom_choice_labels(doc, choice_boundaries, after_answer)
        crop_starts = ([after_answer] + [position(line, True) for _, line, _ in choice_boundaries[:-1]]) if labels_below else (choice_crop_starts(doc, choice_boundaries, after_answer) if test == "Math" else [])
        for j, (line_index, line, match) in enumerate(choice_boundaries):
            stop_index = choice_boundaries[j + 1][0] if j + 1 < len(choice_boundaries) else len(choice_lines)
            selected_lines = choice_lines[line_index:stop_index]
            text = combine_lines(selected_lines)
            text = re.sub(r"^[A-D]\.\s*", "", text)
            end = crop_starts[j + 1] if test == 'Math' and j + 1 < len(crop_starts) else (position(choice_boundaries[j + 1][1]) if j + 1 < len(choice_boundaries) else position(solution_boundary))
            if labels_below:
                end = position(line, True)
            # Remove only the printed choice label (the UI supplies A/B/C/D).
            # Do not crop the whole left edge: diagrams may extend beneath it.
            label_boxes = doc[line.page].search_for(match.group(1) + ".", clip=fitz.Rect(17, line.rect.y0 - 2, 36, line.rect.y1 + 2))
            erase = [(line.page, rect) for rect in label_boxes]
            images = save_region(doc, crop_starts[j], end, assets_dir, f"{qid}-choice-{match.group(1)}", dpi, erase) if test == "Math" else []
            choices.append({"label": match.group(1), "text": text, "assets": images})
    accepted = [answer] if qtype == "multiple-choice" else split_numeric_answers(answer)
    fatal = []
    if qtype == "multiple-choice" and (len(choices) != 4 or answer not in [c["label"] for c in choices]):
        fatal.append("Choice boundaries or correct answer are invalid")
    if qtype == "numeric" and (not accepted or any(not NUMERIC.fullmatch(a) for a in accepted)):
        fatal.append("Unrecognized numeric accepted-answer format")
    if fatal:
        return None, {"questionId": qid, "pages": [p + 1 for p in page_numbers], "severity": "error", "issues": issues + fatal, "rawAnswer": answer}
    passage_assets = []
    if test == "Reading and Writing":
        graphic_end = rw_graphic_end(doc, body_lines, body_start, body_end)
        if graphic_end == "unresolved":
            issues.append("Visual/prose boundary requires original-format view")
        elif graphic_end:
            passage_assets = save_region(doc, body_start, graphic_end, assets_dir, f"{qid}-visual", dpi)
            body_lines = region_lines(all_lines, graphic_end, body_end)
    stem = combine_lines(body_lines)
    passage = ""
    if test == "Reading and Writing":
        split = find_rw_split(body_lines)
        if split:
            passage, stem = combine_lines(body_lines[:split]), combine_lines(body_lines[split:])
        else:
            issues.append("Reading passage/prompt split not inferred; displayed together")
    body_assets = save_region(doc, body_start, body_end, assets_dir, f"{qid}-question", dpi)
    rationale_assets = save_region(doc, rationale_start, rationale_end, assets_dir, f"{qid}-rationale", dpi)
    rationale = combine_lines(rationale_lines)
    if not body_assets:
        issues.append("No visible question content")
    if not stem or len(stem) < 8:
        issues.append("Sparse extracted stem; original PDF image retained")
    if not rationale_assets or not rationale:
        issues.append("Missing or sparse rationale")
    if "\ufffd" in stem + passage + rationale + "".join(c["text"] for c in choices):
        issues.append("Unmapped Unicode glyph; original PDF image retained")
    # Preserve diagrams, tables and underlining inline. All questions additionally
    # expose a faithful, answer-free original view for visual verification.
    requires_original = test == "Reading and Writing" and (bool(re.search(r"\bunderlin", stem, re.I)) or "Visual/prose boundary requires original-format view" in issues)
    underlines = underline_ranges(doc, page_numbers, passage) if requires_original and passage else []
    if underlines and "Visual/prose boundary requires original-format view" not in issues:
        requires_original = False
    elif requires_original and not underlines:
        issues.append("Native underline offsets unavailable; original formatting retained")
    q = {"id": qid, "questionId": qid, "test": test, "domain": meta["Domain"], "skill": meta["Skill"],
         "difficulty": meta["Difficulty"], "questionType": qtype, "passage": passage, "stem": stem,
         "choices": choices, "acceptedAnswers": accepted, "correctAnswer": answer, "rationale": rationale,
         "assets": body_assets if test == "Math" else [], "sourceAssets": body_assets,
         "passageAssets": passage_assets, "requiresOriginalFormat": requires_original,
         "passageUnderlines": underlines,
         "assetDpi": dpi, "answerSource": "rationale" if recovered else "correct-answer-field",
         "rationaleAssets": rationale_assets, "sourcePages": [p + 1 for p in page_numbers], "issues": issues}
    finding = {"questionId": qid, "pages": q["sourcePages"], "severity": "warning", "issues": issues} if issues else None
    return q, finding


_WORKER = None


def worker_setup(path: str, assets_dir: str, dpi: int):
    global _WORKER
    _WORKER = (fitz.open(path), Path(assets_dir), dpi)


def worker_parse(payload):
    doc, assets_dir, dpi = _WORKER
    pages, lines = payload
    return parse_question(doc, pages, lines, assets_dir, dpi)


def import_pdf(path: Path, assets_dir: Path, dpi: int, limit: int | None = None, workers: int = 4):
    doc = fitz.open(path)
    questions, findings = [], []
    group_pages, group_lines = [], []
    found = 0
    started = time.monotonic()
    pool = ProcessPoolExecutor(max_workers=workers, initializer=worker_setup,
                               initargs=(str(path), str(assets_dir), dpi)) if workers > 1 else None
    pending = []

    def flush():
        nonlocal found
        if not group_pages:
            return
        if pool:
            pending.append(pool.submit(worker_parse, (group_pages[:], group_lines[:])))
        else:
            pending.append(parse_question(doc, group_pages, group_lines, assets_dir, dpi))
        found += 1
        if found % 250 == 0:
            print(f"{path.name}: queued {found} questions, page {group_pages[-1] + 1}/{len(doc)}, {time.monotonic() - started:.0f}s", flush=True)

    for number, page in enumerate(doc):
        lines = read_lines(page, number)
        starts = [line for line in lines if QUESTION_ID.match(line.text)]
        if starts:
            flush()
            if limit and found >= limit:
                break
            group_pages, group_lines = [], []
            if len(starts) != 1:
                raise ValueError(f"Multiple question starts on page {number + 1}; importer cannot safely infer boundary")
        if group_pages or starts:
            group_pages.append(number)
            group_lines.extend(lines)
        elif lines:
            findings.append({"questionId": None, "pages": [number + 1], "severity": "error", "issues": ["Orphan content before first Question ID"]})
    else:
        flush()
    for n, result in enumerate(pending):
        q, finding = result.result() if pool else result
        if q:
            questions.append(q)
        if finding:
            findings.append(finding)
        if (n + 1) % 250 == 0 or n + 1 == len(pending):
            print(f"{path.name}: rendered {n + 1}/{len(pending)} questions, {time.monotonic() - started:.0f}s", flush=True)
    if pool:
        pool.shutdown()
    source = {"file": path.name, "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
              "pages": len(doc), "questionStarts": found, "imported": len(questions)}
    doc.close()
    return questions, findings, source


def validate_bank(questions: list[dict], public_dir: Path) -> list[dict]:
    findings = []
    seen = set()
    for q in questions:
        problems = []
        if q["id"] in seen:
            problems.append("Duplicate question ID")
        seen.add(q["id"])
        for key in ("questionId", "test", "domain", "skill", "difficulty", "questionType", "correctAnswer"):
            if not q.get(key):
                problems.append(f"Missing {key}")
        paths = q["assets"] + q["sourceAssets"] + q["rationaleAssets"] + q.get("passageAssets", []) + [p for c in q["choices"] for p in c.get("assets", [])]
        for path in paths:
            asset = public_dir / path.lstrip("/")
            if not asset.is_file() or asset.stat().st_size < 80:
                problems.append(f"Missing/empty visual asset: {path}")
        if not q["stem"] and not q["assets"]:
            problems.append("No stem or visual content")
        if not q["acceptedAnswers"]:
            problems.append("No accepted answer")
        if q["questionType"] == "multiple-choice" and len(q["choices"]) != 4:
            problems.append("Incorrect number of choices")
        if q["questionType"] == "multiple-choice":
            for choice in q["choices"]:
                if not choice["text"].strip() and not choice.get("assets"):
                    problems.append(f"Empty choice {choice['label']}")
                if q["test"] == "Math" and not choice.get("assets"):
                    problems.append(f"Missing faithful Math choice asset {choice['label']}")
        if not q.get("rationaleAssets") or not q.get("sourceAssets"):
            problems.append("Missing original question or rationale assets")
        if problems:
            findings.append({"questionId": q["id"], "pages": q["sourcePages"], "severity": "error", "issues": problems})
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "source-pdfs")
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "bank")
    parser.add_argument("--report-dir", type=Path, default=ROOT / "reports")
    parser.add_argument("--dpi", type=int, default=180, help="Lossless PNG resolution (default 180 DPI)")
    parser.add_argument("--limit", type=int, help="Import only this many questions per source, for development")
    parser.add_argument("--workers", type=int, default=4, help="Independent rendering processes (default 4; use 1 on low-memory PCs)")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    assets = args.output / "assets"
    assets.mkdir(exist_ok=True)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    if args.validate_only:
        bank = json.loads((args.output / "questions.json").read_text(encoding="utf-8"))
        failures = validate_bank(bank, args.output.parent)
        print(json.dumps({"questions": len(bank), "errors": failures}, indent=2))
        return 1 if failures else 0
    questions, findings, sources = [], [], []
    for filename in ("math-question-bank.pdf", "reading-writing-question-bank.pdf"):
        path = args.source_dir / filename
        if not path.is_file():
            parser.error(f"Source PDF not found: {path}")
        imported, issues, source = import_pdf(path, assets, args.dpi, args.limit, max(1, args.workers))
        questions.extend(imported)
        findings.extend(issues)
        sources.append(source)
    validation = validate_bank(questions, args.output.parent)
    findings.extend(validation)
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "importerVersion": "1.0.0", "sources": sources,
              "totalQuestions": len(questions), "countsByTest": dict(Counter(q["test"] for q in questions)),
              "countsByType": dict(Counter(q["questionType"] for q in questions)),
              "countsByDifficulty": dict(Counter(q["difficulty"] for q in questions)),
              "renderedMathQuestions": sum(q["test"] == "Math" and bool(q["assets"]) for q in questions),
              "readingWithVisuals": sum(q["test"] == "Reading and Writing" and bool(q.get("passageAssets")) for q in questions),
              "warnings": sum(f["severity"] == "warning" for f in findings),
              "quarantined": sum(s["questionStarts"] - s["imported"] for s in sources),
              "errors": sum(f["severity"] == "error" for f in findings), "findings": findings,
              "recoveredFromRationale": [{"questionId": q["id"], "test": q["test"], "pages": q["sourcePages"], "acceptedAnswers": q["acceptedAnswers"]} for q in questions if q.get("answerSource") == "rationale"],
              "fidelity": "All question bodies and rationales have faithful lossless PDF image assets. Math choices also have image assets. Text extraction does not reconstruct PDF-only equation paths. Reading text is Unicode and selectable. Original-format views preserve formatting and emphasis."}
    (args.output / "questions.json").write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (args.output / "manifest.json").write_text(json.dumps({k: v for k, v in report.items() if k != "findings"}, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.report_dir / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md = ["# Question-bank import report", "", f"Imported **{len(questions):,} questions** from {sum(s['pages'] for s in sources):,} PDF pages.", "", "| Source | Pages | Question starts | Imported |", "|---|---:|---:|---:|"]
    md.extend(f"| {s['file']} | {s['pages']} | {s['questionStarts']} | {s['imported']} |" for s in sources)
    md.extend(["", f"Quarantined: {report['quarantined']}. Warnings: {report['warnings']}. Validation errors: {len(validation)}.", "", report["fidelity"], "", "## Findings", "", "| Question ID | Source pages | Severity | Finding |", "|---|---|---|---|"])
    md.extend(f"| {f['questionId']} | {', '.join(map(str, f['pages']))} | {f['severity']} | {'; '.join(f['issues'])} |" for f in findings)
    if not findings:
        md.append("| — | — | — | No structural anomalies detected. |")
    (args.report_dir / "import-report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("findings", "fidelity")}, indent=2))
    return 1 if validation else 0


if __name__ == "__main__":
    sys.exit(main())
