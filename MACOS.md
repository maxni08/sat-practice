# SAT Practice on Apple Silicon macOS

The macOS build uses the existing 3,770-question bank and creates a **new, independent** SQLite database at `~/Library/Application Support/com.local.satpractice/progress.sqlite3` on first launch. It does not copy Windows progress. Desmos opens in a separate in-app WebKit window and needs internet access.

Build on an Apple Silicon Mac with macOS 15.5, Xcode Command Line Tools (`xcode-select --install`), Node.js 22 or 24, pnpm 11, and Rust 1.88 or newer. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
rustup target add aarch64-apple-darwin
node scripts/desktop.mjs build --target aarch64-apple-darwin --bundles app,dmg
```

The native results are `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/SAT Practice.app` and `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/SAT Practice_1.4.3_aarch64.dmg` (Tauri may add the macOS version to the DMG filename). Check the exact name in that directory.

For private unsigned installation, macOS Gatekeeper may require opening the app through Finder's **Open** context-menu action and confirming in **System Settings → Privacy & Security**. No Apple developer signature or notarization is configured.
