<!--
  This is the README for the PUBLIC distribution repo (Quiet-Engines/pagetml-app),
  not for this private source repo. Copy it there — see docs/DISTRIBUTION.md.
  Replace every ⚠️ placeholder before publishing.
-->

# PageTML

**Read and present HTML like a document, not a scroll.**

PageTML opens a local `.html` file and lays it out as discrete, navigable
pages — like a PDF reader or a slide deck. Built for presenting to an audience
and for distraction-free reading.

⚠️ *Add a screenshot or a short demo GIF here. This is the single highest-impact
thing on the page — most people decide from it alone.*

[**Download for macOS →**](../../releases/latest)

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

Requires **macOS 12 (Monterey) or later** on **Apple Silicon**.

1. Download the latest `PageTML_*.dmg` from [Releases](../../releases/latest).
2. Open the `.dmg` and drag **PageTML** to your Applications folder.
3. Open a document: right-click a `.html` file → **Open With ▸ PageTML**, use
   **File ▸ Open** (`⌘O`), or drag the file onto the window.

Builds are Developer ID-signed and notarized by Apple, so they open without
Gatekeeper warnings.

## Keys

| Action | Keys |
| --- | --- |
| Next page | `→` `↓` `Space` `Page Down` · scroll · swipe · click right edge |
| Previous page | `←` `↑` `Shift+Space` `Page Up` · scroll · swipe · click left edge |
| First / last page | `Home` / `End` |
| Enter presentation | `F5` or `⌘⇧F` |
| Jump to page *(presenting)* | type the number, then `Enter` |
| Black / white screen *(presenting)* | `B` / `W` |
| Exit | `Esc` |

Full guide: [**docs/help.md**](docs/help.md).

## Not in this version

Intel Macs · Windows · auto-update · live URLs · EPUB · authored slide decks.

Page counts differ between machines and window sizes — that's inherent to
auto-fit pagination, and exactly why presentation mode locks it.

## Bugs and requests

Open an [issue](../../issues). For pagination bugs, **attach the HTML file** if
you can — the layout problem usually lives in the document.

## Source and license

PageTML is source-available proprietary software, not open source. The
application is free to use, personally and commercially.
See [LICENSE.md](LICENSE.md).

⚠️ *Contact: add a support email.* · ⚠️ *Website: add the PageTML site URL.*
