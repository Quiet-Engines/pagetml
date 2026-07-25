# src-tauri — status and finishing notes

**Status (2026-07-23): compiled, launched, and driven on macOS.** The scaffold
built clean on the first `cargo check` (no API drift). Verified in the running
shell: window + chrome load, the dialog command bridge, and CLI-argument open →
`pagetml://` serving → runtime injection → pagination. Two launch bugs were
found and fixed in that pass:

- An `open-document` event emitted from `setup()` fires before the page's JS
  exists and is lost — the shell keeps the document URL in state and replays
  it through the same event once the chrome invokes `frontend_ready`.
- The injected runtime only booted via `?fixture=` or `loadDocument`; on a
  `pagetml://` document it now boots directly (the document IS the content).

The app menu (`install_menu`) is built and verified: File > Open… (⌘O) fires
the `open` menu event → `pick_and_open` (the same dialog the dropzone uses),
plus standard App/Edit/Window items. Verified via the Accessibility API
(menu structure + the Open event reaching the handler).

OS file association is now verified end-to-end against a real `.app` bundle
(QE-1447, `npm run test:fileassoc`): a `.html` opened through Launch Services
reaches the app via `RunEvent::Opened`, opens, and paginates. This caught a
startup-race bug — `RunEvent::Opened` can fire before `setup()` initializes
the store, so `open_path` now initializes it itself (`ensure_store_loaded`,
idempotent) instead of assuming setup won the race; otherwise the opened
document was added to state that setup then clobbered with the empty on-disk
load, and the file opened into a void.

Packaging (QE-1448): `Entitlements.plist` (hardened-runtime JIT for WebKit) +
`bundle.macOS` (minimumSystemVersion, entitlements). `npx tauri build`
produces a self-contained `.app` (embedded assets — works offline) and `.dmg`.
Developer ID signing + notarization are wired via env at build time (see the
signing note below); local builds are ad-hoc signed.

Still native-unverified: dock-icon drag-drop, and the QE-1431 follow-up below.

**WKWebView CSP finding (QE-1431):** WebKit does not stop `connect-src`
traffic — a `no-cors` fetch leaves despite the CSP header (see README go/no-go
section). The `pagetml://` CSP header is necessary but not sufficient on
macOS: add a `WKContentRuleList` blocking non-`pagetml://` loads, relaxed by
the per-file remote toggle.

## First run

```bash
# From the repo root:
npm install                      # pulls @tauri-apps/cli + api (added to package.json)
npm run tauri dev                # builds src-tauri + launches the window over the Vite dev server
```

If `npm run tauri` can't find the CLI, `cargo install tauri-cli --version '^2'` and
use `cargo tauri dev` instead.

## Resolved during the 2026-07-23 native bring-up

1. **Icons** — generated into `src-tauri/icons/` from the brand mark
   (`public/brand/mark.svg` on the logo branch) via `npm run tauri icon`.
2. **Content runtime** — `npm run build:runtime` writes the self-contained
   bundle to `resources/content-runtime.js`, which lib.rs embeds via
   `include_bytes!` (build.rs rebuilds on change). Embedding avoids the
   dev-vs-release resource-dir mismatch — `resolve(Resource)` pointed at
   `target/debug/` in dev but the bundle config nested it under `resources/`,
   so it was never found. The bundle is git-ignored, so `tauri dev`/`tauri
   build` regenerate it first (before-commands); a bare `cargo build` needs it
   prebuilt and build.rs fails with that instruction if it's missing. After
   editing runtime sources, re-run `build:runtime`; cargo picks it up next build.
3. **Frontend build layout** — `dist/app/index.html` confirmed.
4. **Start-screen sample docs** — gated behind `!isNative()`.
5. **macOS "Open" event** — `RunEvent::Opened` handled in `run()`; verified
   against a real bundle (see status above, `npm run test:fileassoc`).
6. **Tauri v2 API drift** — none; compiled clean against tauri 2.11.

## macOS signing & notarization (QE-1448)

A local `npx tauri build` produces an **ad-hoc-signed** `.app`/`.dmg` — fine for
local testing (file association, launch), not for distribution. For a signed +
notarized build, provide these in the environment and re-run `tauri build`
(Tauri v2 reads them; the config carries the entitlements + hardened runtime):

```bash
# The Developer ID Application cert must be in the login keychain.
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
# Notarization — either an App Store Connect API key…
export APPLE_API_ISSUER=<issuer-uuid>
export APPLE_API_KEY=<key-id>
export APPLE_API_KEY_PATH=/path/to/AuthKey_<key-id>.p8
# …or an Apple ID + app-specific password:
export APPLE_ID=<apple-id> APPLE_PASSWORD=<app-specific-password> APPLE_TEAM_ID=<TEAMID>
```

arm64-only for now (this milestone); a universal build additionally needs
`rustup target add x86_64-apple-darwin` and `tauri build --target universal-apple-darwin`.

## Presentation display handling (QE-1446)

Native macOS fullscreen for presentation, not the webview's element-fullscreen:
the chrome calls `set_native_fullscreen` (→ `window.set_fullscreen`) in the
native build; the browser build keeps HTML5 `requestFullscreen`. There is no
dedicated fullscreen event, so the window's `Resized` handler emits
`fullscreen-changed` with `is_fullscreen()`. The chrome uses that to (a)
re-lock the engine at the display resolution once fullscreen enters, and (b)
drop back to reading mode when macOS *leaves* fullscreen — Esc, the green
button, or the presenting display disconnecting (the M3 disconnect rule). A
seen-fullscreen guard ignores the transient `false` during the enter animation.

Verified: chrome logic in `tests/native.spec.ts` (mocked bridge); the
`fullscreen-changed` emit confirmed firing against a real bundle when the
window enters fullscreen. **Manual QA (§7):** notch handling, and the physical
display-disconnect (can't be simulated headlessly).

## Remaining TODO

- **`WKContentRuleList` network gate** (see CSP finding above).

## Persistent store (QE-1434)

`store.json` in the app-data dir, owned by the shell: remembered documents
(newest first, current always at the front, capped at 10), each with its real
path, per-file "allow remote" flag, and last read position (the engine's
content anchor, stored opaquely). Written through on every mutation. The
`open-document` event carries `remote` + `position`, so the chrome renders the
toggle and restores the position without touching localStorage — which is
dev-only (display-name-keyed, so two files named `report.html` would collide).

## What maps to what

- `src/lib.rs` `handle_pagetml` → QE-1429 (`pagetml://` + Rust traversal guard + CSP).
- `open_path` / `open_dialog` / CLI arg / file association → QE-1428 (native open).
- `WebviewWindowBuilder` + `install_menu` in `setup` + `tauri.conf.json` → QE-1427 (window/menus).
- `src/chrome/native.ts` → the frontend side of the bridge (inert in the browser
  build, so the 77 Playwright checks are unaffected).
