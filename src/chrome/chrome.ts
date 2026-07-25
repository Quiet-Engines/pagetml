// The trusted app chrome (spec §4.2, §5, QE-1432/1433/1436). It renders the two
// v1 states it can verify in a plain browser — start screen and reading mode —
// and drives the sandboxed content frame ONLY through the versioned postMessage
// schema. It never touches the iframe's document: navigation goes out as
// `command` messages, and page state comes back as `state`/`anchor` messages.
//
// (Presentation mode is M3; the Tauri shell, real file open, pagetml:// and
// persistence are the native M2 pieces, deferred until there's a build env.)

import { createTransport, isAnchor } from "../engine/index.js";
import type { Anchor, PageState, PagetmlMessage } from "../engine/index.js";
import { FIXTURES } from "../fixtures.js";
import {
  initNativeShell,
  isNative,
  nativeOpenDialog,
  nativeOpenRecent,
  nativeRecentNames,
  nativeSetFullscreen,
  nativeSetPosition,
  nativeSetRemote,
  onNativeFullscreenChanged,
  type NativeDoc,
} from "./native.js";

// In the real app these come from the OS (recent files + file open). In dev the
// fixture corpus stands in for "documents on disk".
const SAMPLE_DOCS = FIXTURES;
const RECENTS_KEY = "pagetml.recents";

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

// The "allow remote resources" toggle is off by default and remembered per file
// (spec §4.4). In the real app this per-file preference lives in the Tauri
// layer alongside recents; in dev it is localStorage.
const REMOTE_KEY = (name: string) => `pagetml.remote.${name}`;
function isRemoteAllowed(name: string): boolean {
  try {
    return localStorage.getItem(REMOTE_KEY(name)) === "1";
  } catch {
    return false;
  }
}
function setRemoteAllowed(name: string, on: boolean): void {
  try {
    localStorage.setItem(REMOTE_KEY(name), on ? "1" : "0");
  } catch {
    /* ignore quota / disabled storage */
  }
}

// Last-read position, stored per file as a content anchor so it survives
// repagination and restarts (spec §3.2, QE-1434). The Tauri layer owns this in
// the real app; in dev it is localStorage.
const POS_KEY = (name: string) => `pagetml.pos.${name}`;
function loadPosition(name: string): Anchor | null {
  try {
    const raw = localStorage.getItem(POS_KEY(name));
    const a = raw ? (JSON.parse(raw) as unknown) : null;
    return isAnchor(a) ? a : null;
  } catch {
    return null;
  }
}
function savePosition(name: string, anchor: Anchor): void {
  try {
    localStorage.setItem(POS_KEY(name), JSON.stringify(anchor));
  } catch {
    /* ignore quota / disabled storage */
  }
}

type Command = Extract<PagetmlMessage, { type: "command" }>["command"];

class Chrome {
  private readonly root: HTMLElement;
  private state: PageState = { pageCount: 1, currentPage: 0, locked: false, overflow: false };
  private transport?: ReturnType<typeof createTransport>;
  private unsub?: () => void;
  private keyHandler?: (e: KeyboardEvent) => void;
  private frame?: HTMLIFrameElement;
  private currentFixture?: string;
  /** For a document opened from a dropped/picked file, its HTML (re-sent to the
   *  frame on every load, e.g. after a remote-toggle reload). Undefined for
   *  fixtures, which the frame loads itself via `?fixture=`. */
  private currentHtml?: string;
  /** For a document served natively over pagetml://, the URL the frame loads
   *  directly (the runtime is injected server-side). Undefined otherwise. */
  private currentPagetmlUrl?: string;
  /** A saved position to restore once the freshly-opened document is ready. */
  private pendingRestore?: Anchor;
  private wheelAccum = 0;
  private wheelLock = false;
  /** The current document's "allow remote resources" state — from the shell's
   *  store for native docs, localStorage in dev (QE-1431). */
  private remoteOn = false;
  // --- presentation mode (QE-1437..1444) ---
  private presenting = false;
  /** In native presentation, whether macOS has actually entered fullscreen.
   *  Guards against acting on a transient `fullscreen-changed(false)` during
   *  the enter animation, and gates the display-disconnect exit (QE-1446). */
  private nativeFullscreen = false;
  private blackout: "none" | "black" | "white" = "none";
  private jumpBuffer = "";
  private cursorTimer?: number;
  private hudTimer?: number;
  // Status-bar / overlay elements, cached when reading mode is built (updated on
  // every `state` message, so we don't re-query the DOM per page turn).
  private els?: {
    counter: HTMLElement;
    prev: HTMLButtonElement;
    next: HTMLButtonElement;
    chip: HTMLElement;
    hud: HTMLElement;
    blackout: HTMLElement;
    jump: HTMLElement;
    overflowFlag: HTMLElement;
    reading: HTMLElement;
  };

  constructor(root: HTMLElement) {
    this.root = root;
    // In the Tauri shell, load documents the OS opens (dialog / file
    // association / CLI). Inert in the browser build.
    initNativeShell((doc) => this.openNative(doc));
    // Native fullscreen transitions during presentation (QE-1446). Inert in a
    // browser. Registered once so there's a single listener.
    onNativeFullscreenChanged((fs) => this.onNativeFullscreen(fs));
  }

  /** Open a document served natively over pagetml:// (Tauri shell). */
  private openNative(doc: NativeDoc): void {
    // Ignore only a frontend_ready replay of the document already showing.
    // A fresh open must always reload, even at the same URL: the URL is built
    // from the basename, so it is shared by different files with the same name
    // — and re-opening the current file (to pick up an external edit) is
    // legitimate too.
    if (doc.replay && doc.url === this.currentPagetmlUrl) return;
    this.startReading(doc.name, undefined, doc.url, doc);
  }

  // --- start screen ---------------------------------------------------------

  showStart(): void {
    this.teardownReading();

    // Static shell only — no interpolation of document names into HTML.
    this.root.innerHTML = `
      <div class="start" data-testid="start">
        <div>
          <div class="wordmark">PageTML<span class="dot">.</span></div>
          <div class="tagline">A paginated reader for local HTML.</div>
        </div>
        <div class="dropzone" data-testid="dropzone">
          Drop an <strong>.html</strong> file here, or <u>click to choose</u> — or pick one below.
          <input type="file" accept=".html,.htm,text/html" hidden data-testid="file-input" />
        </div>
        <div class="recents">
          <h2>Documents</h2>
          <div class="recent-list"></div>
        </div>
      </div>`;

    // Document names are user-controlled (filenames), so build each button via
    // the DOM — textContent / dataset never interpret markup — rather than
    // interpolating names into an innerHTML string.
    const list = this.root.querySelector(".recent-list")!;
    if (isNative()) {
      // The shell owns recents in native — it holds the real paths, so opening
      // goes back through it (session-only until the Tauri store, QE-1434).
      void nativeRecentNames().then((files) => {
        files.forEach((file, i) => {
          const name = file.replace(/\.html?$/i, "");
          list.appendChild(this.docButton(name, "recent", () => nativeOpenRecent(i)));
        });
      });
    } else {
      // The sample fixtures exist only on the dev server.
      const recents = getRecents();
      const recentSet = new Set(recents);
      for (const name of new Set([...recents, ...SAMPLE_DOCS])) {
        list.appendChild(this.docButton(name, recentSet.has(name) ? "recent" : "sample"));
      }
    }

    // Drag-and-drop and file-picker open paths (QE-1428). OS file association
    // and the CLI argument are native (Tauri) — deferred.
    const dropzone = this.root.querySelector<HTMLElement>("[data-testid=dropzone]")!;
    const input = this.root.querySelector<HTMLInputElement>("[data-testid=file-input]")!;
    // In the Tauri shell, use the native file dialog; in the browser, the input.
    dropzone.addEventListener("click", () => (isNative() ? nativeOpenDialog() : input.click()));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.openFile(file);
    });
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.openFile(file);
    });
  }

  /** Open a dropped or picked local file (QE-1428). */
  private async openFile(file: File): Promise<void> {
    const html = await file.text();
    this.openHtml(file.name.replace(/\.html?$/i, ""), html);
  }

  private docButton(name: string, meta: string, onOpen?: () => void): HTMLButtonElement {
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
    btn.addEventListener("click", onOpen ?? (() => this.open(name)));
    return btn;
  }

  // --- reading mode ---------------------------------------------------------

  /** Open a sample/fixture document (loaded by the frame via `?fixture=`). */
  open(fixture: string): void {
    addRecent(fixture);
    this.startReading(fixture, undefined);
  }

  /** Open a document whose HTML the chrome supplies (dropped/picked file). Not
   *  added to recents — dev can't reopen it without the file (native holds the
   *  path). */
  private openHtml(name: string, html: string): void {
    this.startReading(name, html);
  }

  private startReading(
    name: string,
    html: string | undefined,
    pagetmlUrl?: string,
    native?: NativeDoc,
  ): void {
    this.teardownReading(); // leak-safe regardless of caller
    this.currentFixture = name;
    this.currentHtml = html;
    this.currentPagetmlUrl = pagetmlUrl;
    // Native documents carry their per-file state from the shell's store,
    // keyed by real path; the chrome's localStorage (display-name-keyed, so
    // two files named report.html would collide) is dev-only.
    this.remoteOn = native ? native.remote : isRemoteAllowed(name);
    this.pendingRestore = native ? native.position : (loadPosition(name) ?? undefined);
    this.state = { pageCount: 1, currentPage: 0, locked: false, overflow: false };

    // Static shell only — no interpolation of untrusted values into innerHTML.
    // The content iframe is created in JS below (with its src set before it is
    // inserted), so the document value is never HTML-parsed.
    this.root.innerHTML = `
      <div class="reading" data-testid="reading">
        <div class="stage" data-testid="stage">
          <button class="chevron left" data-testid="prev" aria-label="Previous page">‹</button>
          <button class="chevron right" data-testid="next" aria-label="Next page">›</button>
        </div>
        <div class="blackout" data-testid="blackout" hidden></div>
        <div class="hud" data-testid="hud" hidden></div>
        <div class="jump" data-testid="jump" hidden></div>
        <div class="overflow-flag" data-testid="overflow-flag" hidden>Content overflow — pagination locked</div>
        <div class="statusbar">
          <button class="back" data-testid="back">PageTML<span class="dot">.</span></button>
          <span class="counter" data-testid="counter">– / –</span>
          <span class="chip" data-testid="chip">Reading</span>
          <button class="toggle" data-testid="remote-toggle" aria-pressed="false">Remote off</button>
          <button class="toggle" data-testid="present">Present ▸</button>
          <span class="hint">← → Space · F5 present · Home / End</span>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    const prev = q<HTMLButtonElement>("[data-testid=prev]");
    const next = q<HTMLButtonElement>("[data-testid=next]");
    this.els = {
      counter: q("[data-testid=counter]"),
      prev,
      next,
      chip: q("[data-testid=chip]"),
      hud: q("[data-testid=hud]"),
      blackout: q("[data-testid=blackout]"),
      jump: q("[data-testid=jump]"),
      overflowFlag: q("[data-testid=overflow-flag]"),
      reading: q("[data-testid=reading]"),
    };
    prev.addEventListener("click", () => this.prev());
    next.addEventListener("click", () => this.next());
    q("[data-testid=back]").addEventListener("click", () => this.showStart());
    q("[data-testid=present]").addEventListener("click", () => this.enterPresentation());

    const toggle = q<HTMLButtonElement>("[data-testid=remote-toggle]");
    this.renderRemoteToggle(toggle, this.remoteOn);
    toggle.addEventListener("click", () => void this.toggleRemote(toggle));

    this.frame = this.buildFrame();
    q("[data-testid=stage]").appendChild(this.frame);

    this.attachInput();
  }

  /** The content-frame URL for the current document, honoring its per-file
   *  "allow remote resources" setting (which selects the CSP the dev server
   *  sends — see vite.config.ts / QE-1431). Fixtures load via `?fixture=`;
   *  opened files load a bare frame and receive their HTML via `loadDocument`. */
  private contentUrl(): string {
    // A natively-served document loads its pagetml:// URL directly (runtime is
    // injected by the Rust handler; remote CSP is set there via set_remote).
    if (this.currentPagetmlUrl) return this.currentPagetmlUrl;
    const params = new URLSearchParams();
    if (this.currentHtml === undefined && this.currentFixture) params.set("fixture", this.currentFixture);
    if (this.remoteOn) params.set("remote", "1");
    const qs = params.toString();
    return `/app/content.html${qs ? `?${qs}` : ""}`;
  }

  /** Create the sandboxed content iframe for the current document. */
  private buildFrame(): HTMLIFrameElement {
    const iframe = document.createElement("iframe");
    iframe.className = "paper";
    iframe.dataset.testid = "paper";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");

    iframe.addEventListener("load", () => {
      const win = iframe.contentWindow;
      // Ignore a late load after the reader navigated away (teardown cleared
      // this.frame or a newer open()/reload replaced it) — otherwise we'd wire a
      // stale transport and leak its window listener.
      if (!win || this.frame !== iframe) return;
      // Post to the frame; listen on our own window (and only accept messages
      // from this frame). This is the ONLY channel to the content — the chrome
      // never reads iframe.contentDocument.
      this.transport = createTransport(win, window);
      this.unsub = this.transport.onMessage((msg) => this.onMessage(msg));
      // An opened file has no ?fixture to fetch — hand its HTML to the frame.
      if (this.currentHtml !== undefined) {
        this.transport.send({ type: "loadDocument", html: this.currentHtml });
      }
      // A natively served document's runtime is already evaluated and waiting
      // for this before it boots (its initial messages would predate the
      // listener wired above). Harmless on the other paths.
      this.transport.send({ type: "ready" });
    });

    // src set before insertion => exactly one load event across engines (an
    // empty-src iframe can fire a spurious about:blank load on some engines).
    iframe.src = this.contentUrl();
    return iframe;
  }

  private renderRemoteToggle(btn: HTMLButtonElement, on: boolean): void {
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Remote on" : "Remote off";
    btn.title = on
      ? "Remote resources allowed for this document (click to block)"
      : "Remote resources blocked for this document (click to allow)";
  }

  /** Flip the per-file remote-resources setting and reload the frame under the
   *  new CSP. Reloads the same iframe element, so drop the old transport first. */
  private async toggleRemote(btn: HTMLButtonElement): Promise<void> {
    const fixture = this.currentFixture;
    if (!fixture || !this.frame) return;
    this.remoteOn = !this.remoteOn;
    this.renderRemoteToggle(btn, this.remoteOn);
    if (this.currentPagetmlUrl) {
      // Native docs: the shell owns the per-file preference and the CSP is a
      // pagetml:// response header — wait for the flag to land, or the reload
      // below races it and can be served under the stale CSP.
      await nativeSetRemote(this.remoteOn);
    } else {
      setRemoteAllowed(fixture, this.remoteOn); // dev persistence
    }

    // Reload the same iframe under the new CSP; drop the old transport first.
    // The load handler re-wires and (for opened files) re-sends the document.
    this.unsub?.();
    this.unsub = undefined;
    this.transport = undefined;
    this.frame.src = this.contentUrl();
  }

  private teardownReading(): void {
    this.cleanupPresentation(); // clear presentation timers/listeners (uses this.els)
    this.unsub?.();
    this.unsub = undefined;
    this.transport = undefined;
    this.els = undefined;
    this.frame = undefined;
    this.currentFixture = undefined;
    this.currentHtml = undefined;
    this.currentPagetmlUrl = undefined;
    this.pendingRestore = undefined;
    this.wheelAccum = 0;
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.keyHandler = undefined;
  }

  private onMessage(msg: PagetmlMessage): void {
    if (msg.type === "state") {
      this.state = msg.state;
      this.updateStatus();
      // Once the document is ready, restore the saved position (once).
      if (this.pendingRestore) {
        const anchor = this.pendingRestore;
        this.pendingRestore = undefined;
        this.send({ name: "restoreAnchor", anchor });
      }
    } else if (msg.type === "anchor") {
      // Persist the reader's position per file (spec §3.2, QE-1434) — in the
      // shell's path-keyed store for native docs, localStorage in dev.
      if (msg.anchor) {
        if (this.currentPagetmlUrl) nativeSetPosition(msg.anchor);
        else if (this.currentFixture) savePosition(this.currentFixture, msg.anchor);
      }
    } else if (msg.type === "openExternal") {
      // External links never open inside PageTML. In the real app the Tauri shell
      // hands this to the OS default browser; in the browser build we open a new
      // tab. `noopener` severs the link back to this window.
      window.open(msg.url, "_blank", "noopener,noreferrer");
    } else if (msg.type === "activity") {
      // Pointer moved inside the content frame — keep the cursor visible.
      if (this.presenting) this.bumpCursor();
    } else if (msg.type === "wheel") {
      // Wheel/trackpad swipe forwarded from the content frame (QE-1445).
      if (this.presenting) this.bumpCursor();
      this.onWheelDelta(msg.dx, msg.dy);
    }
  }

  private send(command: Command): void {
    this.transport?.send({ type: "command", command });
  }
  private next(): void { this.send({ name: "next" }); }
  private prev(): void { this.send({ name: "prev" }); }
  private first(): void { this.send({ name: "first" }); }
  private last(): void { this.send({ name: "last" }); }
  private goTo(page: number): void { this.send({ name: "goToPage", page }); }

  private updateStatus(): void {
    if (!this.els) return;
    const { currentPage, pageCount, overflow } = this.state;
    // The engine-confirmed lock state (the chip only reflects the chrome's
    // intent — the lock command may still be in flight). Tests and tooling
    // wait on this instead of a clock.
    this.els.reading.dataset.engineLocked = String(this.state.locked);
    this.els.counter.textContent = `${currentPage + 1} / ${pageCount}`;
    this.els.prev.disabled = currentPage <= 0;
    this.els.next.disabled = currentPage >= pageCount - 1;
    this.els.overflowFlag.hidden = !overflow; // locked-mode overflow indicator
    if (this.presenting) this.updateHud();
  }

  // --- input ----------------------------------------------------------------

  private attachInput(): void {
    this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener("keydown", this.keyHandler);

    // Wheel/trackpad over the chrome itself (chevrons, statusbar). Wheel over
    // the content frame is forwarded as a `wheel` message (QE-1445) and routed
    // through the same handler.
    const stage = this.root.querySelector<HTMLElement>("[data-testid=stage]")!;
    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.onWheelDelta(e.deltaX, e.deltaY);
      },
      { passive: false },
    );
  }

  /** Turn a page from a wheel/trackpad delta. Uses the dominant axis, so a
   *  two-finger horizontal swipe (dx) turns pages just like a vertical scroll
   *  (dy). Positive → next, negative → prev (QE-1445). */
  private onWheelDelta(dx: number, dy: number): void {
    // Ignore events entirely while locked (don't accumulate), so residual
    // momentum after a turn can't trigger a stray extra turn.
    if (this.wheelLock) return;
    this.wheelAccum += Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    if (Math.abs(this.wheelAccum) < 24) return; // small-scroll deadzone
    const forward = this.wheelAccum > 0;
    this.wheelAccum = 0;
    forward ? this.next() : this.prev();
    // Coalesce a burst of wheel events into one discrete page turn.
    this.wheelLock = true;
    window.setTimeout(() => (this.wheelLock = false), 260);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.presenting) {
      this.onPresentationKey(e);
      return;
    }
    // Enter presentation: F5 or Cmd/Ctrl+Shift+F (spec §3.3).
    if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f")) {
      e.preventDefault();
      this.enterPresentation();
      return;
    }
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
  }

  // --- presentation mode (QE-1437..1444) ------------------------------------

  private onPresentationKey(e: KeyboardEvent): void {
    // While blacked/whited out, any key returns to the slide (spec §3.3).
    if (this.blackout !== "none") {
      e.preventDefault();
      if (e.key.toLowerCase() === "b") this.setBlackout(this.blackout === "black" ? "none" : "black");
      else if (e.key.toLowerCase() === "w") this.setBlackout(this.blackout === "white" ? "none" : "white");
      else this.setBlackout("none");
      return;
    }
    // Typing a page number then Enter jumps to that page (spec §3.3).
    if (/^[0-9]$/.test(e.key)) {
      this.jumpBuffer += e.key;
      this.renderJump();
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "Enter": this.commitJump(); e.preventDefault(); break;
      case "b": case "B": this.setBlackout("black"); e.preventDefault(); break;
      case "w": case "W": this.setBlackout("white"); e.preventDefault(); break;
      case "Escape":
        if (this.jumpBuffer) this.clearJump();
        else this.exitPresentation();
        e.preventDefault();
        break;
      case "ArrowRight": case "ArrowDown": case "PageDown":
        this.clearJump(); this.next(); e.preventDefault(); break;
      case "ArrowLeft": case "ArrowUp": case "PageUp":
        this.clearJump(); this.prev(); e.preventDefault(); break;
      case " ":
        this.clearJump(); (e.shiftKey ? this.prev() : this.next()); e.preventDefault(); break;
      case "Home": this.first(); e.preventDefault(); break;
      case "End": this.last(); e.preventDefault(); break;
    }
  }

  private enterPresentation(): void {
    if (this.presenting || !this.els) return;
    this.presenting = true;
    this.els.reading.classList.add("presenting");
    this.els.chip.textContent = "Presenting";
    this.send({ name: "lock" }); // engine repaginates once at this size, then freezes
    this.showHud();
    this.startCursorAutoHide();
    if (isNative()) {
      // Real macOS fullscreen (own Space). The window resizes to the display;
      // onNativeFullscreen re-locks at that size and exits presentation if
      // macOS later leaves fullscreen (QE-1446).
      nativeSetFullscreen(true);
    } else {
      // Browser: element fullscreen, best-effort — presentation works logically
      // even if denied.
      this.els.reading.requestFullscreen?.().catch(() => {});
      document.addEventListener("fullscreenchange", this.onFullscreenChange);
    }
  }

  /** Native fullscreen transition during presentation (QE-1446). */
  private onNativeFullscreen(fullscreen: boolean): void {
    if (!this.presenting) return;
    if (fullscreen) {
      // The window is now display-sized; re-lock so pagination is frozen at the
      // presenting display's resolution, not the windowed size.
      this.nativeFullscreen = true;
      this.send({ name: "lock" });
    } else if (this.nativeFullscreen) {
      // We were fullscreen and macOS left it — Esc, the green button, or the
      // presenting display disconnecting. Drop back to reading mode (M3 rule).
      this.exitPresentation();
    }
  }

  private exitPresentation(): void {
    if (!this.presenting) return;
    const els = this.els;
    const wasNative = isNative();
    this.cleanupPresentation();
    if (els) {
      els.reading.classList.remove("presenting", "cursor-hidden");
      els.chip.textContent = "Reading";
      els.hud.hidden = true;
      els.blackout.hidden = true;
      els.jump.hidden = true;
    }
    // Leave macOS fullscreen (no-op if we're here because macOS already left it).
    if (wasNative) nativeSetFullscreen(false);
    // Engine unlocks and reflows back to the equivalent content position (§3.3).
    this.send({ name: "unlock" });
  }

  /** Reset presentation state/timers/listeners WITHOUT messaging the frame — for
   *  teardown, where the frame is going away anyway. */
  private cleanupPresentation(): void {
    this.presenting = false;
    this.nativeFullscreen = false;
    this.blackout = "none";
    this.jumpBuffer = "";
    if (this.cursorTimer) window.clearTimeout(this.cursorTimer);
    if (this.hudTimer) window.clearTimeout(this.hudTimer);
    this.cursorTimer = this.hudTimer = undefined;
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    window.removeEventListener("mousemove", this.onPresentationMouseMove);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }

  // Leaving fullscreen (e.g. the browser's own Esc) exits presentation too.
  private onFullscreenChange = (): void => {
    if (this.presenting && !document.fullscreenElement) this.exitPresentation();
  };

  private setBlackout(mode: "none" | "black" | "white"): void {
    this.blackout = mode;
    const b = this.els?.blackout;
    if (!b) return;
    b.hidden = mode === "none";
    b.className = "blackout" + (mode === "none" ? "" : ` ${mode}`);
  }

  private renderJump(): void {
    const j = this.els?.jump;
    if (!j) return;
    j.hidden = this.jumpBuffer === "";
    j.textContent = this.jumpBuffer;
  }
  private clearJump(): void {
    if (this.jumpBuffer) {
      this.jumpBuffer = "";
      this.renderJump();
    }
  }
  private commitJump(): void {
    const n = parseInt(this.jumpBuffer, 10);
    this.clearJump();
    if (!Number.isNaN(n)) {
      const page = Math.min(Math.max(n, 1), this.state.pageCount) - 1;
      this.goTo(page);
    }
  }

  private showHud(): void {
    this.updateHud();
    const h = this.els?.hud;
    if (!h) return;
    h.hidden = false;
    if (this.hudTimer) window.clearTimeout(this.hudTimer);
    this.hudTimer = window.setTimeout(() => {
      if (this.els) this.els.hud.hidden = true;
    }, 2200);
  }
  private updateHud(): void {
    if (!this.els) return;
    this.els.hud.textContent = `${this.state.currentPage + 1} / ${this.state.pageCount} — pagination locked`;
  }

  private startCursorAutoHide(): void {
    // Listen on the chrome window (moves over the content frame arrive as
    // `activity` messages instead — see onMessage).
    window.addEventListener("mousemove", this.onPresentationMouseMove);
    this.bumpCursor();
  }
  private onPresentationMouseMove = (): void => this.bumpCursor();
  private bumpCursor(): void {
    const r = this.els?.reading;
    if (!r) return;
    r.classList.remove("cursor-hidden");
    if (this.cursorTimer) window.clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => r.classList.add("cursor-hidden"), 2000);
  }
}

const app = document.getElementById("app")!;
new Chrome(app).showStart();
