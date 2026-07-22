# Native handoff — picking up on a desktop machine

Everything platform-agnostic is built and merged on `main`: the pagination
engine, the app chrome (reading + presentation modes), the sandboxed content
frame + message schema, links, the CSP/remote-resources toggle, position
persistence, drag-and-drop/file-picker open, the sandbox test suite, and Help
docs — **77 passing checks** on Chromium.

What's left needs a real desktop build environment (macOS/Windows + the Tauri
toolchain). This is the map for that work.

## Why it couldn't be done in the web sandbox

- No system WebView libraries (`webkit2gtk`/WebView2), no display, no Tauri CLI.
- GitHub Actions has been failing at startup (~2s, no steps) on every run — an
  org-level Actions issue (billing / runners / permissions). **Fix this first**:
  it's what runs the WebKit leg, which is the WKWebView go/no-go (QE-1426), the
  project's top risk, and it's the CI regression gate for everything above.

## Toolchain (macOS)

```bash
# Rust + Tauri prerequisites
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install create-tauri-app        # or: npm create tauri-app@latest
# Node is already used by this repo (Node 22). Then:
npm install
npx playwright install --with-deps chromium webkit   # both engines locally
```

## Order of work (native issues)

1. **QE-1427 — Tauri v2 shell.** `src-tauri/` with `tauri.conf.json` pointing its
   frontend at this repo's dev server / built `app/`. Window, menus, fullscreen
   and display management. This is the container everything else plugs into.
2. **QE-1429 — `pagetml://` protocol handler (Rust).** Serve the opened file and
   its sibling assets, **rejecting path traversal in Rust**, and inject the
   content runtime (`src/content/runtime.ts`, built). This replaces the dev
   `graftFixture`/`loadDocument` stand-ins and makes the CSP header, script
   execution, and same-origin isolation real. Set the CSP as a response header
   here (see `contentCsp()` in `vite.config.ts` for the exact policy shape).
3. **QE-1428 tail — native open paths.** OS `.html`/`.htm` file association,
   dock/taskbar drag-drop, `File > Open`, CLI argument. The chrome already opens
   a document from HTML (`openHtml`) — wire these OS entry points to it.
4. **QE-1434 tail — persist position/recents in the Tauri store** (paths, not
   just names) so recents actually reopen.
5. **QE-1437/1438 tail — display handling.** Lock at the *physical display's*
   resolution on fullscreen entry; drop to reading mode if the presenting
   display disconnects.
6. **M4 (macOS) / M5 (Windows)** — packaging, signing, notarization, WebView
   fragmentation validation, DPI. Independent tracks.
7. **M6 — release** — signed installers + auto-update, manual hardware QA.

## Key seams already prepared for the native layer

- **Message schema** (`src/engine/messages.ts`): the whole content↔chrome
  contract, versioned. `loadDocument` (chrome→content) is how the shell hands a
  file's HTML to the frame; the `pagetml://` handler can instead serve it directly.
- **CSP** (`vite.config.ts` `contentCsp()`): the exact default-deny + `https:`
  relaxation to reproduce as a `pagetml://` response header.
- **Sandbox tests** (`tests/sandbox.spec.ts`): the attacks that must keep
  failing; add the Rust-side `pagetml://` path-traversal tests alongside.
- **Content runtime** (`src/content/runtime.ts`): `graftFixture` is dev-only
  scaffolding to delete once `pagetml://` serves the real document (scripts then
  run for real).

## Running what exists

```bash
npm test               # full Playwright suite (needs Chromium + WebKit)
npm run test:chromium  # Chromium only
npm run dev            # Vite dev server; open /app/index.html
```
