# Question-bank ingestion

The importer uses Python 3.11 or newer, PyMuPDF, and Pillow. The application itself does not need Python.

From the repository directory in Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\scripts\requirements.txt
.\.venv\Scripts\python.exe .\scripts\import_bank.py --source-dir "C:\Users\sansp\Desktop\SAT"
.\.venv\Scripts\python.exe .\scripts\import_bank.py --validate-only
.\.venv\Scripts\python.exe .\scripts\verify_assets.py
.\.venv\Scripts\python.exe -m unittest discover -s .\scripts -p "test_*.py" -v
```

No PowerShell activation script or execution-policy change is required. The quoted source directory may contain spaces. Alternatively, put both original PDFs in `source-pdfs` and omit `--source-dir`. All output paths default to the repository containing the script, regardless of the current working directory. Use `--output` and `--report-dir` to change destinations.

The PDFs must be named `math-question-bank.pdf` and `reading-writing-question-bank.pdf`. The originals are read without modification. Their SHA-256 hashes and page counts are recorded in `public/bank/manifest.json` and `reports/import-report.json`.

The importer identifies each question from `Question ID:`. It uses the metadata table’s actual column positions and heading names, and derives the test, domain, skill, and difficulty from the source rather than a hard-coded question list. Continuation pages belong to the preceding question until the next Question ID. `Question`, `Answer`, `Correct Answer:`, and `Rationale` headings establish boundaries. Missing critical boundaries or unrecognized answer formats quarantine the question in the report, rather than silently making it playable.

The source PDFs draw most mathematical notation as vector paths without an equivalent text layer. Therefore extracted Math text is only a search/accessibility aid. The application must display each Math `assets` region, each choice’s `assets`, and `rationaleAssets` to preserve equations and visuals. These are lossless 180-DPI PNGs rendered from the actual PDF, cropped to visible content. Blank bottom margins are removed based on rendered pixels, which preserves diagrams that extend below the last extractable text. Choice labels are removed from image fragments because the UI supplies A/B/C/D.

Reading & Writing text remains Unicode and selectable. `TEXT_INHIBIT_SPACES` avoids false word breaks caused by the PDF’s kerning. Wrapped physical lines are joined; meaningful paragraph breaks and list starts are retained. A prompt heuristic creates the passage/question split. Leading graphs and tables are cropped into `passageAssets`, separately from the selectable prose. Underlines are mapped to text offsets where their position can be recovered. `sourceAssets` always supplies an answer-free original-format view preserving emphasis, italics, tables, and graph layout. Questions whose emphasis cannot be mapped safely open in that original view, with a selectable-text toggle. A passage without a reliable split is displayed together with its prompt.

The importer never OCRs, synthesizes, or guesses mathematical expressions or accepted answers. Numeric alternative answers are stored separately exactly as exported, including accepted rounding/truncation, fractions, and negative values. Selecting an answer must not expose `correctAnswer`, `acceptedAnswers`, `rationale`, or `rationaleAssets`; those fields are for explicit submission and review.

The final bank contains 3,770 questions: 1,925 Math and 1,845 Reading & Writing, including 464 numeric responses. Eighty-one missing `Correct Answer:` fields were recovered from explicit answer declarations in the College Board rationale; the JSON report records every recovered ID and accepted value. Two additional Reading & Writing choice-boundary anomalies were repaired, including a source export that formats D as a nested bullet. Five Math exports put A–D labels underneath graphs; the importer detects that layout. Pixel-space separators keep fraction numerators and superscripts inside the correct choice crop. These are repeatable layout rules, not individually hard-coded questions.

Import takes several minutes because every question and explanation is rendered. For a quick development sample, add `--limit 5 --output .\work\sample-bank\bank --report-dir .\work\sample-bank\reports`. This does not overwrite the production bank. A full rebuild replaces the generated JSON and deterministically named assets; unused assets from an older, different source export are harmless and are not referenced by the bank.

Review `reports/import-report.md` for question IDs requiring inspection. Machine checks cover missing metadata, missing question/answer/rationale boundaries, wrong choice counts, numeric answer formats, Unicode replacement characters, sparse transcriptions, duplicates, and missing image files. They cannot prove the semantic correctness of the original College Board answer or perfectly infer every passage/prompt boundary. Refer to `sourcePages` and the original PDF for manual checks.

`verify_assets.py` additionally decodes all 13,683 referenced PNG files, verifies their integrity, and rejects blank content. Its report is `reports/asset-validation.json`. All current questions and assets pass. Twenty-two source-format warnings remain documented for manual inspection; no question is quarantined.
