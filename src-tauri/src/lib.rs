// PageTML — native Tauri v2 shell (QE-1427/1428/1429).
//
// STATUS: scaffold written without a build environment — NOT yet compiled or
// run. Treat the Tauri v2 API calls as "best effort, verify against the current
// crate docs" (see NOTES.md). The shape and the security-critical logic (the
// pagetml:// path-traversal guard and the default-deny CSP) are the parts worth
// getting right; the wiring around them may need small adjustments.
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
/// sandbox root) and its per-file "allow remote resources" flag (QE-1431).
#[derive(Default)]
struct AppState {
    base_dir: Mutex<Option<PathBuf>>,
    document: Mutex<Option<PathBuf>>,
    remote_allowed: Mutex<bool>,
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
    let tag =
        format!("\n<script type=\"module\" src=\"{SCHEME}://localhost/{RUNTIME_PATH}\"></script>\n");
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
        // The document response carries the CSP and the injected runtime.
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header("Content-Security-Policy", content_csp(allow_remote))
            .body(inject_runtime(bytes))
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
    *state.document.lock().unwrap() = Some(path.clone());

    let url = format!("{SCHEME}://localhost/{}", urlencoding::encode(&file));
    // The chrome listens for this and loads `url` into its content frame.
    let _ = app.emit("open-document", url);
}

/// The pagetml:// URL of the document opened before the chrome's JS was running
/// (CLI argument / OS file association at launch). The chrome pulls this on
/// startup: an `open-document` event emitted from `setup()` fires before the
/// page has registered its listener and would be lost.
#[tauri::command]
fn initial_url(state: tauri::State<AppState>) -> Option<String> {
    let doc = state.document.lock().unwrap();
    let file = doc.as_ref()?.file_name()?.to_str()?;
    Some(format!("{SCHEME}://localhost/{}", urlencoding::encode(file)))
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
        .invoke_handler(tauri::generate_handler![set_remote, open_dialog, initial_url])
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
            // a launch open lands in state before the chrome pulls `initial_url`.
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
