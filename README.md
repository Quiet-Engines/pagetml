# PageTML

A standalone HTML reader and presenter for macOS. It opens a local `.html`
document and presents it as discrete, navigable **pages** — like a slide deck or
a PDF reader — instead of one long scroll. Built for presenting to an audience
and for distraction-free reading.

The idea: browsers already render HTML/CSS perfectly; what they lack is
*pagination*. PageTML layers the pagination and presenter experience on top of
the system web engine (WKWebView) rather than shipping a new rendering engine.

## Install (macOS)

Requires **macOS 12 (Monterey) or later** on Apple Silicon.

1. Download the latest `PageTML_*.dmg` from the [Releases](../../releases) page.
2. Open the `.dmg` and drag **PageTML** into your Applications folder.
3. Open a document — right-click a `.html` file → **Open With ▸ PageTML**, use
   **File ▸ Open** (`⌘O`), or drag the file onto the window.

Release builds are Developer ID-signed and notarized, so they open without
Gatekeeper warnings.

## Using it

- **Open** a local `.html`/`.htm` file (drag-drop, `⌘O`, or "Open With"). Its
  relative assets — images, CSS, fonts — load from the file's own folder, and
  your last-read position is remembered per document.
- **Read**: one page at a time, sized to the window. `→` / `Space` / two-finger
  swipe / scroll to advance, `←` to go back, `Home`/`End` for first/last.
- **Present** (`F5`): fills the screen, hides the chrome, and freezes pagination
  so your page numbers don't shift. `B`/`W` for a black/white screen, type a
  number + `Enter` to jump, `Esc` to exit.
- **Remote resources are off by default** — an opened document can't reach the
  internet unless you flip the per-file **Remote** toggle. This keeps an
  untrusted file from phoning home.

Full guide: **[docs/help.md](docs/help.md)**.

---

## Development

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

### The pagination technique

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

### Build

```bash
npm install
npm run tauri dev        # run the app over the Vite dev server
npm run build:runtime    # rebuild the injected content runtime after editing it
npx tauri build          # produce a local .app/.dmg (ad-hoc signed)
npm run build:release    # signed + notarized build (needs Apple creds — see src-tauri/NOTES.md)
```

### Tests

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

### Engine validation

The multicol technique is validated on both Chromium (the WebView2 reference)
and WebKit. Two engine differences were absorbed along the way: sticky elements
normalize to `static` (WebKit pins an abspos static position in a multicol to
column 1), and a page holding only a leaf's spill-over tail falls back to that
leaf for its anchor. The invariants are also validated inside the **real system
WKWebView** the app ships on — not just Playwright's bundled WebKit, which
differs from it — via `npm run test:frag`.

### Releasing

See **[docs/RELEASING.md](docs/RELEASING.md)** for cutting a signed, notarized
GitHub release.
