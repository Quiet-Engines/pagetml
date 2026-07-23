// Content anchors (spec §3.2, §4.3, QE-1417).
//
// An anchor is a CFI-like path (child-index steps from the flow root) plus a
// character offset. It lets the engine remember "where the reader is" as a
// property of the content, not of the current pagination — so it survives
// window resizes, repagination, and app restarts.

import type { Anchor } from "./types.js";
import { measureInFlow, pageAtX } from "./measure.js";
import { isReplacedElement } from "./dom.js";

/** Build a child-index path from `root` down to `el`. */
export function pathToElement(el: Element, root: Element): number[] {
  const path: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  return path;
}

/**
 * Resolve a path back to an element. If the exact path no longer exists (the
 * DOM mutated), fall back to the deepest ancestor that still resolves — the
 * anchor degrades gracefully instead of failing.
 */
export function elementAtPath(root: Element, path: number[]): Element {
  let cur: Element = root;
  for (const idx of path) {
    const next = cur.children[idx];
    if (!next) break; // graceful fallback: stop at the last valid ancestor
    cur = next;
  }
  return cur;
}

function firstTextHint(el: Element): string {
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  return text.slice(0, 24);
}

/**
 * Capture an anchor for the first piece of real content visible on `page`.
 * Walks the flow in document order and picks the first leaf-ish element that
 * begins on `page`. Leaf-ish = has no element children, or is a replaced
 * element — this yields a precise anchor rather than a big wrapper that merely
 * starts on the page.
 */
export function captureAnchor(
  flow: HTMLElement,
  page: number,
  pageStride: number,
): Anchor | null {
  const walker = flow.ownerDocument.createTreeWalker(flow, NodeFilter.SHOW_ELEMENT);
  let firstOnPage: Element | null = null;
  // A page may hold only the spill-over tail of a leaf that *begins* on an
  // earlier page (its union rect starts there), so no element starts on it at
  // all — common on the last page. Track the leaf whose fragments reach into
  // `page` as a fallback anchor.
  let spillingLeaf: Element | null = null;
  // Read the flow origin once; measuring N children against it avoids N extra
  // flow-rect reads (each of which can force a synchronous layout).
  const flowOrigin = flow.getBoundingClientRect();

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as Element;
    const rect = measureInFlow(el, flow, flowOrigin);
    if (rect.width === 0 && rect.height === 0) continue; // not rendered
    const elPage = pageAtX(rect.left, pageStride);
    if (elPage !== page) {
      // Cheapest guards first: this walk runs on every page turn, and
      // textContent builds the whole subtree's text.
      if (
        !spillingLeaf &&
        elPage < page &&
        el.childElementCount === 0 &&
        pageAtX(Math.max(rect.left, rect.right - 1), pageStride) >= page &&
        (el.textContent ?? "").trim()
      ) {
        spillingLeaf = el;
      }
      continue;
    }

    if (!firstOnPage) firstOnPage = el;

    const isLeaf = el.childElementCount === 0;
    const hasText = (el.textContent ?? "").trim().length > 0;
    if (isLeaf && (hasText || isReplacedElement(el))) {
      return { path: pathToElement(el, flow), offset: 0, textHint: firstTextHint(el) };
    }
  }

  if (firstOnPage) {
    return { path: pathToElement(firstOnPage, flow), offset: 0, textHint: firstTextHint(firstOnPage) };
  }
  if (spillingLeaf) {
    return { path: pathToElement(spillingLeaf, flow), offset: 0, textHint: firstTextHint(spillingLeaf) };
  }
  return null;
}

/** The page an anchor currently resolves to, given the live pagination. */
export function pageForAnchor(anchor: Anchor, flow: HTMLElement, pageStride: number): number {
  const el = elementAtPath(flow, anchor.path);
  const rect = measureInFlow(el, flow);
  return pageAtX(rect.left, pageStride);
}

/**
 * The full page range the anchor's element spans — from the page containing
 * its start to the page containing its last pixel. A spilling leaf (captured
 * as a fallback on a page holding only its tail) spans several pages; callers
 * restoring a live position should clamp into this range rather than jump to
 * the start page.
 */
export function pageRangeForAnchor(
  anchor: Anchor,
  flow: HTMLElement,
  pageStride: number,
): { start: number; end: number } {
  const el = elementAtPath(flow, anchor.path);
  const rect = measureInFlow(el, flow);
  const start = pageAtX(rect.left, pageStride);
  const end = Math.max(start, pageAtX(Math.max(rect.left, rect.right - 1), pageStride));
  return { start, end };
}
