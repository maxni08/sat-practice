# Question Packs (.satpack)

SAT Practice 1.5 reads external packs from **Question Library → Open Question Packs Folder**. Drop a completed `.satpack` file there; the app scans at startup and while running. It waits briefly for copies to finish. Import Pack also accepts a `.satpack`, JSON, or CSV file. Built-in questions are never altered.

A `.satpack` is a ZIP archive with `manifest.json`, `questions.json`, and optional `assets/` image files. The portable schema version is `1`:

```json
{"schemaVersion":1,"sourceId":"teacher-set","sourceName":"Teacher Set","packVersion":"2026.1","questionCount":1,"description":"Optional description"}
```

`sourceId` is a stable lowercase identifier of 3–64 ASCII letters, digits, `_` or `-`. Keep it unchanged across updates. The app combines this ID, each question's external ID, and a content hash. A changed question receives a new internal version, so past answers stay attached to the version actually practiced.

`questions.json` is an array of records using the existing SAT Practice question fields:

```json
[{"id":"math:0042","test":"Math","domain":"Algebra","skill":"Linear equations in one variable","difficulty":"Medium","questionType":"multiple-choice","passage":"","stem":"What is x if 2x = 8?","choices":[{"label":"A","text":"2"},{"label":"B","text":"3"},{"label":"C","text":"4"},{"label":"D","text":"6"}],"correctAnswer":"C","rationale":"Divide both sides by 2.","assets":[]}]
```

Use `test` values `Math` or `Reading and Writing`; `difficulty` values `Easy`, `Medium`, or `Hard`; `questionType` values `multiple-choice` or `numeric` (Math only). A multiple-choice question needs four labeled A–D choices and a matching `correctAnswer`. A numeric question has no choices, has a valid numeric/fraction `correctAnswer`, and may include `acceptedAnswers`. `passage`, `assets`, `passageAssets`, `rationaleAssets`, `sourceAssets`, and choice `assets` are optional. Asset paths must be relative `assets/...` PNG, JPEG, GIF, or WebP files inside the archive. Referenced images are validated before import. Equations may be preserved as text/KaTeX-compatible content or as an image.

Domains use the built-in SAT taxonomy: Math has `Algebra`, `Advanced Math`, `Problem-Solving and Data Analysis`, and `Geometry and Trigonometry`; Reading and Writing has `Information and Ideas`, `Craft and Structure`, `Expression of Ideas`, and `Standard English Conventions`. Skills are nonempty, source-defined text within the selected domain.

For structured JSON import, use the same question array, or `{ "questions": [...] }`. CSV uses columns `id,test,domain,skill,difficulty,questionType,passage,stem,A,B,C,D,correctAnswer,acceptedAnswers,rationale`; separate multiple accepted numeric answers with `|`. JSON/CSV cannot reference external assets; use `.satpack` for images.

Future source-specific PDF converters should produce this archive once, including cropped assets. The app intentionally does not parse arbitrary PDFs. Third-party content is untrusted; review the import report and only import questions you have rights to use. Removing or disabling a source hides its questions from new practice but preserves stored attempts. Reimporting the same source and content reconnects that history.

For the supplied College Board PDF export layout, run `python scripts/convert_college_board_pdfs_to_satpack.py`. It produces `outputs/satpacks/CollegeBoardSATQuestionBank.satpack` and a JSON review report. When the two source PDF hashes match the existing validated extraction, it reuses the 13,683 already cropped assets without touching the built-in bank. Changed PDFs are re-extracted into an isolated temporary folder using `scripts/import_bank.py` (Python 3.11+, PyMuPDF and Pillow). This source is already the built-in 3,770-question bank, so importing the optional pack would duplicate its content under a separate source ID; the pack is not added to the production library automatically.
