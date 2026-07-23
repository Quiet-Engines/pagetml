# PageTML — Help

PageTML opens a local HTML document and presents it as discrete, navigable
**pages** — like a slide deck or a PDF reader — instead of one long scroll. It's
built for presenting to an audience, and for distraction-free reading.

---

## Opening a document

- **Start screen** — pick a document from the list.
- **Drag and drop** an `.html` file onto the window. *(native build)*
- **File ▸ Open**, or double-click an `.html`/`.htm` file in your OS. *(native build)*

Relative assets (images, CSS, fonts, scripts) load from the file's own folder.
Your **last-read position is remembered per document** — reopen a file and you
land back where you left off.

---

## Reading mode

One page at a time, sized to fit the window. Resizing repaginates live and keeps
you on the same content.

| Action | Keys |
| --- | --- |
| Next page | `→` `↓` `Space` `Page Down` · scroll wheel · click right edge |
| Previous page | `←` `↑` `Shift+Space` `Page Up` · scroll wheel · click left edge |
| First / last page | `Home` / `End` |
| Enter presentation | `F5` or `Cmd`/`Ctrl`+`Shift`+`F`, or the **Present** button |
| Back to the library | `Esc` |

The status bar shows the current page (`3 / 12`).

---

## Presentation mode

Fills the screen, hides all chrome, and **locks pagination** — page boundaries
are frozen for the whole presentation, so your page numbers don't shift under
you. A brief HUD confirms the lock on entry, and the cursor auto-hides after a
couple of seconds of stillness.

| Action | Keys |
| --- | --- |
| Next / previous | same as reading mode (presentation clickers work too) |
| Jump to a page | type the page number, then `Enter` |
| Black screen | `B` (any key returns) |
| White screen | `W` (any key returns) |
| Exit presentation | `Esc` |

Exiting returns you to reading mode at the same place, and unlocks live
repagination. If content changes while locked, an **overflow** indicator appears
rather than reflowing mid-presentation. Media (video/audio) pauses automatically
when you turn away from its page.

---

## Remote resources

By default an opened document **cannot reach the internet** — only assets from
its own folder load. This keeps an untrusted file from phoning home or leaking
data. If you trust a specific document and it needs online images or fonts, use
the **Remote** toggle in the status bar. The choice is remembered **per file**
and is off by default.

---

## What PageTML opens

- Local `.html` / `.htm` files and their local assets.
- Malformed HTML renders the way a browser would — there is no validation wall.
- Scripts in the document run, but **sandboxed**: they cannot read other files,
  reach the app, or (with Remote off) access the network.

Not in this version: live URLs, EPUB, and authored slide decks.

---

## Troubleshooting

- **A page looks cut off / everything is on one page.** Some app-style pages
  wrap all content in a single scrolling box; PageTML unwraps common cases, but
  file a report with the document if one slips through.
- **Page counts differ between two machines.** Expected under auto-fit —
  different window sizes (and rendering engines) produce different counts. The
  *content* is the same; only the page boundaries move. This is why presentation
  mode locks pagination.
- **An online image didn't load.** Remote resources are blocked by default —
  turn on **Remote** for that document.
