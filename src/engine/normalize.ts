// Content normalization for hostile / awkward HTML (spec §4.3, QE-1419/20/21/22).
//
// Arbitrary HTML fights column pagination in a few predictable ways. We
// normalize those cases so the browser's own fragmentation can then do the
// heavy lifting. `normalizeContent` is idempotent and runs on every layout
// pass (not just once at setup), so script-injected content is normalized too
// (spec §3.4).

const BASE_STYLE_ID = "pagetml-base-style";

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
 * Is `el` a full-height box that traps its overflow — an SPA/app shell that
 * would otherwise collapse the whole document to one page (QE-1422)?
 *
 * Detection is by *measurement*, not by matching CSS height strings: computed
 * style resolves height to px, so string checks like `=== "100vh"` never fire.
 * We instead look for a box that (a) clips or scrolls its overflow and (b) is
 * about a viewport tall yet holds more content than it shows. This catches
 * `100vh` / `100%` / `dvh` / `calc(...)` shells alike, at any nesting depth.
 */
function isScrollTrap(el: HTMLElement, win: Window, viewportH: number): boolean {
  const overflowY = win.getComputedStyle(el).overflowY;
  const traps = overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden";
  if (!traps) return false;
  const clientH = el.clientHeight;
  // "About a viewport tall": a genuine shell, not a small inline scroller.
  const isViewportSized = clientH >= viewportH * 0.75;
  // "Holds more than it shows": overflow is actually being clipped/scrolled.
  const clipsContent = el.scrollHeight > clientH + 1;
  return isViewportSized && clipsContent;
}

/**
 * Normalize the flow's content in place. Idempotent, so it is safe to run on
 * every layout pass:
 *
 *  - **Scroll-trap shells (QE-1422):** neutralize height/overflow so the
 *    trapped content flows into columns instead of collapsing to one page.
 *  - **Fixed / sticky (QE-1421):** convert to `absolute` (fixed/sticky are
 *    inconsistent inside CSS columns across engines) AND drop the author's
 *    inset offsets, so the element stays at its static position — on the page
 *    it belongs to — rather than being pinned to the containing block's origin.
 */
export function normalizeContent(root: HTMLElement, win: Window): void {
  const viewportH = win.innerHeight;
  // The content window's own HTMLElement constructor (elements live in that
  // realm, so the parent realm's HTMLElement would not match).
  const HTMLElementCtor = (win as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (!(el instanceof HTMLElementCtor)) continue;
    const position = win.getComputedStyle(el).position;

    if (position === "fixed") {
      el.style.setProperty("position", "absolute", "important");
      // Auto insets => the absolute box renders at its static (in-flow)
      // position instead of being yanked to the containing block's edge.
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("right", "auto", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("left", "auto", "important");
    } else if (position === "sticky") {
      // Sticky is in-flow, so `static` keeps the element exactly at its flow
      // position and lets it fragment across columns. (Converting to absolute
      // is engine-inconsistent: WebKit resolves an abspos static position in a
      // multicol against the first column, pinning the element to page 0.)
      el.style.setProperty("position", "static", "important");
      el.style.setProperty("top", "auto", "important");
      el.style.setProperty("right", "auto", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("left", "auto", "important");
    }

    if (isScrollTrap(el, win, viewportH)) {
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("max-height", "none", "important");
      el.style.setProperty("overflow", "visible", "important");
    }
  }
}
