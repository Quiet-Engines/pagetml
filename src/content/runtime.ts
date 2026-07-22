// Content-frame runtime (spec §4.2, QE-1430) — the code injected alongside the
// user's document inside the sandboxed iframe. It runs the pagination engine on
// its OWN window and communicates with the trusted chrome ONLY through the
// versioned postMessage schema (QE-1423). It has no reference to, and no way to
// reach, the chrome's DOM or (in the real app) Tauri IPC.
//
// The document reaches the runtime one of two ways:
//  - `?fixture=<name>`: the runtime fetches the fixture and grafts it (dev
//    stand-in for the `pager://` handler serving the file with the runtime
//    injected).
//  - a `loadDocument` message from the chrome: a file the user dropped or picked
//    (QE-1428), whose HTML the chrome hands over directly.

import { createPaginator, createTransport } from "../engine/index.js";
import type { PagerMessage, Paginator } from "../engine/index.js";
import { installLinkHandling } from "./links.js";

function graftHtml(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const node of parsed.head.querySelectorAll("style, link[rel=stylesheet]")) {
    document.head.appendChild(document.importNode(node, true));
  }
  document.body.innerHTML = parsed.body.innerHTML;
}

async function graftFixture(name: string): Promise<void> {
  const res = await fetch(`/fixtures/${name}.html`);
  graftHtml(await res.text());
}

type Transport = ReturnType<typeof createTransport>;

/** Once the document is grafted, start the engine and wire the message channel. */
function boot(transport: Transport): void {
  const engine: Paginator = createPaginator({
    win: window,
    onChange: (state) => transport.send({ type: "state", state }),
  });
  engine.observe(true);

  // Internal links jump within the document; external links go to the chrome.
  installLinkHandling(document, engine, (url) => transport.send({ type: "openExternal", url }));

  // Forward pointer activity so the chrome's auto-hiding cursor works even when
  // the content frame fills the screen in presentation mode (QE-1441).
  // Throttled: at most one message per ~200ms.
  let lastActivity = 0;
  window.addEventListener(
    "mousemove",
    (e) => {
      const now = e.timeStamp;
      if (now - lastActivity < 200) return;
      lastActivity = now;
      transport.send({ type: "activity" });
    },
    { passive: true },
  );

  transport.onMessage((msg: PagerMessage) => {
    if (msg.type !== "command") return;
    const c = msg.command;
    switch (c.name) {
      case "next": engine.next(); break;
      case "prev": engine.prev(); break;
      case "first": engine.first(); break;
      case "last": engine.last(); break;
      case "goToPage": engine.goToPage(c.page); break;
      case "restoreAnchor": engine.restoreAnchor(c.anchor); break;
      case "lock": engine.lock(); break;
      case "unlock": engine.unlock(); break;
    }
    transport.send({ type: "anchor", anchor: engine.getAnchor() });
  });

  // The engine emits its initial state during construction (above); send the
  // current anchor too so the chrome can persist position from the start.
  transport.send({ type: "anchor", anchor: engine.getAnchor() });
}

async function main(): Promise<void> {
  // Post to the parent; listen on our own window (message events fire here).
  const transport = createTransport(window.parent, window);

  const fixture = new URLSearchParams(location.search).get("fixture");
  if (fixture) {
    await graftFixture(fixture);
    boot(transport);
    return;
  }

  // No fixture: wait for the chrome to deliver an opened file, then boot.
  const off = transport.onMessage((msg: PagerMessage) => {
    if (msg.type !== "loadDocument") return;
    off();
    graftHtml(msg.html);
    boot(transport);
  });
}

void main();
