// Transform-independent measurement (spec §5 finding 1, QE-1418).
//
// The flow container is translated horizontally by whole page widths to turn
// pages, and that translation is animated with a CSS transition. Measuring an
// element's rect with getBoundingClientRect() therefore returns a value that is
// shifted by the flow's *current* transform — and, mid-transition, by an
// interpolated transform.
//
// The fix: never measure an element against the viewport. Always measure it
// against the flow container. Both the element and the flow are shifted by the
// same transform (the element is inside the flow), so subtracting the flow's
// rect cancels the transform exactly — including any interpolated value while a
// page-turn animation is in flight. This is the same correction the mockup
// needed, generalized into the one place all measurement goes through.

/** An element's geometry within the flow's own untransformed coordinate space. */
export interface FlowRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** The flow's viewport-space origin; enough to cancel its transform. */
export interface FlowOrigin {
  left: number;
  top: number;
}

/** Subtract the flow origin from a viewport-space rect (a fragment or element).
 *  This is the single transform-cancelling correction; everything else builds
 *  on it. */
export function measureRectInFlow(rect: DOMRect, flow: FlowOrigin): FlowRect {
  return {
    left: rect.left - flow.left,
    right: rect.right - flow.left,
    top: rect.top - flow.top,
    bottom: rect.bottom - flow.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Measure `el` in the flow's coordinate space. Pass a pre-read `flowOrigin`
 * when measuring many elements against the same flow (e.g. a TreeWalk) to avoid
 * re-reading — and re-forcing layout for — the flow rect per element.
 */
export function measureInFlow(el: Element, flow: Element, flowOrigin?: FlowOrigin): FlowRect {
  return measureRectInFlow(el.getBoundingClientRect(), flowOrigin ?? flow.getBoundingClientRect());
}

/** The page index that a given flow-space x-coordinate falls on. */
export function pageAtX(x: number, pageStride: number): number {
  if (pageStride <= 0) return 0;
  // A tiny epsilon absorbs sub-pixel rounding at exact boundaries.
  return Math.floor((x + 0.5) / pageStride);
}

/** Total page count for a content extent, given the page stride (width + gap).
 *  The inverse of `pageAtX` — both halves of the stride model live here. */
export function pageCountForExtent(scrollWidth: number, pageStride: number, gap: number): number {
  if (pageStride <= 0) return 1;
  return Math.max(1, Math.round((scrollWidth + gap) / pageStride));
}
