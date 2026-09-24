# SAT Practice for Windows

A focused, private desktop app for practice with the supplied College Board SAT Suite Question Bank exports. Tauri 2, React, TypeScript, and SQLite. The interface follows the supplied Bluebook layout: a quiet white workspace, explicit answer submission, passage/question panes, and persistent study tools.

The study extension adds subtle XP/levels, 64 core achievements (including Platinum) and 10 optional Secret Achievements, skill mastery, adaptive practice, spaced mistake review, timed Practice Modules and full two-module sections. [STUDY-RULES.md](STUDY-RULES.md) documents every calculation, anti-farming rule, module blueprint and safe database migration. The original 3,770-question bank and 13,683 assets are unchanged. [ACHIEVEMENTS.md](ACHIEVEMENTS.md) documents catalog validity, preserved XP during historical backfill, original SVG badges and reduced-motion support.

## Launch and build

See [WINDOWS.md](WINDOWS.md) for prerequisites and troubleshooting. From Windows PowerShell:

```powershell
Set-Location 'C:\Users\sansp\Documents\Codex\2026-09-07\i-want-you-to-build-a'
pnpm.cmd install --frozen-lockfile
pnpm.cmd desktop
```

Production build:

```powershell
pnpm.cmd desktop:build
```

To generate both Windows installer formats:

```powershell
node scripts/desktop.mjs build --bundles nsis,msi
```

The build creates `src-tauri\target\release\sat-practice.exe` and an NSIS setup executable under `src-tauri\target\release\bundle\nsis`. Ready-to-use copies and the final verification record are in `outputs`. The installed app needs only WebView2, not Node, Rust, or Python. It is unsigned.

For this workspace, the existing bundled runtime is also available without a global Node installation:

```powershell
& 'C:\Users\sansp\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\scripts\desktop.mjs dev
& 'C:\Users\sansp\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\scripts\desktop.mjs build
```

## Rebuild the question bank

The processed bank ships with the source; ordinary launches and builds do not need to parse PDFs again. Rebuilding requires Python 3.11+ and the pinned PyMuPDF dependency:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\scripts\requirements.txt
.\.venv\Scripts\python.exe .\scripts\import_bank.py --source-dir 'C:\Users\sansp\Desktop\SAT'
pnpm.cmd desktop:build
```

No PowerShell activation script is needed. Quoted paths support spaces. See [scripts/README.md](scripts/README.md) for importer options, validation, and source-fidelity decisions. Generated questions and assets live in `public\bank`; reports live in `reports`.

## Practice

- Pick Reading & Writing or Math. Combine domains, skills, and difficulties; unselected metadata filters mean all. Choose all, unanswered, ever incorrect, ever correct, or marked questions.
- Set a question count, source or random order, and no timer, per-question timing, or a session timer. Timers notify at zero and allow continued practice; hiding the timer does not pause it.
- Select A–D or enter a numeric answer, then press **Submit Answer**. Only submission reveals the correct answer and the College Board explanation. Fractions, decimals, negative values, and alternative accepted answers are supported.
- Cross-out controls are separate from answer selection. Mark for Review, notes, and yellow text highlights are saved per question. Turn highlighting on, then select text. Original-format views preserve special source formatting.
- Use the question navigator to jump within the set. Finish to see correct/total, accuracy, timing, domain/skill results, and missed-question review. Custom practice and sections report raw scores only. Full SAT Mock adds a clearly labeled, uncalibrated Estimated SAT Score range; see MOCK-AND-LADDER.md.
- Progress shows unique attempted questions, accuracy across attempts, subject/domain/skill/difficulty breakdowns, average time, weakest skills, and an incorrect-question bank. "Incorrect before" includes questions later answered correctly.
- Math includes an offline formula reference and the official Desmos calculator in a separate resizable window inside the desktop application. Desmos requires internet. Its remote page has no access to local study data.

**Adaptive Practice** mixes weak material, developing skills and retention, with gradual difficulty adjustments and repetition limits. Home and Progress recommendations launch targeted or due-review sessions. **Practice Modules** use 27 questions/32 minutes for Reading & Writing and 22 questions/35 minutes for Math. Module answers remain editable and secret until completion or expiry; full sections run two modules with an untimed transition. Module History retains results and reviewable explanations. Routing and difficulty mixtures are documented practice approximations, not College Board's proprietary adaptive scoring.

Keyboard: A/B/C/D select choices; Enter submits or moves on when the page has focus; left/right navigate; Escape closes dialogs. Shortcuts do not intercept typing in inputs or notes. Numeric-entry Enter submits that response.

## Local persistence

The immutable question bank is bundled into the app separately from progress. SQLite is stored under Tauri's Windows app-data directory, normally `%APPDATA%\com.local.satpractice\progress.sqlite3`. **About & storage** shows the exact path. No progress is written beside the executable or into Program Files.

Each submission saves the updated attempt totals and session checkpoint in one SQLite transaction. Notes, highlights, flags, drafts, eliminations, and navigation save immediately; active time checkpoints every five seconds. Completed answers survive restart. Home offers to resume an unfinished set. The session timer continues across application closures; per-question timing counts active practice. Close the app before backing up the SQLite database.

Schema version 2 adds study tables without resetting legacy progress. Version 1 receives a consistent `progress-before-v2.sqlite3` backup before migration. XP, evidence, mastery, achievements, review schedules and module history commit atomically with answers. Resetting one question retains its earned XP/achievement credit and completed module history to prevent repeat farming.

Browser development preview uses clearly identified, separate browser storage. It is not the Windows persistence mechanism, and native save failures never silently switch to browser storage.

## Architecture

| Area | Source |
|---|---|
| PDF segmentation, metadata, asset preservation, validation | `scripts/import_bank.py` |
| Immutable imported bank | `public/bank/questions.json`, `public/bank/assets` |
| Shared types | `src/types.ts` |
| Answer equivalence | `src/lib/answers.ts` |
| Filters and session generation | `src/lib/session.ts` |
| Statistics | `src/lib/statistics.ts` |
| XP, mastery, adaptive selection, review, module blueprints | `src/study` |
| Persistence boundary | `src/lib/persistence.ts` |
| Native SQLite transactions and schema | `src-tauri/src/storage.rs` |
| Native commands and isolated calculator window | `src-tauri/src/lib.rs` |
| Home and application state | `src/App.tsx` |
| Setup, practice, annotations, reference, results | `src/components` |
| Windows packaging | `src-tauri/tauri.conf.json`, `scripts/desktop.mjs` |

## Tests

```powershell
pnpm.cmd test
pnpm.cmd test:native
pnpm.cmd test:ui
.\.venv\Scripts\python.exe -m unittest discover -s scripts -p 'test_import_bank.py'
```

Frontend tests cover answer equivalence, malformed responses, filters, randomization, session timing, repeated submission, statistics, and persistence ordering. Native tests cover SQLite durability, atomic rollback, input validation, reset isolation, and Windows paths with spaces. UI tests exercise the actual app flows and responsive layouts. The final native executable/installer test results and exact limitations are recorded in `outputs\VERIFICATION.md`.

This is an independent personal study application, not a College Board product. The supplied question content remains attributed to College Board. Keep the bank and packaged app for the requested private use.



## Version 1.3.0 — progression

Home and Progress now show a permanent performance-based SAT Rank, campaign position, stars and the next objective alongside the original XP level. Open **Campaign & Records** for 96 stages across the eight SAT domains, eight bosses, three-star objectives, your personal ghost, daily/weekly quests, study streaks and personal records. Six capped Ascension tiers unlock after clearing the campaign. The existing Challenge Ladder and all previous study modes remain available.

See [PROGRESSION.md](PROGRESSION.md) for deterministic rules and migration details. No question-bank regeneration is needed for this update. The pre-upgrade source is tagged `stable-1.2.0`.
