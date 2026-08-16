# Development

PageTML is a [Tauri](https://tauri.app) v2 app: a shared TypeScript pagination
engine that runs inside a sandboxed content frame, a trusted "chrome" UI that
drives it over a versioned `postMessage` schema, and a Rust shell (`src-tauri/`)
that serves documents over a custom `pagetml://` protocol and handles native
open / menus / fullscreen / persistence.

```
src/engine/      Pagination engine — multicol flow, measurement, anchors, normalization
src/chrome/      Trusted app UI (start screen, reading & presentation modes)
src/content/     The runtime injected alongside the user's document
src-tauri/       Rust shell — pagetml:// serving, sandbox, persistence, native integration
harness/         Drives the engine in an iframe + invariant checks
public/fixtures/ The pagination fixture corpus
tests/           Playwright specs
```

## The pagination technique

CSS multi-column, the approach proven by EPUB renderers such as Readium:

- The document body is wrapped in a **flow** element styled as a multi-column
  box whose `column-width` equals the viewport width and whose height is fixed
  to the viewport height (`column-fill: auto`). The engine flows content into
  fixed-size columns — **each column is one page** — using the browser's own
  line-breaking, float, and fragmentation logic.
- Extra columns overflow to the right; the viewport clips them. **Page turns
  translate the flow horizontally** by whole page widths.
- Author `break-before/after/inside` rules flow through natively via column
  fragmentation.

Two design decisions carried throughout:

- **All measurement goes through the flow, not the viewport.** An element's rect
  and the flow's rect are both shifted by the flow's current transform (even
  mid page-turn), so measuring child-relative-to-flow cancels the transform
  exactly.
- **Position is a content anchor, never a page number.** Page numbers are a
  function of window size; a CFI-like path + offset survives repagination and
  restart. So the same content legitimately lands on a different page number
  after a resize — which is why presentation mode *locks* pagination.

## Build

```bash
npm install
npm run tauri dev        # run the app over the Vite dev server
npm run build:runtime    # rebuild the injected content runtime after editing it
npx tauri build          # produce a local .app/.dmg (ad-hoc signed)
npm run build:release    # signed + notarized build (needs Apple creds — see src-tauri/NOTES.md)
```

## Tests

```bash
npm run typecheck
npm test                 # engine invariants, both engines (needs Chromium + WebKit)
npm run test:chromium    # Chromium only
npm run test:webkit      # WebKit only
```

The Playwright suite never loads the native shell, so the Rust shell has its own
layered coverage (macOS; the driven ones need a desktop/display):

```bash
npm run test:shell       # headless Rust unit tests: traversal guard, store
                         # durability/identity, runtime-injection contract
npm run test:native      # driven smoke — the real binary boots the runtime and paginates
npm run test:fileassoc   # opens an .html through Launch Services → RunEvent::Opened
npm run test:frag        # the invariant suite inside the REAL system WKWebView
```

The invariants asserted for every fixture at multiple window sizes:

1. **No clipping** — no line/fragment straddles a page boundary or exceeds a page.
2. **Reachability** — every leaf's fragments land on a counted page.
3. **Anchor stability** — after a resize round-trip, an anchor still resolves to
   a page containing its target element.

## Engine validation

The multicol technique is validated on both Chromium (the WebView2 reference)
and WebKit. Two engine differences were absorbed along the way: sticky elements
normalize to `static` (WebKit pins an abspos static position in a multicol to
column 1), and a page holding only a leaf's spill-over tail falls back to that
leaf for its anchor. The invariants are also validated inside the **real system
WKWebView** the app ships on — not just Playwright's bundled WebKit, which
differs from it — via `npm run test:frag`.

## Releasing

- **[RELEASING.md](RELEASING.md)** — cutting a signed, notarized build.
- **[DISTRIBUTION.md](DISTRIBUTION.md)** — getting that build in front of people:
  the launch checklist, and what has to be true before you post about it.
- **[../CHANGELOG.md](../CHANGELOG.md)** — what's in each version.
