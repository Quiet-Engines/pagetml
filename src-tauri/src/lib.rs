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

/// Per-app state: the directory of the currently open document (the pagetml://
/// sandbox root), its pagetml:// URL, and its per-file "allow remote
/// resources" flag (QE-1431).
#[derive(Default)]
struct AppState {
    base_dir: Mutex<Option<PathBuf>>,
    document_url: Mutex<Option<String>>,
    remote_allowed: Mutex<bool>,
    /// Recently opened documents, newest first. Session-only; the persistent
    /// store is QE-1434. The shell owns this (not the chrome's localStorage)
    /// because re-opening needs the real path.
    recents: Mutex<Vec<PathBuf>>,
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
        return match app
            .path()
            .resolve("content-runtime.js", tauri::path::BaseDirectory::Resource)
            .and_then(|p| std::fs::read(p).map_err(Into::into))
        {
            Ok(bytes) => response(StatusCode::OK, "text/javascript", bytes),
            Err(_) => error(StatusCode::NOT_FOUND, "runtime bundle missing (see NOTES.md)"),
        };
    }

    let Some(base) = state.base_dir.lock().unwrap().clone() else {
        return error(StatusCode::NOT_FOUND, "no document open");
    };
    let allow_remote = *state.remote_allowed.lock().unwrap();

    let decoded = urlencoding::decode(raw_path).unwrap_or_default().into_owned();
    let requested = base.join(&decoded);

    // Traversal guard: the canonical target must stay inside the canonical base.
    let (canonical, canonical_base) = match (
        std::fs::canonicalize(&requested),
        std::fs::canonicalize(&base),
    ) {
        (Ok(c), Ok(b)) => (c, b),
        _ => return error(StatusCode::NOT_FOUND, "not found"),
    };
    if !canonical.starts_with(&canonical_base) {
        return error(StatusCode::FORBIDDEN, "path traversal refused");
    }

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
    let Some(dir) = path.parent().map(Path::to_path_buf) else { return };
    let file = path.file_name().and_then(|f| f.to_str()).unwrap_or("").to_string();

    let state = app.state::<AppState>();
    *state.base_dir.lock().unwrap() = Some(dir);
    // Every open starts default-deny; the chrome pushes the file's stored
    // "allow remote" preference via set_remote when it loads the document
    // (QE-1431 — without this, the previous document's relaxed CSP would leak).
    *state.remote_allowed.lock().unwrap() = false;
    {
        let mut recents = state.recents.lock().unwrap();
        recents.retain(|p| p != &path);
        recents.insert(0, path.clone());
        recents.truncate(10);
    }

    let url = format!("{}/{}", scheme_base(), urlencoding::encode(&file));
    *state.document_url.lock().unwrap() = Some(url.clone());
    // The chrome listens for this and loads `url` into its content frame.
    let _ = app.emit("open-document", serde_json::json!({ "url": url, "replay": false }));
}

/// Called by the chrome once its `open-document` listener is registered. A
/// document opened before that (CLI argument / OS file association at launch)
/// was emitted before anyone could hear it; replay it through the same
/// channel. The chrome ignores a replay of the document it already shows.
#[tauri::command]
fn frontend_ready(app: tauri::AppHandle, state: tauri::State<AppState>) {
    if let Some(url) = state.document_url.lock().unwrap().clone() {
        // `replay` lets the chrome ignore a re-delivery of the document it
        // already shows without suppressing genuine re-opens (which share the
        // URL: it is built from the basename).
        let _ = app.emit("open-document", serde_json::json!({ "url": url, "replay": true }));
    }
}

/// File names of the shell's recent documents, newest first.
#[tauri::command]
fn recent_names(state: tauri::State<AppState>) -> Vec<String> {
    state
        .recents
        .lock()
        .unwrap()
        .iter()
        .filter_map(|p| p.file_name().and_then(|f| f.to_str()).map(String::from))
        .collect()
}

/// Re-open the i-th recent document (the shell holds the real path — the
/// chrome only ever sees display names).
#[tauri::command]
fn open_recent(app: tauri::AppHandle, state: tauri::State<AppState>, index: usize) {
    let path = state.recents.lock().unwrap().get(index).cloned();
    if let Some(path) = path {
        if path.is_file() {
            open_path(&app, path);
        }
    }
}

#[tauri::command]
fn set_remote(app: tauri::AppHandle, allowed: bool) {
    *app.state::<AppState>().remote_allowed.lock().unwrap() = allowed;
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
            open_dialog,
            frontend_ready,
            recent_names,
            open_recent
        ])
        .setup(|app| {
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
