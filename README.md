# Pager — pagination engine (Milestone 1)

Pager is a paginated HTML reader/presenter for macOS and Windows. This
repository currently contains **Milestone 1: the shared pagination engine** —
the platform-agnostic core that turns an arbitrary HTML document into discrete,
navigable pages. (Linear project: *Pagetml Application*, milestone M1.)

The engine is the product's core IP. It runs inside the (sandboxed) content
frame in the real app; here it is exercised in headless browsers under
Playwright, exactly as it will run in WebView2 and WKWebView.

## The technique

CSS multi-column, the approach proven by EPUB renderers such as Readium:

- The document body is wrapped in a **flow** element styled as a multi-column
  box whose `column-width` equals the viewport width and whose height is fixed
  to the viewport height, with `column-fill: auto`. The browser flows content
  into fixed-size columns — **each column is one page** — using its own
  line-breaking, float, and fragmentation logic.
- Extra columns overflow the one-column-wide box to the right; the viewport
  clips them. **Page turns translate the flow horizontally** by whole page
  widths (`translateX(-page × (pageWidth + gap))`).
- `break-before/after/inside` flow through natively via column fragmentation.

## Layout

```
src/engine/
  paginator.ts   Core engine: multicol flow, page counting, navigation,
                 live repagination observers (QE-1415, QE-1416)
  measure.ts     Transform-independent measurement (QE-1418)
  anchor.ts      Content anchors: CFI-like path + offset (QE-1417)
  normalize.ts   Break hints, tall-media scaling, fixed/sticky, scroll-shell
                 unwrapping (QE-1419/1420/1421/1422)
  messages.ts    Versioned engine↔chrome postMessage schema (QE-1423)
harness/         Test harness that drives the engine in an iframe + invariant
                 checks (QE-1425)
public/fixtures/ The fixture corpus (QE-1424)
tests/           Playwright specs: invariants, anchors, metrics
```

## Design notes worth carrying forward

- **All measurement goes through the flow, not the viewport.** An element's rect
  and the flow's rect are both shifted by the flow's current transform (even an
  interpolated value mid page-turn), so measuring child-relative-to-flow cancels
  the transform exactly. This is the generalized fix for the mockup's
  "measuring mid-transition returns interpolated values" bug (`measure.ts`).
- **Position is a content anchor, never a page number.** Page numbers are a
  function of window size; a CFI-like path + offset survives repagination and
  restart. Tests assert on **containment** (the anchor's target is on the
  restored page), never on an expected page number — because font size scales
  with window width, the same content legitimately lands on a different page
  number after a resize.

## Running

```bash
npm install
npm run typecheck
npm test                 # both engines (needs Chromium + WebKit installed)
npm run test:chromium    # Chromium only
npm run test:webkit      # WebKit only
```

The invariants asserted for every fixture at multiple window sizes (spec §7):

1. **No clipping** — no line/fragment straddles a page boundary or exceeds a
   page.
2. **Reachability** — every leaf's fragments land on a counted page (nothing
   lost past the last page).
3. **Anchor stability** — after a resize round-trip, an anchor still resolves to
   a page containing its target element.

## WKWebView go/no-go (QE-1426) — status: **provisional GO**

M1's exit criterion is "fixture invariants green on both Chromium and WebKit,
WKWebView go/no-go decided." Current state:

- **Chromium (WebView2 reference engine): GREEN.** All 37 checks pass across 7
  fixtures × 3 window sizes plus behavior tests. Recorded page counts at
  800×600: prose 3, tall-media 3, breaks/fixed-sticky/scroll-shell/tables-code/
  gdocs-export 2 — i.e. pagination is non-trivial, not a vacuous single page.
- **WebKit (WKWebView proxy): NOT YET RUN HERE.** The development sandbox's
  network policy blocks Playwright's browser CDN, so WebKit could not be
  installed. The `engine-ci` GitHub Actions workflow installs both engines and
  runs the suite on each; the WebKit leg there is what closes the decision.

The decision is **provisional GO** on the strength of (a) the technique being
the same one Readium/epub.js ship on WKWebView in production and (b) invariants
written to be engine-agnostic (no pixel-identical-boundary assumptions). It
converts to a **final GO** when the WebKit CI leg is green, or flips to the
recorded Electron fallback if WebKit reveals fragmentation failures the
normalization layer can't absorb.
