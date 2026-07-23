# src-tauri — status and finishing notes

**Status (2026-07-23): compiled, launched, and driven on macOS.** The scaffold
built clean on the first `cargo check` (no API drift). Verified in the running
shell: window + chrome load, the dialog command bridge, and CLI-argument open →
`pagetml://` serving → runtime injection → pagination. Two launch bugs were
found and fixed in that pass:

- An `open-document` event emitted from `setup()` fires before the page's JS
  exists and is lost — the chrome now *pulls* the launch document via the
  `initial_url` command (dialog/runtime opens still push via the event).
- The injected runtime only booted via `?fixture=` or `loadDocument`; on a
  `pagetml://` document it now boots directly (the document IS the content).

Still native-unverified: OS file association end-to-end (needs a bundled
build; the `RunEvent::Opened` handler is in place), menus, and the QE-1431
follow-up below.

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
2. **Content runtime resource** — `npm run build:runtime` output verified
   self-contained; in dev, tauri-build copies it to `target/debug/resources/`,
   where `resolve(..., BaseDirectory::Resource)` finds it. After editing
   runtime sources, re-run `build:runtime` and re-copy (or touch a Rust file to
   trigger the dev rebuild) — the dev copy does not auto-sync.
3. **Frontend build layout** — `dist/app/index.html` confirmed.
4. **Start-screen sample docs** — gated behind `!isNative()`.
5. **macOS "Open" event** — `RunEvent::Opened` handled in `run()` (bundled-app
   verification pending, see status above).
6. **Tauri v2 API drift** — none; compiled clean against tauri 2.11.

## Remaining TODO

- **Per-file remote toggle.** `set_remote` stores a single flag in app state;
  the chrome calls it before reloading a native document so the `pagetml://` CSP
  header relaxes to `https:`. For multiple documents, key it per document.
- **`WKContentRuleList` network gate** (see CSP finding above).

## What maps to what

- `src/lib.rs` `handle_pagetml` → QE-1429 (`pagetml://` + Rust traversal guard + CSP).
- `open_path` / `open_dialog` / CLI arg / file association → QE-1428 (native open).
- `WebviewWindowBuilder` in `setup` + `tauri.conf.json` → QE-1427 (window/menus).
- `src/chrome/native.ts` → the frontend side of the bridge (inert in the browser
  build, so the 77 Playwright checks are unaffected).
