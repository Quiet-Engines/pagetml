# Pager brand assets

A custom typeface logo for Pager — no font dependency, every letterform is a
hand-drawn SVG path.

## Concept

The wordmark is a geometric monoline (round caps/joins, single stroke weight),
matching the app's calm, engineered identity. Two details carry the brand:

- **The dog-ear P.** The P's bowl is drawn as a page with a folded top-right
  corner — the product (pages) embedded in the letterform. It survives down to
  ~100 px wordmark width and is the basis of the app mark.
- **The spotlight period.** `Pager.` ends in a filled amber dot
  (`--amber #f5a623`), the single accent color of the "dark theater, lit
  stage" UI. It sits on the baseline, sized to the stroke weight.

## Construction grid

All paths live on one grid (stroke width 13, viewBox `-6 -8 398 152`):

| line       | y   |
|------------|-----|
| cap top    | 8   |
| x-height   | 36  |
| baseline   | 100 |
| descender  | 130 |

Lowercase bowls are perfect circles (r = 32); the g tail and r shoulder are
circular arcs. The P fold is a 45° cut 16 units deep.

## Files

- `wordmark-dark.svg` — ink strokes (`#e7e9ee`) for dark chrome.
- `wordmark-light.svg` — house strokes (`#171b24`) for paper/light contexts.
- `mark.svg` — app icon: the dog-ear P + amber period on a raised-chrome tile
  (`#1e2532`, radius 28/128). Legible at 16–32 px; also the favicon.

The app chrome (`src/chrome/chrome.ts`) inlines the wordmark with
`stroke="currentColor"` so it inherits chrome text color; only the period is
hard-amber.

## Usage rules

- Don't set the period in any color but amber, and don't add a second amber
  element to a lockup — the dot is the accent.
- Minimum sizes: wordmark 90 px wide; mark 16 px.
- Clear space: at least one stroke-width (13 grid units) on all sides.
