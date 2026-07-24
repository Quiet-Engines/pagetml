# PageTML — Product Overview

*A briefing document for designing the PageTML landing page.*

---

## One-liner

**PageTML turns any HTML file into pages.** It's a desktop reader and presenter for macOS and Windows that opens a local HTML document and presents it as discrete, navigable pages — like a slide deck or a PDF — instead of one long scroll.

## Elevator pitch

HTML is the world's most common document format, but reading it means endless scrolling, and presenting it means awkwardly dragging a browser window around. PageTML gives HTML what PDFs and slide decks have always had: real pages. Drop in any `.html` file — an article, a report, an export from your notes app, generated docs — and PageTML paginates it beautifully, remembers where you left off, and can take it fullscreen for an audience with one keystroke. No conversion, no authoring tool, no cloud. Your file, on your machine, as pages.

## What it is

- A **native desktop app** (macOS and Windows) built on a custom pagination engine — the same CSS multi-column technique proven by professional EPUB readers.
- A **reader**: one page at a time, sized to fit the window, with keyboard/scroll/click navigation and a `3 / 12` page indicator.
- A **presenter**: fullscreen presentation mode that hides all chrome, freezes page boundaries so numbers never shift mid-talk, supports presentation clickers, jump-to-page, and B/W blank-screen keys.
- A **safe sandbox**: opened documents run in isolation and are blocked from the internet by default.

## Who it's for

1. **Presenters** — people who write talks, lectures, or demos in HTML/Markdown-to-HTML and want to present them like slides without converting to PowerPoint or Keynote.
2. **Focused readers** — people reading long-form HTML (articles, books, documentation, reports) who want a calm, distraction-free, book-like experience instead of a browser tab.
3. **Anyone handed an HTML file** — exports, generated reports, archived pages — who wants to open it safely and read it comfortably.

## Core features (landing-page material)

### 📄 True pagination, not fake scrolling
The engine flows content into real fixed-size pages using the browser's own line-breaking and fragmentation logic. Nothing gets clipped at page boundaries; nothing gets lost past the last page. Images and tall media scale to fit. Resize the window and it repaginates live — while keeping you on the same content.

### 🎤 Presentation mode
`F5` and you're fullscreen. Chrome disappears, the cursor auto-hides, and pagination **locks** — your page numbers are frozen for the whole talk. Navigate with arrow keys or a clicker, type a number to jump to a page, hit `B` or `W` for a black/white screen. Media pauses automatically when you turn away from its page. `Esc` drops you back into reading mode at the same spot.

### 🔖 Never lose your place
Your position is remembered **per document** — and not as a page number, but as an anchor to the actual content. Reopen a file, resize the window, even change machines with different fonts: you land on the page containing the exact spot you left.

### 🔒 Private and safe by default
Opened documents **cannot reach the internet** — only assets from their own folder load. Scripts run, but fully sandboxed: they can't read other files, touch the app, or phone home. Trust a specific file? Flip its per-document **Remote** toggle. Everything is local; there is no cloud, no account, no telemetry story to tell.

### ⚡ Zero-friction open
Drag and drop an `.html` file onto the window, double-click it in Finder/Explorer, use File ▸ Open, or pick from your recent-documents library. Relative assets (images, CSS, fonts) load from the file's own folder. Malformed HTML renders like a browser would — no validation wall.

## Differentiators (the "why not just…" answers)

| Alternative | Why PageTML wins |
| --- | --- |
| A browser tab | Endless scroll, distractions, no presentation mode, no position memory per file. |
| Convert to PDF | Loses live reflow — PDF pages don't adapt to your window; conversion is a chore and often mangles layout. |
| PowerPoint / Keynote | Requires re-authoring your content as slides. PageTML presents the document you already have. |
| EPUB readers | Won't open a plain `.html` file; built for books, not presenting. |

**Credibility notes:** the pagination engine is the product's core IP, validated by an automated invariant suite (no clipping, no lost content, stable anchors) running on both Chromium and WebKit — the same engines that power the app on Windows and macOS.

## Product principles (tone for the page)

- **Calm and focused** — the product is about removing noise: one page, nothing else. The landing page should feel the same: generous whitespace, typographic, book-like.
- **Local-first and trustworthy** — no cloud, offline by design, sandboxed by default. Security is a feature, stated plainly, not fearfully.
- **Craft** — this is a precision engine (page boundaries, anchors, fragmentation) wrapped in a simple app. Confident, technical-but-warm voice.

## Suggested landing page structure

1. **Hero** — one-liner + subline, with a visual of a long messy scrolling page transforming into clean discrete pages (or a side-by-side: browser scroll vs. PageTML pages). Primary CTA: "Download for macOS / Windows."
2. **The moment** — a short section on presenting: fullscreen page, presenter at a podium, "F5. That's it."
3. **Three-up feature row** — True pages · Presentation mode · Remembers your place.
4. **Safety section** — "Your documents never phone home." Offline-by-default sandbox, per-file remote toggle.
5. **How it works strip** — Drop in any .html → Read as pages → Present fullscreen.
6. **Differentiator table or FAQ** — the "why not just a browser/PDF/slides" answers above.
7. **Footer CTA** — download links for both platforms.

## Honest scope (don't overclaim)

- Opens **local** `.html`/`.htm` files and their local assets. Not in the current version: live URLs, EPUB, or a slide-authoring tool.
- Page counts naturally differ across window sizes and machines — that's by design (auto-fit), and presentation mode's pagination lock exists precisely so this never matters mid-talk.

## Key vocabulary

Use these terms consistently: **pages** (never "slides" for the content itself), **reading mode**, **presentation mode**, **pagination lock**, **Remote toggle**, **library** (the start screen / recents).
