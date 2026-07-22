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

/**
 * Measure `el` in the flow's coordinate space. The result is independent of the
 * flow's current transform (static or mid-transition), because the flow's rect
 * carries the same transform and is subtracted out.
 */
export function measureInFlow(el: Element, flow: Element): FlowRect {
  const e = el.getBoundingClientRect();
  const f = flow.getBoundingClientRect();
  return {
    left: e.left - f.left,
    right: e.right - f.left,
    top: e.top - f.top,
    bottom: e.bottom - f.top,
    width: e.width,
    height: e.height,
  };
}

/** The page index that a given flow-space x-coordinate falls on. */
export function pageAtX(x: number, pageStride: number): number {
  if (pageStride <= 0) return 0;
  // A tiny epsilon absorbs sub-pixel rounding at exact boundaries.
  return Math.floor((x + 0.5) / pageStride);
}
