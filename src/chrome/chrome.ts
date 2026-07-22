// The trusted app chrome (spec §4.2, §5, QE-1432/1433/1436). It renders the two
// v1 states it can verify in a plain browser — start screen and reading mode —
// and drives the sandboxed content frame ONLY through the versioned postMessage
// schema. It never touches the iframe's document: navigation goes out as
// `command` messages, and page state comes back as `state`/`anchor` messages.
//
// (Presentation mode is M3; the Tauri shell, real file open, pager:// and
// persistence are the native M2 pieces, deferred until there's a build env.)

import { createTransport } from "../engine/index.js";
import type { PageState, PagerMessage } from "../engine/index.js";
import { FIXTURES } from "../fixtures.js";

// In the real app these come from the OS (recent files + file open). In dev the
// fixture corpus stands in for "documents on disk".
const SAMPLE_DOCS = FIXTURES;
const RECENTS_KEY = "pager.recents";

function getRecents(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    // Tolerate corrupt/tampered storage: only accept an array of strings.
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}
function addRecent(name: string): void {
  const next = [name, ...getRecents().filter((n) => n !== name)].slice(0, 10);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / disabled storage */
  }
}

type Command = Extract<PagerMessage, { type: "command" }>["command"];

class Chrome {
  private readonly root: HTMLElement;
  private state: PageState = { pageCount: 1, currentPage: 0, locked: false };
  private transport?: ReturnType<typeof createTransport>;
  private unsub?: () => void;
  private keyHandler?: (e: KeyboardEvent) => void;
  private frame?: HTMLIFrameElement;
  private wheelAccum = 0;
  private wheelLock = false;
  // Status-bar elements, cached when reading mode is built (updated on every
  // `state` message, so we don't re-query the DOM per page turn).
  private els?: { counter: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement };

  constructor(root: HTMLElement) {
    this.root = root;
  }

  // --- start screen ---------------------------------------------------------

  showStart(): void {
    this.teardownReading();

    // Static shell only — no interpolation of document names into HTML.
    this.root.innerHTML = `
      <div class="start" data-testid="start">
        <div>
          <div class="wordmark">Pager<span class="dot">.</span></div>
          <div class="tagline">A paginated reader for local HTML.</div>
        </div>
        <div class="dropzone">Drop an <strong>.html</strong> file here, or pick one below.</div>
        <div class="recents">
          <h2>Documents</h2>
          <div class="recent-list"></div>
        </div>
      </div>`;

    // Document names are user-controlled (filenames), so build each button via
    // the DOM — textContent / dataset never interpret markup — rather than
    // interpolating names into an innerHTML string.
    const recents = getRecents();
    const recentSet = new Set(recents);
    const list = this.root.querySelector(".recent-list")!;
    for (const name of new Set([...recents, ...SAMPLE_DOCS])) {
      list.appendChild(this.docButton(name, recentSet.has(name) ? "recent" : "sample"));
    }
  }

  private docButton(name: string, meta: string): HTMLButtonElement {
    const span = (cls: string, text: string) => {
      const s = document.createElement("span");
      s.className = cls;
      s.textContent = text; // textContent, never innerHTML — names are untrusted
      return s;
    };
    const btn = document.createElement("button");
    btn.className = "recent";
    btn.dataset.doc = name;
    btn.append(span("glyph", "▤"), span("name", `${name}.html`), span("meta", meta));
    btn.addEventListener("click", () => this.open(name));
    return btn;
  }

  // --- reading mode ---------------------------------------------------------

  open(fixture: string): void {
    this.teardownReading(); // leak-safe regardless of caller
    addRecent(fixture);
    this.state = { pageCount: 1, currentPage: 0, locked: false };

    // Static shell only — no interpolation of untrusted values into innerHTML.
    // The content iframe is created in JS below (with its src set before it is
    // inserted), so the document value is never HTML-parsed.
    this.root.innerHTML = `
      <div class="reading" data-testid="reading">
        <div class="stage" data-testid="stage">
          <button class="chevron left" data-testid="prev" aria-label="Previous page">‹</button>
          <button class="chevron right" data-testid="next" aria-label="Next page">›</button>
        </div>
        <div class="statusbar">
          <button class="back" data-testid="back">Pager<span class="dot">.</span></button>
          <span class="counter" data-testid="counter">– / –</span>
          <span class="chip">Reading</span>
          <span class="hint">← → Space to turn · Home / End · resizing repaginates</span>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    const prev = q<HTMLButtonElement>("[data-testid=prev]");
    const next = q<HTMLButtonElement>("[data-testid=next]");
    this.els = { counter: q("[data-testid=counter]"), prev, next };
    prev.addEventListener("click", () => this.prev());
    next.addEventListener("click", () => this.next());
    q("[data-testid=back]").addEventListener("click", () => this.showStart());

    const iframe = document.createElement("iframe");
    iframe.className = "paper";
    iframe.dataset.testid = "paper";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    this.frame = iframe;

    iframe.addEventListener("load", () => {
      const win = iframe.contentWindow;
      // Ignore a late load after the reader navigated away (teardown cleared
      // this.frame or a newer open() replaced it) — otherwise we'd wire a stale
      // transport and leak its window listener.
      if (!win || this.frame !== iframe) return;
      // Post to the frame; listen on our own window (and only accept messages
      // from this frame). This is the ONLY channel to the content — the chrome
      // never reads iframe.contentDocument.
      this.transport = createTransport(win, window);
      this.unsub = this.transport.onMessage((msg) => this.onMessage(msg));
    });

    // src set before insertion => exactly one load event across engines (an
    // empty-src iframe can fire a spurious about:blank load on some engines).
    iframe.src = `/app/content.html?fixture=${encodeURIComponent(fixture)}`;
    q("[data-testid=stage]").appendChild(iframe);

    this.attachInput();
  }

  private teardownReading(): void {
    this.unsub?.();
    this.unsub = undefined;
    this.transport = undefined;
    this.els = undefined;
    this.frame = undefined;
    this.wheelAccum = 0;
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = undefined;
  }

  private onMessage(msg: PagerMessage): void {
    if (msg.type === "state") {
      this.state = msg.state;
      this.updateStatus();
    } else if (msg.type === "openExternal") {
      // External links never open inside Pager. In the real app the Tauri shell
      // hands this to the OS default browser; in the browser build we open a new
      // tab. `noopener` severs the link back to this window.
      window.open(msg.url, "_blank", "noopener,noreferrer");
    }
    // `anchor` messages carry the reader's position; persisting and restoring
    // them (recent-file position restore) is part of the native M2 work.
  }

  private send(command: Command): void {
    this.transport?.send({ type: "command", command });
  }
  private next(): void { this.send({ name: "next" }); }
  private prev(): void { this.send({ name: "prev" }); }
  private first(): void { this.send({ name: "first" }); }
  private last(): void { this.send({ name: "last" }); }

  private updateStatus(): void {
    if (!this.els) return;
    const { currentPage, pageCount } = this.state;
    this.els.counter.textContent = `${currentPage + 1} / ${pageCount}`;
    this.els.prev.disabled = currentPage <= 0;
    this.els.next.disabled = currentPage >= pageCount - 1;
  }

  // --- input ----------------------------------------------------------------

  private attachInput(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight": case "ArrowDown": case "PageDown":
          this.next(); e.preventDefault(); break;
        case "ArrowLeft": case "ArrowUp": case "PageUp":
          this.prev(); e.preventDefault(); break;
        case " ":
          (e.shiftKey ? this.prev() : this.next()); e.preventDefault(); break;
        case "Home": this.first(); e.preventDefault(); break;
        case "End": this.last(); e.preventDefault(); break;
        case "Escape": this.showStart(); break;
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    const stage = this.root.querySelector<HTMLElement>("[data-testid=stage]")!;
    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // Ignore events entirely while locked (don't accumulate), so residual
        // momentum after a turn can't trigger a stray extra turn.
        if (this.wheelLock) return;
        this.wheelAccum += e.deltaY;
        if (Math.abs(this.wheelAccum) < 24) return; // small-scroll deadzone
        const forward = this.wheelAccum > 0;
        this.wheelAccum = 0;
        forward ? this.next() : this.prev();
        // Coalesce a burst of wheel events into one discrete page turn.
        this.wheelLock = true;
        window.setTimeout(() => (this.wheelLock = false), 260);
      },
      { passive: false },
    );
  }
}

const app = document.getElementById("app")!;
new Chrome(app).showStart();
