# src-tauri — status and finishing notes

**This scaffold was written without a build environment: it has NOT been
compiled or run.** It's a correct-as-possible starting point for the native
shell (QE-1427/1428/1429). Expect to fix compile errors and adjust Tauri v2 API
details on the first `cargo` run. The security-critical logic — the `pager://`
path-traversal guard and the default-deny CSP in `src/lib.rs` — is the part
worth reviewing closely; the wiring around it is the part most likely to need
small changes.

## First run

```bash
# From the repo root:
npm install                      # pulls @tauri-apps/cli + api (added to package.json)
npm run tauri dev                # builds src-tauri + launches the window over the Vite dev server
```

If `npm run tauri` can't find the CLI, `cargo install tauri-cli --version '^2'` and
use `cargo tauri dev` instead.

## Known TODOs / things to verify

1. **Icons.** `tauri.conf.json` references `icons/*`. Generate them:
   `npm run tauri icon path/to/logo.png` (creates `src-tauri/icons/`). The build
   will fail until these exist.

2. **The content runtime resource.** The `pager://` handler injects
   `pager://localhost/__pager__/runtime.js` and serves it from the Tauri
   resource dir. Build it first: `npm run build:runtime` → writes
   `src-tauri/resources/content-runtime.js` (bundled via
   `bundle.resources`). Verify the output is a self-contained ES module (no bare
   `import` specifiers). In `dev`, the resource dir differs from release — confirm
   `app.path().resolve("content-runtime.js", Resource)` finds it, or serve the
   runtime from the frontendDist during dev.

3. **Frontend build layout.** `npm run build:app` (Vite) emits `dist/`. The
   window loads `WebviewUrl::App("app/index.html")`, which must resolve to
   `dist/app/index.html` in release and `http://localhost:5179/app/index.html`
   in dev. Confirm the dist layout matches; adjust `frontendDist` / the input
   paths in `vite.config.ts` if not.

4. **Start-screen sample docs.** `SAMPLE_DOCS` in `src/chrome/chrome.ts` lists
   the dev fixtures, which aren't bundled in the app. In the shell the document
   list should come from OS recents instead — gate `SAMPLE_DOCS` behind
   `!isNative()` (see `src/chrome/native.ts`) or replace it with a
   Tauri-provided recents list.

5. **macOS "Open" event.** OS file-association on macOS delivers the opened path
   via the `RunEvent::Opened { urls }` app event, not `argv`. Handle it in
   `.build()`/`.run()` and call `open_path(...)`. The CLI/`argv` path in
   `setup()` covers Windows/Linux.

6. **Tauri v2 API drift.** Verify these against the installed crate:
   - `register_uri_scheme_protocol` closure signature (`UriSchemeContext`,
     `Request<Vec<u8>>` → `Response<Vec<u8>>`).
   - `tauri_plugin_dialog` `pick_file` callback type (`FilePath` → `into_path()`).
   - `WebviewWindowBuilder`, `Emitter::emit`, `Manager::state`.
   - `capabilities/default.json` permission identifiers (`core:*`, `dialog:*`).

7. **Per-file remote toggle.** `set_remote` stores a single flag in app state;
   the chrome calls it before reloading a native document so the `pager://` CSP
   header relaxes to `https:`. For multiple documents, key it per document.

## What maps to what

- `src/lib.rs` `handle_pager` → QE-1429 (`pager://` + Rust traversal guard + CSP).
- `open_path` / `open_dialog` / CLI arg / file association → QE-1428 (native open).
- `WebviewWindowBuilder` in `setup` + `tauri.conf.json` → QE-1427 (window/menus).
- `src/chrome/native.ts` → the frontend side of the bridge (inert in the browser
  build, so the 77 Playwright checks are unaffected).
