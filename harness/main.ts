// Test harness that drives the pagination engine the way the real app's content
// frame will, and exposes an API + invariant checks for Playwright to assert on
// (QE-1425). The fixture is loaded into a same-origin iframe (mirroring the real
// architecture: the engine paginates a document inside a frame); the engine runs
// against that iframe's window.

import {
  createPaginator,
  elementAtPath,
  isPagerMessage,
  isReplacedElement,
  measureRectInFlow,
  pageAtX,
  PROTOCOL_VERSION,
  type Paginator,
} from "../src/engine/index.js";
import type { Anchor } from "../src/engine/index.js";

const MARK_ATTR = "data-pager-mark";

interface Offender {
  tag: string;
  text: string;
  leftPage: number;
  rightPage: number;
  width: number;
  height: number;
}

interface InvariantReport {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  clipping: Offender[];
  unreachable: Offender[];
  leafCount: number;
}

declare global {
  interface Window {
    __pager: PagerHarness;
    __pagerReady: boolean;
  }
}

class PagerHarness {
  private iframe!: HTMLIFrameElement;
  private engine!: Paginator;
  private flow!: HTMLElement;

  async load(fixture: string, w = 800, h = 600): Promise<void> {
    const stage = document.getElementById("stage")!;
    stage.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    iframe.src = `/fixtures/${fixture}.html`;
    stage.appendChild(iframe);
    this.iframe = iframe;

    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
    });

    const win = iframe.contentWindow!;
    this.engine = createPaginator({ win, animate: false });
    this.flow = this.engine.flowElement;
    this.engine.observe(true);
  }

  setViewport(w: number, h: number): ReturnType<Paginator["debugMetrics"]> {
    this.iframe.style.width = `${w}px`;
    this.iframe.style.height = `${h}px`;
    // Force layout in the content window, then repaginate synchronously.
    void this.iframe.contentWindow!.document.documentElement.offsetWidth;
    this.engine.reflowNow();
    return this.engine.debugMetrics();
  }

  metrics() {
    return this.engine.debugMetrics();
  }
  pageCount(): number {
    return this.engine.pageCount;
  }
  currentPage(): number {
    return this.engine.currentPage;
  }
  goToPage(i: number): void {
    this.engine.goToPage(i, false);
  }
  next(): void {
    this.engine.next();
  }
  prev(): void {
    this.engine.prev();
  }
  first(): void {
    this.engine.first();
  }
  last(): void {
    this.engine.last();
  }
  lock(): void {
    this.engine.lock();
  }
  unlock(): void {
    this.engine.unlock();
  }

  getAnchor(): Anchor | null {
    return this.engine.getAnchor();
  }
  pageForAnchor(a: Anchor): number {
    return this.engine.pageForAnchor(a);
  }
  restoreAnchor(a: Anchor): void {
    this.engine.restoreAnchor(a, false);
  }

  /** Tag the element an anchor resolves to, so a test can track it across
   *  repagination and assert the anchor still points at it. */
  markAnchor(a: Anchor): { tag: string; text: string } {
    this.clearMarks();
    const cur = elementAtPath(this.flow, a.path);
    cur.setAttribute(MARK_ATTR, "1");
    return { tag: cur.tagName, text: (cur.textContent ?? "").trim().slice(0, 24) };
  }
  markedElementPage(): number {
    const el = this.flow.querySelector(`[${MARK_ATTR}]`);
    if (!el) return -1;
    return this.engine.pageForElement(el);
  }
  private clearMarks(): void {
    for (const el of this.flow.querySelectorAll(`[${MARK_ATTR}]`)) el.removeAttribute(MARK_ATTR);
  }

  /** The page a selected element currently sits on (for normalization tests). */
  pageOf(selector: string): number {
    const el = this.flow.querySelector(selector);
    return el ? this.engine.pageForElement(el) : -1;
  }

  /** A computed style property of a selected element (content window realm). */
  computedStyle(selector: string, prop: string): string {
    const el = this.flow.querySelector(selector);
    if (!el) return "";
    return this.iframe.contentWindow!.getComputedStyle(el).getPropertyValue(prop);
  }

  /** Inject a full-height scroll-trap shell after load, then repaginate — proves
   *  normalization re-runs on reflow rather than only at setup (QE-1421/1422). */
  injectScrollTrap(): void {
    const doc = this.iframe.contentDocument!;
    const trap = doc.createElement("div");
    trap.id = "injected-shell";
    trap.style.height = "100vh";
    trap.style.overflow = "auto";
    let html = "";
    for (let i = 0; i < 12; i++) {
      html += `<p>Injected shell paragraph ${i}: enough text to overflow the viewport height several times so the container genuinely traps its content and would otherwise collapse to a single page.</p>`;
    }
    trap.innerHTML = html;
    this.flow.appendChild(trap);
    this.engine.reflowNow();
  }

  /** Exercise the versioned message-schema guard (QE-1423). */
  checkProtocol(): { valid: boolean; invalidType: boolean; wrongVersion: boolean } {
    const good = { v: PROTOCOL_VERSION, type: "command", command: { name: "next" } };
    const wrongVersion = { v: 999, type: "command", command: { name: "next" } };
    const notAMessage = { hello: "world" };
    return {
      valid: isPagerMessage(good),
      invalidType: isPagerMessage(notAMessage),
      wrongVersion: isPagerMessage(wrongVersion),
    };
  }

  /** The core invariants (spec §7): no fragment straddles a page boundary or
   *  exceeds a page, and every leaf's fragments land on real pages. */
  invariants(): InvariantReport {
    const m = this.engine.debugMetrics();
    const { stride, pageWidth, pageHeight, pageCount } = m;
    // Read the flow origin once (see measure.ts) and cancel its transform via
    // the same helper the engine uses, so the invariant checker and production
    // share one boundary definition.
    const flowOrigin = this.flow.getBoundingClientRect();
    const clipping: Offender[] = [];
    const unreachable: Offender[] = [];
    const eps = 1.5;

    const offender = (el: Element, r: DOMRect, leftPage: number, rightPage: number): Offender => ({
      tag: el.tagName,
      text: (el.textContent ?? "").trim().slice(0, 40),
      leftPage,
      rightPage,
      width: Math.round(r.width),
      height: Math.round(r.height),
    });

    const leaves = this.leafContentElements();
    for (const el of leaves) {
      for (const r of el.getClientRects()) {
        const rect = measureRectInFlow(r, flowOrigin);
        const leftPage = pageAtX(rect.left, stride);
        const rightPage = pageAtX(rect.right - 1, stride);

        // Clipping: a fragment straddles the gap, is wider than a page, or is
        // taller than a page (would be cut by the fixed column height).
        if (rightPage !== leftPage || r.width > pageWidth + eps || r.height > pageHeight + eps) {
          clipping.push(offender(el, r, leftPage, rightPage));
        }
        // Reachability: the fragment sits on a counted page.
        if (leftPage < 0 || leftPage >= pageCount || rightPage < 0 || rightPage >= pageCount) {
          unreachable.push(offender(el, r, leftPage, rightPage));
        }
      }
    }

    return {
      pageCount: m.pageCount,
      pageWidth,
      pageHeight,
      clipping,
      unreachable,
      leafCount: leaves.length,
    };
  }

  private leafContentElements(): Element[] {
    const win = this.iframe.contentWindow!;
    const out: Element[] = [];
    const walker = this.flow.ownerDocument.createTreeWalker(this.flow, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n as Element;
      if (el.childElementCount > 0) continue; // leaves only
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const hasText = (el.textContent ?? "").trim().length > 0;
      if (hasText || isReplacedElement(el)) out.push(el);
    }
    return out;
  }
}

async function boot() {
  const harness = new PagerHarness();
  window.__pager = harness;
  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture");
  const w = Number(params.get("w") ?? 800);
  const h = Number(params.get("h") ?? 600);
  if (fixture) {
    await harness.load(fixture, w, h);
  }
  window.__pagerReady = true;
}

void boot();
