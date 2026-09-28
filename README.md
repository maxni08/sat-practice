# SAT Practice 1.5.0

A local-first Windows SAT study app built with **Tauri 2, React, TypeScript, and SQLite**. It is an independent study tool and is not affiliated with or endorsed by College Board.

## Study features

- 3,770 validated built-in questions for Math and Reading & Writing.
- Custom, Adaptive, Endless, Hard Module, and local 1v1 practice; timed Practice Modules, Full Sections, and Full SAT Mock.
- Spaced/error review, question history, Finder and Browser, Study Queue, More Like This, Error Notebook, pacing analytics, Line Reader, and image zoom.
- Desmos graphing calculator and SAT Math reference sheet.
- XP and levels, performance-based SAT Rank, a 96-stage Campaign with 288 stars and bosses, quests, study streaks, achievements, Personal Records, Ghost Mode, Ascension, and active-study playtime.
- Local SQLite progress; no accounts or cloud sync.

## Extensible question library

SAT Practice 1.5.0 can load external question sources without rebuilding the app:

`external source → .satpack → SAT Practice`

It discovers `.satpack` files, validates them, and manages them through Question Sources. Packs use stable source/question IDs; manual questions and structured JSON/CSV imports are also supported. Sources can be filtered or disabled/removed while preserving their attempt history. **Arbitrary PDFs are not imported directly**; a source-specific converter must produce the documented `.satpack` format. See [Question Packs](QUESTION_PACKS.md).

## Local data

Study progress is stored in SQLite in the operating system's app-data directory and is not included in this repository. The built-in question bank is separate from user progress. Never commit personal databases or backups.

## Windows development and build

Install the prerequisites in [WINDOWS.md](WINDOWS.md), then from the repository directory in PowerShell:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd desktop
```

Create a production build with:

```powershell
pnpm.cmd desktop:build
```

To build the NSIS and MSI installers:

```powershell
node scripts/desktop.mjs build --bundles nsis,msi
```

The project also provides `pnpm.cmd test`, `pnpm.cmd test:native`, and `pnpm.cmd test:ui`. Rebuilding the built-in bank is optional; see [scripts/README.md](scripts/README.md) for the importer and its source-specific inputs.

## macOS

The codebase uses Tauri's cross-platform APIs, but the released application documented here is the Windows build. See [MACOS.md](MACOS.md) for platform-specific notes; macOS support should be treated as unverified for this release.

## Score estimate

Full SAT Mock may show an **Estimated SAT Score** range. It is a practice approximation, not an official score or a replication of College Board's proprietary scoring.

## Question-content notice

The built-in question bank is based on the supplied College Board SAT Suite Question Bank exports and is provided for the requested personal study use. SAT Practice is independent of College Board.
