// Content-frame runtime (spec §4.2, QE-1430) — the code injected alongside the
// user's document inside the sandboxed iframe. It runs the pagination engine on
// its OWN window and communicates with the trusted chrome ONLY through the
// versioned postMessage schema (QE-1423). It has no reference to, and no way to
// reach, the chrome's DOM or (in the real app) Tauri IPC.
//
// In the real app the `pager://` Rust handler serves the user's file with this
// runtime injected. In dev there is no such handler, so when a `?fixture=`
// param is present the runtime fetches the fixture and grafts it into its own
// document — an approximation of "the user's HTML, with the engine injected".

import { createPaginator, createTransport } from "../engine/index.js";
import type { PagerMessage } from "../engine/index.js";
import { installLinkHandling } from "./links.js";

async function graftFixture(name: string): Promise<void> {
  const res = await fetch(`/fixtures/${name}.html`);
  const parsed = new DOMParser().parseFromString(await res.text(), "text/html");
  for (const node of parsed.head.querySelectorAll("style, link[rel=stylesheet]")) {
    document.head.appendChild(document.importNode(node, true));
  }
  document.body.innerHTML = parsed.body.innerHTML;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture");
  if (fixture) await graftFixture(fixture);

  // Post to the parent; listen on our own window (message events fire here).
  const transport = createTransport(window.parent, window);

  const engine = createPaginator({
    win: window,
    onChange: (state) => transport.send({ type: "state", state }),
  });
  engine.observe(true);

  // Internal links jump within the document; external links go to the chrome.
  installLinkHandling(document, engine, (url) => transport.send({ type: "openExternal", url }));

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

void main();
