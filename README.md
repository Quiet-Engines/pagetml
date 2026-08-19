# PageTML

**Read and present HTML like a document, not a scroll.**

PageTML opens a local `.html` file and lays it out as discrete, navigable
pages — like a PDF reader or a slide deck. Built for presenting to an audience
and for distraction-free reading.

<!-- ⚠️ TODO: screenshot or demo GIF goes here — a page turn, entering
     presentation mode, and a window resize repaginating. That last beat is the
     answer to "why not just export a PDF?". Most people decide from it alone. -->

[**Download for macOS →**](../../releases/latest)

Requires **macOS 12 (Monterey) or later** on **Apple Silicon** — an M1 or newer
Mac. Intel Macs are not supported. *(Apple menu ▸ About This Mac shows which you
have.)*

---

## Why

Browsers render HTML and CSS beautifully. What they don't do is *paginate* — a
long document is one endless scroll, and there's no clean way to present one.

PageTML layers pagination and a presenter experience on top of the system web
engine (WKWebView), rather than shipping a new rendering engine. Your document
renders exactly as a browser would render it; it just arrives in pages.

## What it does

- **Pages, not scroll.** Content flows into fixed-size pages sized to your
  window, using the browser's own line-breaking and fragmentation. Resize and it
  repaginates live, keeping you on the same *content* — not the same page number.
- **Presentation mode** (`F5`). Fills the screen, hides all chrome, and **locks
  pagination** so page boundaries stay frozen for the whole talk. Type a number
  to jump; `B`/`W` for a black or white screen; clickers work.
- **Position is remembered per document.** Reopen a file and land where you left
  off — tracked by content anchor, so it survives a resize or a restart.
- **Offline by default.** An opened document can't reach the network, read other
  files, or touch the app. Flip the per-file **Remote** toggle for documents you
  trust.
- **No accounts, no telemetry, no cloud.** It's a local app that reads local
  files.

## Install

1. Download the latest `PageTML_*.dmg` from [Releases](../../releases/latest).
2. Open the `.dmg` and drag **PageTML** to your Applications folder.
3. Open a document: right-click a `.html` file → **Open With ▸ PageTML**, use
   **File ▸ Open** (`⌘O`), or drag the file onto the window.

Builds are Developer ID-signed and notarized by Apple, so they open without
Gatekeeper warnings.

## Keys

| Action | Keys |
| --- | --- |
| Next / previous page | `→` / `←` · `Space` · scroll · swipe · click a page edge |
| Enter presentation | `F5` |
| Jump to page *(presenting)* | type the number, then `Enter` |
| Black / white screen *(presenting)* | `B` / `W` |
| Exit | `Esc` |

Every binding, including the presentation-mode set:
[**docs/help.md**](docs/help.md).

## Not supported

Intel Macs · Windows · auto-update · live URLs · EPUB · authored slide decks.

**Why not just export a PDF?** A PDF's pages are fixed at export time. PageTML
paginates live against your actual window, so the same document reflows to fit a
laptop, a projector, or a resized window — and presentation mode freezes the
boundaries only while you're presenting. Page counts differing between machines
is the flip side of that, and exactly why presentation mode locks them.

## Bugs and requests

Open an [issue](../../issues) — that's the support channel. For pagination bugs,
**attach the HTML file** if you can; the layout problem usually lives in the
document.

Found a way out of the document sandbox? Please report it privately through
GitHub's [private vulnerability reporting](../../security/advisories/new) rather
than an issue — see [SECURITY.md](SECURITY.md).

## How it works

The source is here to read. The document body is wrapped in a CSS multi-column
box whose column width is the viewport width, so **each column is one page** and
the browser's own line-breaking and fragmentation does the layout. Page turns
translate the flow horizontally.

Two decisions carry most of the weight — measurement goes through the flow rather
than the viewport, and position is stored as a content anchor rather than a page
number. Both are written up, along with build instructions and the test layers,
in **[docs/development.md](docs/development.md)**.

## Source and license

PageTML is source-available proprietary software, not open source — you can read
the code, but it carries no rights to copy, modify, or redistribute.

**This version is free** to use, personally and commercially, and stays free for
anyone who has it. See [LICENSE.md](LICENSE.md).

Made by [Quiet Engines](https://quiet-engines.com/pagetml).
