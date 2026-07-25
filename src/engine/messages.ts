// Versioned message schema between the engine (sandboxed content frame) and the
// app chrome (trusted) — spec §4.2, QE-1423.
//
// This is the ENTIRE contract across the sandbox boundary: the content frame
// has no Tauri IPC, so every interaction is a postMessage carrying one of these
// envelopes. Keeping it small and versioned from day one lets the chrome and
// engine evolve independently.

import type { Anchor, PageState } from "./types.js";

export const PROTOCOL_VERSION = 1 as const;

/** Engine → chrome: pagination state changed. */
export interface StateMessage {
  v: typeof PROTOCOL_VERSION;
  type: "state";
  state: PageState;
}

/** Engine → chrome: the reader's current anchor (e.g. to persist position). */
export interface AnchorMessage {
  v: typeof PROTOCOL_VERSION;
  type: "anchor";
  anchor: Anchor | null;
}

/** Engine → chrome: an external link was activated in the content frame; the
 *  chrome opens it in the system browser (never inside PageTML) — spec §3.4. */
export interface OpenExternalMessage {
  v: typeof PROTOCOL_VERSION;
  type: "openExternal";
  url: string;
}

/** Engine → chrome: pointer activity inside the content frame. In presentation
 *  mode the content fills the screen, so the chrome can't see mouse movement
 *  directly; the frame forwards it so the auto-hiding cursor works (QE-1441). */
export interface ActivityMessage {
  v: typeof PROTOCOL_VERSION;
  type: "activity";
}

/** Engine → chrome: raw wheel/trackpad delta from inside the content frame. A
 *  cross-origin iframe swallows wheel events, so the frame forwards them (the
 *  content also `preventDefault`s, suppressing the WKWebView back/forward swipe)
 *  and the chrome turns pages — making two-finger swipe and scroll-to-turn work
 *  over the document, not just the chrome (QE-1445). */
export interface WheelMessage {
  v: typeof PROTOCOL_VERSION;
  type: "wheel";
  dx: number;
  dy: number;
}

/** Chrome → engine: deliver a document opened by the chrome (dropped or picked
 *  file) into the content frame, when it wasn't loaded via a `?fixture=`/
 *  `pagetml://` URL. The frame grafts this HTML and paginates it (QE-1428). */
export interface LoadDocumentMessage {
  v: typeof PROTOCOL_VERSION;
  type: "loadDocument";
  html: string;
}

/** Chrome → engine: the chrome's transport is wired and listening. A natively
 *  served document's runtime evaluates before the chrome's iframe load handler
 *  runs, so it must not boot (and emit its initial state/anchor into the void)
 *  until this arrives. */
export interface ReadyMessage {
  v: typeof PROTOCOL_VERSION;
  type: "ready";
}

/** Chrome → engine: navigation and mode commands. */
export interface CommandMessage {
  v: typeof PROTOCOL_VERSION;
  type: "command";
  command:
    | { name: "next" }
    | { name: "prev" }
    | { name: "first" }
    | { name: "last" }
    | { name: "goToPage"; page: number }
    | { name: "restoreAnchor"; anchor: Anchor }
    | { name: "lock" }
    | { name: "unlock" };
}

export type EngineToChrome =
  | StateMessage
  | AnchorMessage
  | OpenExternalMessage
  | ActivityMessage
  | WheelMessage;
export type ChromeToEngine = CommandMessage | LoadDocumentMessage | ReadyMessage;
export type PagetmlMessage = EngineToChrome | ChromeToEngine;

/** A message payload without the protocol version — the transport stamps `v`,
 *  so callers never hand-write it. */
export type Outgoing =
  | Omit<StateMessage, "v">
  | Omit<AnchorMessage, "v">
  | Omit<OpenExternalMessage, "v">
  | Omit<ActivityMessage, "v">
  | Omit<CommandMessage, "v">
  | Omit<LoadDocumentMessage, "v">
  | Omit<ReadyMessage, "v">
  | Omit<WheelMessage, "v">;

/** Narrowing guard for anything arriving over postMessage. */
export function isPagetmlMessage(data: unknown): data is PagetmlMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { v?: unknown }).v === PROTOCOL_VERSION &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/**
 * A thin postMessage transport. `remote` is the other side's window (where
 * outgoing messages are posted); `local` is this side's window (where incoming
 * `message` events actually fire — they arrive on the receiver, not the
 * sender). Defaults `local` to the global window.
 */
export function createTransport(remote: Window, local: Window = globalThis as unknown as Window, origin = "*") {
  return {
    /** Send a payload; the transport stamps the protocol version (the module
     *  that defines the protocol owns the envelope). */
    send(msg: Outgoing) {
      remote.postMessage({ ...msg, v: PROTOCOL_VERSION } as PagetmlMessage, origin);
    },
    onMessage(handler: (msg: PagetmlMessage) => void): () => void {
      const listener = (ev: MessageEvent) => {
        // Only accept messages from the peer we're paired with — the window we
        // post to is the window we expect to hear from. This binds the channel
        // to the content frame and rejects spoofed messages from other frames
        // (sandbox threat model, spec §4.4).
        if (ev.source !== (remote as unknown as MessageEventSource)) return;
        if (isPagetmlMessage(ev.data)) handler(ev.data);
      };
      local.addEventListener("message", listener as EventListener);
      return () => local.removeEventListener("message", listener as EventListener);
    },
  };
}
