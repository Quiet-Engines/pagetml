// Native (Tauri) integration for the chrome. This is inert in the browser build
// — everything is gated on `window.__TAURI__`, which only exists inside the
// Tauri shell — so it does not affect the Playwright tests.
//
// When running in the shell, the Rust side (src-tauri/src/lib.rs) opens files
// (dialog / OS file association / CLI) and emits an `open-document` event with
// the `pager://` URL to load. Here we forward that to the chrome, which loads
// the URL directly into its content frame (the runtime is injected server-side
// by the pager:// handler, so no `loadDocument` message is needed).

interface TauriGlobal {
  event: {
    listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
  core: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
}

function tauri(): TauriGlobal | undefined {
  return (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}

export function isNative(): boolean {
  return tauri() !== undefined;
}

/** Wire the shell's open-document event to `open(name, url)`. No-op in a plain
 *  browser. */
export function initNativeShell(open: (name: string, url: string) => void): void {
  const t = tauri();
  if (!t) return;
  void t.event.listen("open-document", (e) => {
    const url = String(e.payload);
    // pager://localhost/<encoded name> → display name.
    const name = decodeURIComponent(url.split("/").pop() ?? "document").replace(/\.html?$/i, "");
    open(name, url);
  });
}

/** Open the native file dialog (the shell serves the pick via the event above). */
export function nativeOpenDialog(): void {
  void tauri()?.core.invoke("open_dialog");
}

/** Tell the shell whether the current document may load remote resources, so the
 *  pager:// CSP header is relaxed/tightened on reload (QE-1431). */
export function nativeSetRemote(allowed: boolean): void {
  void tauri()?.core.invoke("set_remote", { allowed });
}
