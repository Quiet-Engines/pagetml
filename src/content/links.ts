// Link routing inside the content frame (spec §3.4, QE-1435).
//
// A paginated document must not let a link navigate the frame away from the
// content. Every anchor click is intercepted and routed:
//  - a same-document fragment (`#id`) jumps to the page containing that anchor;
//  - anything else is treated as external and handed to the chrome to open in
//    the system browser (the content frame never opens it itself).
// Top-level navigation is already blocked by the iframe sandbox; this also
// cancels same-frame navigation so the reader stays in the paginated view.

/** The engine surface link handling needs — a page lookup and a jump. */
export interface LinkNavigator {
  pageForElement(el: Element): number;
  goToPage(page: number): void;
}

export function installLinkHandling(
  doc: Document,
  engine: LinkNavigator,
  onExternal: (url: string) => void,
): void {
  const win = doc.defaultView ?? window;
  doc.addEventListener("click", (e) => {
    // Left-click only; let modified clicks (open-in-new-tab etc.) fall through
    // to the external path below rather than doing an in-frame jump.
    if (e.defaultPrevented || e.button !== 0) return;
    const anchor = (e.target as Element | null)?.closest?.("a");
    if (!anchor || !anchor.getAttribute("href")) return;

    const sameDocument =
      anchor.pathname === win.location.pathname && anchor.search === win.location.search;

    if (anchor.hash && sameDocument && !e.metaKey && !e.ctrlKey) {
      // Internal anchor: jump to the page holding the target, never scroll.
      e.preventDefault();
      const id = decodeURIComponent(anchor.hash.slice(1));
      const target = doc.getElementById(id) ?? doc.querySelector(`[name="${cssEscape(id)}"]`);
      if (target) engine.goToPage(engine.pageForElement(target));
      return;
    }

    // Everything else leaves the document — cancel the navigation and hand the
    // resolved URL to the chrome (system browser).
    e.preventDefault();
    onExternal(anchor.href);
  });
}

function cssEscape(value: string): string {
  const cssApi = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (cssApi?.escape) return cssApi.escape(value);
  // Minimal fallback: escape characters that would break an attribute selector.
  return value.replace(/["\\\]]/g, "\\$&");
}
