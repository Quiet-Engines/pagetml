# PageTML — pagination engine (Milestone 1)

PageTML is a paginated HTML reader/presenter for macOS and Windows. This
repository currently contains **Milestone 1: the shared pagination engine** —
the platform-agnostic core that turns an arbitrary HTML document into discrete,
navigable pages. (Linear project: *PageTML Application*, milestone M1.)

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
npm test                 # engine invariants, both engines (needs Chromium + WebKit)
npm run test:chromium    # Chromium only
npm run test:webkit      # WebKit only
```

The Tauri shell (`src-tauri/`) has its own two-layer coverage, since the
Playwright engine suite never loads the native shell:

```bash
npm run test:shell       # headless Rust unit tests (cargo test): traversal
                         # guard, store durability/identity, injection contract
npm run test:native      # driven smoke: builds and runs the real binary, asserts
                         # a document actually boots the runtime and paginates
                         # (needs a desktop/display; uses the store as the oracle)
```

The invariants asserted for every fixture at multiple window sizes (spec §7):

1. **No clipping** — no line/fragment straddles a page boundary or exceeds a
   page.
2. **Reachability** — every leaf's fragments land on a counted page (nothing
   lost past the last page).
3. **Anchor stability** — after a resize round-trip, an anchor still resolves to
   a page containing its target element.

## WKWebView go/no-go (QE-1426) — status: **GO**

M1's exit criterion is "fixture invariants green on both Chromium and WebKit,
WKWebView go/no-go decided." Decided 2026-07-23 on macOS (the WKWebView target
platform): **both engines green** — full suite 153/154 passed, the one
remainder being a known-flaky timing test that passes on retry.

Getting WebKit green surfaced two genuine engine differences, both absorbed in
the engine (not worked around in tests):

- **Sticky normalization (QE-1421):** sticky now converts to `static`, not
  `absolute` — WebKit resolves an abspos static position in a multicol against
  the first column, pinning the element to page 0.
- **Anchors on spill-over pages (QE-1417):** a page holding only the tail of a
  leaf that begins earlier had no anchor; `captureAnchor` now falls back to the
  leaf whose fragments reach the page.

One finding stands as a **native-shell requirement rather than a no-go**:
WebKit enforces most CSP directives but does not stop `connect-src` traffic —
a `no-cors` fetch leaves the browser despite the header (verified by request
interception; Chromium blocks it). The default-deny network guarantee
(QE-1431) on WKWebView therefore needs a native gate (`WKContentRuleList`) in
the shell; `tests/sandbox.spec.ts` documents this as an expected failure on
WebKit that will surface as an "unexpected pass" if upstream fixes it.
