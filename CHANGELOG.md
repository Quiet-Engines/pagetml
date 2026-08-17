# Changelog

All notable changes to PageTML are recorded here. Versions follow
[semantic versioning](https://semver.org/).

## [1.0.0]

First public release. Requires macOS 12 (Monterey) or later on Apple Silicon.

### Reading

- Opens a local `.html`/`.htm` file and paginates it into discrete pages sized
  to the window — via drag-and-drop, **File ▸ Open** (`⌘O`), or **Open With** in
  Finder.
- Relative assets (images, CSS, fonts, scripts) load from the document's own
  folder.
- Live repagination on resize, keeping you on the same content rather than the
  same page number.
- Last-read position remembered per document, and a recents list on the start
  screen.
- Keyboard, scroll-wheel, two-finger swipe, and click-edge navigation;
  `Home`/`End` for first/last page.

### Presentation mode

- `F5` (or `⌘⇧F`) fills the screen, hides all chrome, and **locks pagination**
  so page boundaries stay frozen for the whole presentation.
- Jump to a page by typing its number; `B`/`W` for a black/white screen; cursor
  auto-hides; presentation clickers work.
- Media on a page pauses automatically when you turn away from it.
- An overflow indicator appears instead of reflowing if content changes while
  locked.

### Security

- Opened documents are **sandboxed and offline by default** — they cannot reach
  the network, read other files, or touch the app. A per-file **Remote** toggle
  opts a document you trust back into network access.
- Documents are served over a custom `pagetml://` protocol with a path-traversal
  guard in the Rust shell.
- No analytics, telemetry, crash reporting, or account system.

### Known limitations

- **Apple Silicon only.** No Intel (x86_64) build yet.
- **macOS only.** Windows packaging is not started.
- **No auto-update.** Each release is a fresh download.
- Live URLs, EPUB, and authored slide decks are not supported — local HTML only.
- Page counts legitimately differ between machines and window sizes. This is
  inherent to auto-fit pagination, and is why presentation mode locks it.

[1.0.0]: https://github.com/Quiet-Engines/pagetml/releases/tag/v1.0.0
