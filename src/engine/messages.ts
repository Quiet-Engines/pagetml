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

export type EngineToChrome = StateMessage | AnchorMessage;
export type ChromeToEngine = CommandMessage;
export type PagerMessage = EngineToChrome | ChromeToEngine;

/** A message payload without the protocol version — the transport stamps `v`,
 *  so callers never hand-write it. */
export type Outgoing =
  | Omit<StateMessage, "v">
  | Omit<AnchorMessage, "v">
  | Omit<CommandMessage, "v">;

/** Narrowing guard for anything arriving over postMessage. */
export function isPagerMessage(data: unknown): data is PagerMessage {
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
      remote.postMessage({ ...msg, v: PROTOCOL_VERSION } as PagerMessage, origin);
    },
    onMessage(handler: (msg: PagerMessage) => void): () => void {
      const listener = (ev: MessageEvent) => {
        if (isPagerMessage(ev.data)) handler(ev.data);
      };
      local.addEventListener("message", listener as EventListener);
      return () => local.removeEventListener("message", listener as EventListener);
    },
  };
}
