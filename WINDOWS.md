# Windows development and packaging

SAT Practice targets Windows 11 x64 and Windows 10 x64 with the standard Microsoft Edge WebView2 runtime. The interface uses Windows window decorations and Tauri's normal per-monitor DPI handling. No account is needed. Questions, progress, notes, and highlights work offline; the official Desmos calculator requires an internet connection.

## Prerequisites

- Node.js 22 LTS (22.12 or newer) or Node.js 24 LTS; use the official Windows installer and reopen PowerShell afterward.
- pnpm 11.19.0, pinned by `package.json`, and the checked-in `pnpm-lock.yaml`. Install using `npm.cmd install --global pnpm@11.19.0` if pnpm is absent.
- Rust stable MSVC x64. The development environment used Rust 1.98.1; the resolved Rust dependencies are pinned in `src-tauri/Cargo.lock`. Install from [rustup](https://rustup.rs/), select `x86_64-pc-windows-msvc`, and reopen PowerShell. `rustup default stable-msvc` selects the supported Windows toolchain.
- Visual Studio 2022 Build Tools, **Desktop development with C++** workload, MSVC v143 x64/x86 tools, and a Windows 10 or Windows 11 SDK. These are build requirements, not requirements for the person running the packaged app.
- Microsoft Edge WebView2 **Evergreen Runtime**. Windows 11 normally includes it. The NSIS installer checks for it and uses Tauri's official download-bootstrapper mode if it is missing (that initial installation needs internet).
- For rebuilding the question bank only: Python 3.11 or newer and `scripts/requirements.txt` dependencies. Python is not bundled into, or required to run, the application.

The official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [Windows packaging guide](https://v2.tauri.app/distribute/windows-installer/) describe the supported toolchain.

## PowerShell commands

Run these from the repository folder. Paths with spaces are supported; quote the location when changing directories.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd desktop
```

To build a release executable and per-user NSIS installer:

```powershell
pnpm.cmd desktop:build
```

To run the frontend and native database tests:

```powershell
pnpm.cmd test
node scripts/desktop.mjs test --locked
pnpm.cmd test:ui
```

The installed-upgrade harnesses under `scripts/` are for controlled release QA with isolated profiles. Routine automated commands use isolated fixtures and are appropriate for everyday development.

Native QA temporarily enables WebView2's localhost debugging port only in the launched process, following [Playwright's WebView2 testing approach](https://playwright.dev/docs/webview2). No debugging listener is configured in production. Keep local verification reports and profiles out of version control.

The `scripts/desktop.mjs` launcher automatically uses a workspace-local Rust toolchain in `work/tooling/` if present; otherwise it uses Rust from PATH. On another computer, install the prerequisites above normally. The equivalent commands without package-manager script dispatch are:

```powershell
node scripts/desktop.mjs dev
node scripts/desktop.mjs build
```

Use `.cmd` on package-manager commands (`pnpm.cmd`, `npm.cmd`) if PowerShell blocks their `.ps1` shims. This avoids changing the execution policy. Do not permanently disable PowerShell security protections.

## Build artifacts and installation

- Executable: `src-tauri\target\release\sat-practice.exe`
- Per-user NSIS installer: `src-tauri\target\release\bundle\nsis\SAT Practice_1.5.0_x64-setup.exe`
- Optional MSI: `node scripts/desktop.mjs build --bundles msi`; output is in `src-tauri\target\release\bundle\msi\`. MSI packaging requires the Windows VBScript optional feature used by the WiX toolchain. NSIS is the default and does not require that feature.

The executable contains the question bank and question assets; it needs no sibling PDF files. Install by opening the NSIS installer, then use **SAT Practice** in the Start menu. The current-user installer does not require writing to Program Files. Builds are unsigned unless signing credentials are configured; Windows SmartScreen may display a publisher warning.

Build downloads (Rust crates, NSIS/WiX tools, and frontend packages) need network access on the first build. The local runtime does not need these tools after installation.

## Local data and backups

User data is stored through Tauri's `app_data_dir()` API, normally:

```text
%APPDATA%\com.local.satpractice\progress.sqlite3
```

The home/progress interface displays the exact database path returned by the running application. The immutable question bank is bundled separately; answering or resetting questions never edits it. SQLite uses durable transactions, WAL journaling, and parameterized statements. Each submitted answer and its session checkpoint are saved in the same transaction.

Version 2 of the SQLite schema safely adds XP, levels, achievements, mastery/evidence, adaptive state, review schedules and module history/answers. It preserves the original progress rows and creates a consistent version-1 backup before migration. See [STUDY-RULES.md](STUDY-RULES.md) for formulas and migration details. Question reset retains earned award credits and completed module history.

Close SAT Practice before copying `progress.sqlite3` for backup. A backup while the app is open must use SQLite's backup API so the database and write-ahead log remain consistent. Reinstalling/upgrading the executable does not relocate progress into the installation directory.

Interrupted sessions are restored from the local database. A session timer uses real elapsed time, so time continues across an interruption. Resetting a question removes its saved attempt history, bookmark, note, and highlights; it does not alter the bank.

## Calculator

The calculator button opens `https://www.desmos.com/calculator` in a resizable **in-app WebView2 window**. Closing that calculator window hides it, retaining its graph while the app stays open. Reopening brings the same calculator back. Closing the main application also closes the calculator.

The [official Desmos API](https://www.desmos.com/api/v1.12/docs/index.html) requires an issued API key, so this application uses the official public calculator page instead. No API key is invented or redistributed. Desmos receives its normal website traffic when the calculator opens; the app does not send it questions, notes, answers, or progress. The remote calculator window has no permission to invoke the app's local database commands. There is no external-browser fallback.

## Troubleshooting

- **`cargo` or linker missing:** install Rust MSVC and the C++ workload/SDK, reopen PowerShell, and retry. The optional `scripts/check-windows.ps1` reports discovered prerequisites.
- **Blank or failing WebView:** repair/install the official WebView2 Evergreen Runtime. Do not substitute a custom Chromium runtime.
- **Cannot save progress:** verify that the displayed app-data directory is writable by your Windows user. No administrator launch is needed. Back up data before repairing or deleting a database.
- **Calculator offline:** reconnect and reopen it. Practice and session state are independent of calculator loading.
- **MSI `light.exe` error:** use NSIS, or enable the VBScript Windows optional feature for the WiX build toolchain as documented by Tauri.
- **PDFs moved:** pass their new quoted paths to the importer command in `README.md`; the installed app does not need the originals.

## Verification

Run the development, native, and UI test commands above before making a release. Generated verification reports and installers are kept out of Git.


