// Native (Tauri) integration for the chrome. This is inert in the browser build
// — everything is gated on `window.__TAURI__`, which only exists inside the
// Tauri shell — so it does not affect the Playwright tests.
//
// When running in the shell, the Rust side (src-tauri/src/lib.rs) opens files
// (dialog / OS file association / CLI) and emits an `open-document` event with
// the `pagetml://` URL to load. Here we forward that to the chrome, which loads
// the URL directly into its content frame (the runtime is injected server-side
// by the pagetml:// handler, so no `loadDocument` message is needed).

import { isAnchor, type Anchor } from "../engine/index.js";

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

/** A document the shell asks the chrome to open, with its stored per-file
 *  state from the shell's persistent store (QE-1434). */
export interface NativeDoc {
  name: string;
  url: string;
  replay: boolean;
  remote: boolean;
  position?: Anchor;
}

/** Wire the shell's open-document event to `open(doc)`. No-op in a plain
 *  browser. */
export function initNativeShell(open: (doc: NativeDoc) => void): void {
  const t = tauri();
  if (!t) return;
  // A document opened at launch (CLI argument / OS file association) is
  // emitted before this listener exists. Once subscribed, tell the shell we're
  // ready so it replays any pending open through the same event (flagged
  // `replay` so the chrome can ignore a re-delivery of the current document).
  void t.event
    .listen("open-document", (e) => {
      const p = e.payload as { url?: unknown; replay?: unknown; remote?: unknown; position?: unknown };
      if (typeof p?.url !== "string") return;
      open({
        // <base>/<encoded name> → display name.
        name: decodeURIComponent(p.url.split("/").pop() ?? "document").replace(/\.html?$/i, ""),
        url: p.url,
        replay: p.replay === true,
        remote: p.remote === true,
        // Shape-check the stored anchor before trusting it.
        position: isAnchor(p.position) ? p.position : undefined,
      });
    })
    .then(() => t.core.invoke("frontend_ready"));
}

/** Open the native file dialog (the shell serves the pick via the event above). */
export function nativeOpenDialog(): void {
  void tauri()?.core.invoke("open_dialog");
}

/** Tell the shell whether the current document may load remote resources, so the
 *  pagetml:// CSP header is relaxed/tightened on reload (QE-1431). Await the
 *  returned promise before reloading the frame, or the reload can be served
 *  under the previous CSP. */
export function nativeSetRemote(allowed: boolean): Promise<void> {
  return (tauri()?.core.invoke("set_remote", { allowed }) ?? Promise.resolve()) as Promise<void>;
}

/** Recent documents (file names, newest first) known to the shell. */
export function nativeRecentNames(): Promise<string[]> {
  const t = tauri();
  if (!t) return Promise.resolve([]);
  return t.core.invoke("recent_names").then((v) =>
    Array.isArray(v) ? v.filter((n): n is string => typeof n === "string") : [],
  );
}

/** Ask the shell to re-open its i-th recent document (it holds the path). */
export function nativeOpenRecent(index: number): void {
  void tauri()?.core.invoke("open_recent", { index });
}

/** Persist the reader's position for the current document in the shell's
 *  store (QE-1434). */
export function nativeSetPosition(anchor: Anchor): void {
  void tauri()?.core.invoke("set_position", { anchor });
}
