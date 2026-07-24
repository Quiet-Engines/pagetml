// PageTML — native Tauri v2 shell (QE-1427/1428/1429). See NOTES.md for
// bring-up status and remaining native TODOs.
//
// Responsibilities:
//   * create the app window that hosts the chrome (../app/index.html),
//   * serve the opened document + its sibling assets over pagetml://, refusing to
//     escape the document's directory (QE-1429),
//   * open files natively (dialog, OS file association, CLI argument) and tell
//     the chrome which pagetml:// URL to load (QE-1428).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// The custom protocol scheme and the reserved path under it that serves the
/// bundled content runtime. Single source of truth: the scheme registration, the
/// CSP, the injected `<script>` URL, and the reserved-path guard must all agree,
/// or the runtime silently 404s (dead URL) or the CSP blocks it — none of which
/// is a compile error. Keep every `pagetml://` reference derived from these.
const SCHEME: &str = "pagetml";
const RUNTIME_PATH: &str = "__pagetml__/runtime.js";

/// The content runtime, embedded at compile time (`npm run build:runtime`
/// regenerates it; build.rs triggers a rebuild on change). Embedding rather
/// than resolving a bundled resource avoids the dev-vs-release resource-dir
/// mismatch entirely — the bundle is served identically in both.
const RUNTIME_JS: &[u8] = include_bytes!("../resources/content-runtime.js");

/// One remembered document (QE-1434). `position` is the engine's content
/// anchor, stored opaquely — its shape belongs to the engine.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DocEntry {
    path: PathBuf,
    #[serde(default)]
    remote: bool,
    #[serde(default)]
    position: Option<serde_json::Value>,
}

/// Per-app state: the directory of the currently open document (the pagetml://
/// sandbox root), its pagetml:// URL, and the remembered-documents list.
#[derive(Default)]
struct AppState {
    base_dir: Mutex<Option<PathBuf>>,
    document_url: Mutex<Option<String>>,
    /// Remembered documents, newest first; the current document is always the
    /// front entry (open_path maintains this), so its per-file "allow remote"
    /// flag and position live there — no separate mirror. Persisted to
    /// `store_path` on every mutation. The shell owns this — not the chrome's
    /// localStorage — because re-opening and per-file state need the real path.
    entries: Mutex<Vec<DocEntry>>,
    store_path: Mutex<Option<PathBuf>>,
    /// Serializes disk saves so overlapping flushes can't interleave the temp
    /// file or land out of order (set_position fires per page turn, fire-and-
    /// forget, and Tauri runs commands on a thread pool).
    save_lock: Mutex<()>,
}

fn load_entries(path: &Path) -> Vec<DocEntry> {
    let Ok(bytes) = std::fs::read(path) else { return Vec::new() };
    match serde_json::from_slice(&bytes) {
        Ok(entries) => entries,
        // A non-empty file that won't parse is corrupt or from a newer schema.
        // Don't silently return default — the next mutation would overwrite it
        // and lose every remembered document. Preserve it for recovery first.
        Err(_) => {
            if !bytes.is_empty() {
                let _ = std::fs::rename(path, path.with_extension("json.bak"));
            }
            Vec::new()
        }
    }
}

fn save_entries(state: &AppState) {
    let Some(path) = state.store_path.lock().unwrap().clone() else { return };
    // Hold the save lock across snapshot + write + rename so concurrent saves
    // are fully serialized (see save_lock).
    let _saving = state.save_lock.lock().unwrap();
    let json = match serde_json::to_vec_pretty(&*state.entries.lock().unwrap()) {
        Ok(j) => j,
        Err(_) => return,
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Atomic write: a position flush fires on every page turn, so an
    // interrupted plain write would corrupt the store and load_entries would
    // reset it. Write a temp then rename (atomic on the same fs), so a crash
    // always leaves the previous good store intact.
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// The webview-facing base URL for the custom scheme. macOS/Linux navigate
/// custom schemes directly; Windows/Android serve them from a localhost
/// domain. (Windows form is compile-checked only until the M5 track runs it.)
fn scheme_base() -> String {
    #[cfg(any(windows, target_os = "android"))]
    {
        format!("http://{SCHEME}.localhost")
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        format!("{SCHEME}://localhost")
    }
}

/// The Content-Security-Policy served with the document. Mirrors the dev policy
/// in vite.config.ts, but keyed to `pagetml:` instead of the dev server's origin.
/// Default-deny network; the per-file toggle adds `https:`.
fn content_csp(allow_remote: bool) -> String {
    let remote = if allow_remote { " https:" } else { "" };
    format!(
        "default-src 'self' {SCHEME}:; \
         script-src 'self' {SCHEME}: 'unsafe-inline'{remote}; \
         style-src 'self' {SCHEME}: 'unsafe-inline'{remote}; \
         img-src 'self' {SCHEME}: data: blob:{remote}; \
         font-src 'self' {SCHEME}: data:{remote}; \
         media-src 'self' {SCHEME}: data: blob:{remote}; \
         connect-src 'self' {SCHEME}:{remote}"
    )
}

/// Resolve a request path against the document's base directory, canonicalizing
/// so `..`, symlinks, and encoding tricks can't escape (QE-1429, threat model
/// §4.4). Err(FORBIDDEN) when the target resolves outside the base;
/// Err(NOT_FOUND) when either path can't be canonicalized (missing file).
fn resolve_in_base(base: &Path, decoded: &str) -> Result<PathBuf, StatusCode> {
    let canonical = std::fs::canonicalize(base.join(decoded)).map_err(|_| StatusCode::NOT_FOUND)?;
    let canonical_base = std::fs::canonicalize(base).map_err(|_| StatusCode::NOT_FOUND)?;
    if canonical.starts_with(&canonical_base) {
        Ok(canonical)
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

/// Move `path`'s entry to the front of the remembered list (creating it if new),
/// preserving its stored per-file state; cap the list at 10. Returns the front
/// entry. Callers canonicalize `path` first so identity is stable (QE-1434).
fn upsert_front(entries: &mut Vec<DocEntry>, path: PathBuf) -> DocEntry {
    let entry = match entries.iter().position(|e| e.path == path) {
        Some(i) => entries.remove(i),
        None => DocEntry { path, remote: false, position: None },
    };
    entries.insert(0, entry.clone());
    entries.truncate(10);
    entry
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html") | Some("htm") => "text/html",
        Some("css") => "text/css",
        Some("js") | Some("mjs") => "text/javascript",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    response(status, "text/plain; charset=utf-8", message.as_bytes().to_vec())
}

/// Inject the content runtime `<script>` into a served HTML document so the
/// pagination engine runs alongside the user's HTML (the real equivalent of the
/// dev `graftFixture`/`loadDocument` path). The runtime itself is served at the
/// reserved path below.
fn inject_runtime(html: Vec<u8>) -> Vec<u8> {
    // The marker tells the runtime the surrounding document IS the content, so
    // it boots in place. A marker rather than a URL check keeps the runtime
    // scheme- and platform-agnostic (Tauri serves custom schemes as
    // https://pagetml.localhost on Windows).
    let tag = format!(
        "\n<script>window.__PAGETML_SERVED__=true</script>\
         \n<script type=\"module\" src=\"{}/{RUNTIME_PATH}\"></script>\n",
        scheme_base()
    );
    let text = String::from_utf8_lossy(&html);
    let injected = match text.to_ascii_lowercase().rfind("</body>") {
        Some(idx) => format!("{}{}{}", &text[..idx], tag, &text[idx..]),
        None => format!("{text}{tag}"),
    };
    injected.into_bytes()
}

/// The pagetml:// scheme handler. All requests resolve against the open
/// document's directory; anything that escapes it (path traversal) is refused
/// in Rust (QE-1429, threat model spec §4.4).
fn handle_pagetml<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let app = ctx.app_handle();
    let state = app.state::<AppState>();

    // Reserved: serve the bundled content runtime (see NOTES.md — the build must
    // place `content-runtime.js` in the app's resource dir).
    let raw_path = request.uri().path().trim_start_matches('/');
    if raw_path == RUNTIME_PATH {
        return response(StatusCode::OK, "text/javascript", RUNTIME_JS.to_vec());
    }

    let Some(base) = state.base_dir.lock().unwrap().clone() else {
        return error(StatusCode::NOT_FOUND, "no document open");
    };
    // The current document is always entries[0], so its remote flag is the
    // single source of truth for the served CSP.
    let allow_remote = state.entries.lock().unwrap().first().is_some_and(|e| e.remote);

    let decoded = urlencoding::decode(raw_path).unwrap_or_default().into_owned();

    // Traversal guard: the canonical target must stay inside the canonical base.
    let canonical = match resolve_in_base(&base, &decoded) {
        Ok(c) => c,
        Err(status) => return error(status, "not found"),
    };

    let bytes = match std::fs::read(&canonical) {
        Ok(b) => b,
        Err(_) => return error(StatusCode::NOT_FOUND, "not found"),
    };

    let mime = mime_for(&canonical);
    if mime == "text/html" {
        // The CSP header applies to every served HTML document, but the
        // runtime is injected only into the opened document itself — an HTML
        // sibling embedded via <iframe> must render untouched, not boot its
        // own paginator inside the user's page.
        let is_document = state
            .document_url
            .lock()
            .unwrap()
            .as_deref()
            .and_then(|u| u.rsplit_once('/').map(|(_, tail)| tail.to_string()))
            .and_then(|tail| urlencoding::decode(&tail).ok().map(|t| t.into_owned()))
            .is_some_and(|doc| doc == decoded);
        let body = if is_document { inject_runtime(bytes) } else { bytes };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header("Content-Security-Policy", content_csp(allow_remote))
            .body(body)
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    response(StatusCode::OK, mime, bytes)
}

/// Point the sandbox at `path`, then tell the chrome which pagetml:// URL to load.
fn open_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: PathBuf) {
    // Canonicalize so the store keys documents by a single stable identity —
    // the same file reached via a relative CLI arg, a Finder absolute URL, a
    // symlink, or a case-variant on APFS must be one entry, not several (and
    // must find its saved position/remote flag). Matches the traversal guard,
    // which also canonicalizes. Falls back to the raw path if the file is gone.
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    let Some(dir) = path.parent().map(Path::to_path_buf) else { return };
    let file = path.file_name().and_then(|f| f.to_str()).unwrap_or("").to_string();

    let state = app.state::<AppState>();
    *state.base_dir.lock().unwrap() = Some(dir);

    // Move (or insert) this document at the front of the remembered list,
    // keeping its stored per-file state (QE-1434).
    let entry = upsert_front(&mut state.entries.lock().unwrap(), path);
    save_entries(&state);

    let url = format!("{}/{}", scheme_base(), urlencoding::encode(&file));
    *state.document_url.lock().unwrap() = Some(url.clone());
    // The chrome listens for this and loads `url` into its content frame.
    let _ = app.emit(
        "open-document",
        serde_json::json!({
            "url": url,
            "replay": false,
            "remote": entry.remote,
            "position": entry.position,
        }),
    );
}

/// Called by the chrome once its `open-document` listener is registered. A
/// document opened before that (CLI argument / OS file association at launch)
/// was emitted before anyone could hear it; replay it through the same
/// channel. The chrome ignores a replay of the document it already shows.
#[tauri::command]
fn frontend_ready(app: tauri::AppHandle, state: tauri::State<AppState>) {
    if let Some(url) = state.document_url.lock().unwrap().clone() {
        let (remote, position) = state
            .entries
            .lock()
            .unwrap()
            .first()
            .map(|e| (e.remote, e.position.clone()))
            .unwrap_or((false, None));
        // `replay` lets the chrome ignore a re-delivery of the document it
        // already shows without suppressing genuine re-opens (which share the
        // URL: it is built from the basename).
        let _ = app.emit(
            "open-document",
            serde_json::json!({ "url": url, "replay": true, "remote": remote, "position": position }),
        );
    }
}

/// File names of the shell's recent documents, newest first.
#[tauri::command]
fn recent_names(state: tauri::State<AppState>) -> Vec<String> {
    state
        .entries
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| e.path.file_name().and_then(|f| f.to_str()).map(String::from))
        .collect()
}

/// Re-open the i-th recent document (the shell holds the real path — the
/// chrome only ever sees display names).
#[tauri::command]
fn open_recent(app: tauri::AppHandle, state: tauri::State<AppState>, index: usize) {
    let path = state.entries.lock().unwrap().get(index).map(|e| e.path.clone());
    if let Some(path) = path {
        if path.is_file() {
            open_path(&app, path);
        }
    }
}

#[tauri::command]
fn set_remote(app: tauri::AppHandle, allowed: bool) {
    let state = app.state::<AppState>();
    if let Some(e) = state.entries.lock().unwrap().first_mut() {
        e.remote = allowed;
    }
    save_entries(&state);
}

/// Persist the reader's position (a content anchor, opaque to the shell) for
/// the current document (QE-1434).
#[tauri::command]
fn set_position(app: tauri::AppHandle, anchor: serde_json::Value) {
    let state = app.state::<AppState>();
    if let Some(e) = state.entries.lock().unwrap().first_mut() {
        e.position = Some(anchor);
    }
    save_entries(&state);
}

#[tauri::command]
fn open_dialog(app: tauri::AppHandle) {
    // Native "Open…" — pick an .html file, then serve it via pagetml://.
    app.dialog()
        .file()
        .add_filter("HTML", &["html", "htm"])
        .pick_file(move |maybe| {
            if let Some(fp) = maybe {
                if let Ok(path) = fp.into_path() {
                    open_path(&app, path);
                }
            }
        });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .register_uri_scheme_protocol(SCHEME, handle_pagetml)
        .invoke_handler(tauri::generate_handler![
            set_remote,
            set_position,
            open_dialog,
            frontend_ready,
            recent_names,
            open_recent
        ])
        .setup(|app| {
            // Load the remembered-documents store (QE-1434) before anything can
            // open a document — the CLI-arg open below reads and updates it.
            if let Ok(dir) = app.path().app_data_dir() {
                let store = dir.join("store.json");
                let state = app.state::<AppState>();
                *state.entries.lock().unwrap() = load_entries(&store);
                *state.store_path.lock().unwrap() = Some(store);
            }

            // Host the chrome. WebviewUrl::App resolves against devUrl in dev and
            // frontendDist in release, so this one path works for both.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("app/index.html".into()))
                .title("PageTML")
                .inner_size(1100.0, 780.0)
                .min_inner_size(640.0, 480.0)
                .build()?;

            // Open a file passed on the command line (OS file association routes
            // the opened path here as argv[1] on Windows/Linux; macOS delivers it
            // via the Opened event — see NOTES.md).
            if let Some(arg) = std::env::args().nth(1) {
                let path = PathBuf::from(arg);
                if path.is_file() {
                    open_path(app.handle(), path);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building PageTML")
        .run(|app, event| {
            // macOS delivers file-association opens as an app event, not argv
            // (NOTES.md #5). Runtime opens reach the chrome via `open-document`;
            // a launch open lands in state and is replayed on `frontend_ready`.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        open_path(app, path);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique temp dir per test (no tempfile dep); recreated fresh each run.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pagetml-test-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // --- traversal guard (QE-1429) ------------------------------------------

    #[test]
    fn resolve_in_base_serves_a_file_inside_the_base() {
        let base = scratch("resolve-ok");
        std::fs::write(base.join("doc.html"), b"<p>hi</p>").unwrap();
        let got = resolve_in_base(&base, "doc.html").unwrap();
        assert_eq!(got, std::fs::canonicalize(base.join("doc.html")).unwrap());
    }

    #[test]
    fn resolve_in_base_refuses_dotdot_escape() {
        let base = scratch("resolve-escape").join("sub");
        std::fs::create_dir_all(&base).unwrap();
        // A secret sits one level above the base; the guard must refuse it.
        std::fs::write(base.parent().unwrap().join("secret.txt"), b"top secret").unwrap();
        assert_eq!(resolve_in_base(&base, "../secret.txt"), Err(StatusCode::FORBIDDEN));
    }

    #[test]
    fn resolve_in_base_refuses_symlink_escape() {
        let base = scratch("resolve-symlink");
        let outside = base.parent().unwrap().join("pagetml-test-outside-secret");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"top secret").unwrap();
        // A symlink inside the base pointing out of it must not be followable.
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, base.join("link")).unwrap();
        #[cfg(unix)]
        assert_eq!(resolve_in_base(&base, "link/secret.txt"), Err(StatusCode::FORBIDDEN));
    }

    #[test]
    fn resolve_in_base_missing_file_is_not_found() {
        let base = scratch("resolve-missing");
        assert_eq!(resolve_in_base(&base, "nope.html"), Err(StatusCode::NOT_FOUND));
    }

    // --- store identity + list maintenance (QE-1434) ------------------------

    #[test]
    fn upsert_front_moves_existing_to_front_without_losing_state() {
        let a = PathBuf::from("/docs/a.html");
        let b = PathBuf::from("/docs/b.html");
        let mut entries = vec![];
        upsert_front(&mut entries, a.clone());
        // Give a's entry some state, then open b, then re-open a.
        entries[0].remote = true;
        entries[0].position = Some(serde_json::json!({ "path": [3] }));
        upsert_front(&mut entries, b.clone());
        upsert_front(&mut entries, a.clone());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, a); // a back at the front
        assert!(entries[0].remote); // its per-file state preserved
        assert_eq!(entries[0].position, Some(serde_json::json!({ "path": [3] })));
    }

    #[test]
    fn upsert_front_caps_at_ten() {
        let mut entries = vec![];
        for i in 0..15 {
            upsert_front(&mut entries, PathBuf::from(format!("/docs/{i}.html")));
        }
        assert_eq!(entries.len(), 10);
        assert_eq!(entries[0].path, PathBuf::from("/docs/14.html")); // newest first
    }

    // --- store persistence durability (QE-1434) -----------------------------

    fn state_with_store(dir: &Path) -> AppState {
        let state = AppState::default();
        *state.store_path.lock().unwrap() = Some(dir.join("store.json"));
        state
    }

    #[test]
    fn save_then_load_round_trips_entries() {
        let dir = scratch("store-roundtrip");
        let state = state_with_store(&dir);
        state.entries.lock().unwrap().push(DocEntry {
            path: PathBuf::from("/docs/x.html"),
            remote: true,
            position: Some(serde_json::json!({ "path": [1, 2] })),
        });
        save_entries(&state);
        let loaded = load_entries(&dir.join("store.json"));
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].path, PathBuf::from("/docs/x.html"));
        assert!(loaded[0].remote);
    }

    #[test]
    fn save_leaves_no_temp_file_behind() {
        let dir = scratch("store-notmp");
        let state = state_with_store(&dir);
        state.entries.lock().unwrap().push(DocEntry {
            path: PathBuf::from("/docs/x.html"),
            remote: false,
            position: None,
        });
        save_entries(&state);
        assert!(dir.join("store.json").exists());
        assert!(!dir.join("store.json.tmp").exists());
    }

    #[test]
    fn load_backs_up_a_corrupt_store_instead_of_wiping_it() {
        let dir = scratch("store-corrupt");
        let store = dir.join("store.json");
        std::fs::write(&store, b"{ this is not valid json ]").unwrap();
        let loaded = load_entries(&store);
        assert!(loaded.is_empty()); // corrupt → empty, not a panic
        // ...but the bytes are preserved for recovery, not silently lost.
        let bak = std::fs::read(store.with_extension("json.bak")).unwrap();
        assert_eq!(bak, b"{ this is not valid json ]");
    }

    #[test]
    fn load_missing_store_is_empty() {
        let dir = scratch("store-missing");
        assert!(load_entries(&dir.join("store.json")).is_empty());
    }

    // --- runtime injection contract (QE-1429) -------------------------------

    #[test]
    fn inject_runtime_adds_marker_and_script_before_body_close() {
        let out = inject_runtime(b"<html><body><p>doc</p></body></html>".to_vec());
        let html = String::from_utf8(out).unwrap();
        assert!(html.contains("__PAGETML_SERVED__"));
        assert!(html.contains(&format!("{}/{RUNTIME_PATH}", scheme_base())));
        // Injected before </body>, so the user's content stays intact above it.
        let marker = html.find("__PAGETML_SERVED__").unwrap();
        let body_close = html.rfind("</body>").unwrap();
        assert!(marker < body_close);
        assert!(html.contains("<p>doc</p>"));
    }

    // --- CSP + mime (QE-1431) -----------------------------------------------

    #[test]
    fn csp_is_default_deny_until_remote_allowed() {
        assert!(!content_csp(false).contains("https:"));
        assert!(content_csp(true).contains("https:"));
    }

    #[test]
    fn mime_maps_common_types() {
        assert_eq!(mime_for(Path::new("a.html")), "text/html");
        assert_eq!(mime_for(Path::new("a.CSS")), "text/css"); // case-insensitive
        assert_eq!(mime_for(Path::new("a.unknown")), "application/octet-stream");
    }
}
