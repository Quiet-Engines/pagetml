// The multicol pagination engine core (spec §4.3, QE-1415) plus live
// repagination observers (QE-1416).
//
// Technique: wrap the document's content in a flow element styled as a
// CSS multi-column box whose column-width equals the viewport width and whose
// height is fixed to the viewport height, with `column-fill: auto`. The browser
// then flows content into fixed-size columns — each column is one page — using
// its own line-breaking, float, and fragmentation logic. Extra columns overflow
// the (one-column-wide) box to the right; we clip with the viewport and turn
// pages by translating the flow horizontally by whole page widths.

import type { Anchor, PageState, PaginatorOptions } from "./types.js";
import { measureInFlow, pageAtX, pageCountForExtent } from "./measure.js";
import { captureAnchor, pageForAnchor } from "./anchor.js";
import { injectBaseStyle, normalizePositioning, unwrapScrollContainers } from "./normalize.js";

const FLOW_CLASS = "pager-flow";
const TRANSITION = "transform 250ms cubic-bezier(0.22, 0.61, 0.36, 1)";

export class Paginator {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly gap: number;
  private readonly animate: boolean;
  private readonly onChange?: (state: PageState) => void;

  private flow!: HTMLElement;
  private pageWidth = 0;
  private pageHeight = 0;
  private _pageCount = 1;
  private _currentPage = 0;
  private _locked = false;

  /** Continuously-updated anchor for the current page; used to keep position
   *  across repagination (resize / mutation). */
  private currentAnchor: Anchor | null = null;

  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private reflowTimer: number | undefined;
  private observing = false;

  constructor(opts: PaginatorOptions) {
    this.win = opts.win;
    this.doc = opts.win.document;
    this.gap = opts.gap ?? 40;
    this.animate = opts.animate ?? true;
    this.onChange = opts.onChange;
    this.setup();
  }

  // --- geometry ---------------------------------------------------------------

  private get stride(): number {
    return this.pageWidth + this.gap;
  }

  get pageCount(): number {
    return this._pageCount;
  }
  get currentPage(): number {
    return this._currentPage;
  }
  get locked(): boolean {
    return this._locked;
  }
  /** The flow element, for tests and invariant checks. */
  get flowElement(): HTMLElement {
    return this.flow;
  }
  debugMetrics() {
    return {
      pageWidth: this.pageWidth,
      pageHeight: this.pageHeight,
      gap: this.gap,
      stride: this.stride,
      pageCount: this._pageCount,
      currentPage: this._currentPage,
      scrollWidth: this.flow.scrollWidth,
    };
  }

  // --- setup ------------------------------------------------------------------

  private setup(): void {
    const doc = this.doc;

    // Normalize awkward content before it enters the flow.
    unwrapScrollContainers(doc);

    // Move all body content into the flow element.
    const flow = doc.createElement("div");
    flow.className = FLOW_CLASS;
    while (doc.body.firstChild) flow.appendChild(doc.body.firstChild);
    doc.body.appendChild(flow);
    this.flow = flow;

    // Base document styles. Actual per-page dimensions are set in paginate().
    const de = doc.documentElement;
    de.style.setProperty("margin", "0");
    de.style.setProperty("padding", "0");
    de.style.setProperty("overflow", "hidden");
    doc.body.style.setProperty("margin", "0");
    doc.body.style.setProperty("padding", "0");
    doc.body.style.setProperty("overflow", "hidden");
    doc.body.style.setProperty("position", "relative");

    flow.style.setProperty("box-sizing", "border-box");
    flow.style.setProperty("padding", "0");
    flow.style.setProperty("margin", "0");
    flow.style.setProperty("column-fill", "auto");
    flow.style.setProperty("will-change", "transform");

    this.layout();
    normalizePositioning(this.flow, this.win);
    // Positioning normalization can change heights; settle once afterwards.
    this.paginate();
  }

  // --- pagination -------------------------------------------------------------

  /** Size the flow and (re)count pages. Pure layout: no transform write, anchor
   *  capture, or emit — so it can run before normalization without side effects. */
  private layout(): void {
    this.pageWidth = Math.max(1, Math.floor(this.win.innerWidth));
    this.pageHeight = Math.max(1, Math.floor(this.win.innerHeight));

    injectBaseStyle(this.doc, this.pageWidth, this.pageHeight);

    this.doc.body.style.setProperty("width", `${this.pageWidth}px`);
    this.doc.body.style.setProperty("height", `${this.pageHeight}px`);

    const flow = this.flow;
    flow.style.setProperty("height", `${this.pageHeight}px`);
    flow.style.setProperty("width", `${this.pageWidth}px`);
    flow.style.setProperty("column-width", `${this.pageWidth}px`);
    flow.style.setProperty("column-gap", `${this.gap}px`);

    // Total content extent (transform-independent; scrollWidth is layout-based).
    this._pageCount = pageCountForExtent(flow.scrollWidth, this.stride, this.gap);
  }

  /** (Re)compute layout, then settle on the page the reader is anchored to. */
  paginate(): void {
    this.layout();

    // Restore the reader's position from the live anchor when we have one.
    const target = this.currentAnchor
      ? pageForAnchor(this.currentAnchor, this.flow, this.stride)
      : this._currentPage;
    this._currentPage = this.clampPage(target);

    // Capture the anchor (a layout read) before writing the transform, so the
    // write doesn't force a second layout for the read that follows.
    this.captureCurrentAnchor();
    this.applyTransform(false);
    this.emit();
  }

  private clampPage(p: number): number {
    if (Number.isNaN(p)) return 0;
    return Math.min(this._pageCount - 1, Math.max(0, p));
  }

  private applyTransform(animate: boolean): void {
    const useAnim = animate && this.animate && !this._locked;
    this.flow.style.setProperty("transition", useAnim ? TRANSITION : "none");
    this.flow.style.setProperty("transform", `translateX(${-this._currentPage * this.stride}px)`);
  }

  private captureCurrentAnchor(): void {
    this.currentAnchor = captureAnchor(this.flow, this._currentPage, this.stride);
  }

  private emit(): void {
    this.onChange?.({
      pageCount: this._pageCount,
      currentPage: this._currentPage,
      locked: this._locked,
    });
  }

  // --- navigation -------------------------------------------------------------

  goToPage(page: number, animate = true): void {
    this._currentPage = this.clampPage(page);
    // Capture (read) before the transform write to avoid a read-after-write
    // layout flush; measurement is transform-independent so order is safe.
    this.captureCurrentAnchor();
    this.applyTransform(animate);
    this.emit();
  }
  next(): void {
    this.goToPage(this._currentPage + 1);
  }
  prev(): void {
    this.goToPage(this._currentPage - 1);
  }
  first(): void {
    this.goToPage(0);
  }
  last(): void {
    this.goToPage(this._pageCount - 1);
  }

  // --- anchors ----------------------------------------------------------------

  getAnchor(): Anchor | null {
    return this.currentAnchor;
  }
  pageForAnchor(anchor: Anchor): number {
    return pageForAnchor(anchor, this.flow, this.stride);
  }
  restoreAnchor(anchor: Anchor, animate = false): void {
    this.goToPage(this.pageForAnchor(anchor), animate);
  }

  /** The page a given element currently sits on (for tests / link jumps). */
  pageForElement(el: Element): number {
    return pageAtX(measureInFlow(el, this.flow).left, this.stride);
  }

  // --- locking (presentation mode boundary lock lives in M3; here we only
  //     honor the flag so repagination is suppressed) --------------------------

  lock(): void {
    this._locked = true;
    this.emit();
  }
  unlock(): void {
    this._locked = false;
    this.emit();
    this.scheduleReflow();
  }

  // --- live repagination ------------------------------------------------------

  observe(enable: boolean): void {
    if (enable && !this.observing) {
      // Use the content window's own observer constructors (the engine runs
      // against an iframe window in tests and the app alike).
      const w = this.win as unknown as {
        ResizeObserver: typeof ResizeObserver;
        MutationObserver: typeof MutationObserver;
      };
      this.resizeObserver = new w.ResizeObserver(() => this.scheduleReflow());
      this.resizeObserver.observe(this.doc.documentElement);
      this.win.addEventListener("resize", this.onWinResize);
      this.mutationObserver = new w.MutationObserver(() => this.scheduleReflow());
      this.mutationObserver.observe(this.flow, { childList: true, subtree: true, characterData: true });
      this.observing = true;
    } else if (!enable && this.observing) {
      this.resizeObserver?.disconnect();
      this.mutationObserver?.disconnect();
      this.win.removeEventListener("resize", this.onWinResize);
      this.observing = false;
    }
  }

  private onWinResize = (): void => this.scheduleReflow();

  private scheduleReflow(): void {
    if (this._locked) return; // suppressed while locked
    if (this.reflowTimer !== undefined) this.win.clearTimeout(this.reflowTimer);
    this.reflowTimer = this.win.setTimeout(() => {
      this.reflowTimer = undefined;
      this.paginate();
    }, 50);
  }

  /** Synchronous repagination, for tests that don't want to await a debounce. */
  reflowNow(): void {
    if (this.reflowTimer !== undefined) {
      this.win.clearTimeout(this.reflowTimer);
      this.reflowTimer = undefined;
    }
    this.paginate();
  }

  destroy(): void {
    this.observe(false);
  }
}

export function createPaginator(opts: PaginatorOptions): Paginator {
  return new Paginator(opts);
}
