// Content normalization for hostile / awkward HTML (spec §4.3, QE-1419/20/21/22).
//
// Arbitrary HTML fights column pagination in a few predictable ways. We
// normalize those cases *before* wrapping the content into the multicol flow so
// the browser's own fragmentation can then do the heavy lifting.

const BASE_STYLE_ID = "pager-base-style";

/**
 * Inject the engine's base stylesheet into the content document. It:
 *  - neutralizes page margins,
 *  - scales replaced elements (img/svg/video/canvas) to fit one page
 *    (QE-1420: elements taller/wider than a page),
 *  - lets `pre`/code wrap so long lines can fragment rather than clip,
 *  - leaves author `break-before/after/inside` rules to flow through the
 *    column fragmenter natively (QE-1419).
 */
export function injectBaseStyle(doc: Document, pageWidth: number, pageHeight: number): void {
  let style = doc.getElementById(BASE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = BASE_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = `
    html, body { margin: 0 !important; padding: 0 !important; }
    /* Replaced elements never exceed a single page. */
    img, svg, video, canvas, iframe {
      max-width: ${pageWidth}px !important;
      max-height: ${pageHeight}px !important;
      height: auto;
    }
    /* Code blocks wrap instead of forcing an unbreakable wide column. */
    pre { white-space: pre-wrap !important; overflow-wrap: anywhere !important; }
    /* Tables and long words may fragment or break rather than clip. */
    table { max-width: ${pageWidth}px !important; }
    * { overflow-wrap: break-word; }
  `;
}

/**
 * Detect and unwrap a single top-level `height:100%`/`100vh` scroll container
 * (SPA shells, app-style layouts). Such a container holds all its content in
 * one non-flowing viewport-height box, which produces exactly one page. We
 * neutralize the height and overflow so the content flows into columns
 * (QE-1422).
 */
export function unwrapScrollContainers(doc: Document): number {
  const win = doc.defaultView;
  if (!win) return 0;
  const viewportH = win.innerHeight;
  let unwrapped = 0;

  // Only consider elements near the top of the tree; a deep inner scroller is
  // usually intentional and small. We walk body's descendants but stop
  // descending once we've neutralized an ancestor.
  const candidates: Element[] = [doc.body, ...Array.from(doc.body.children)];
  for (const el of candidates) {
    if (!(el instanceof win.HTMLElement)) continue;
    const cs = win.getComputedStyle(el);
    const overflowY = cs.overflowY;
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    const h = el.getBoundingClientRect().height;
    const nearViewportHeight = Math.abs(h - viewportH) <= 2 || cs.height === "100vh" || cs.height === "100%";
    if (scrolls && nearViewportHeight) {
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("max-height", "none", "important");
      el.style.setProperty("overflow", "visible", "important");
      unwrapped++;
    }
  }
  return unwrapped;
}

/**
 * Normalize `position: fixed` and `position: sticky` elements to `absolute`.
 * Fixed/sticky positioning is inconsistent inside CSS columns across engines
 * (spec §4.3, QE-1421); pinning them to `absolute` keeps them on the page they
 * belong to instead of floating over every page or breaking the column box.
 * Runs on the content once it is inside the flow.
 */
export function normalizePositioning(root: HTMLElement, win: Window): number {
  let changed = 0;
  const all = root.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    const pos = win.getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") {
      el.style.setProperty("position", "absolute", "important");
      changed++;
    }
  }
  return changed;
}
