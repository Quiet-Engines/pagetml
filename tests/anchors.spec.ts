import { test, expect } from "@playwright/test";
import { loadFixture } from "./helpers.js";

// Anchor stability across a resize round-trip (QE-1417, spec §5 finding 2).
// The assertion is on CONTAINMENT — after resizing away and back, the anchor
// still resolves to a page containing its target element — never on an expected
// page number, because font size scales with window width so the "same" content
// legitimately lands on a different page number.

// A representative subset spanning prose, nested-span exports, tables, and
// normalized positioning.
const ANCHOR_FIXTURES = ["prose", "gdocs-export", "tables-code", "fixed-sticky"];

for (const fixture of ANCHOR_FIXTURES) {
  test(`${fixture}: anchor survives a resize round-trip`, async ({ page }) => {
    await loadFixture(page, fixture, 800, 600);

    const result = await page.evaluate(() => {
      const h = window.__pagetml;
      // Navigate into the middle of the document and capture an anchor.
      const mid = Math.max(1, Math.floor(h.pageCount() / 2));
      h.goToPage(mid);
      const anchor = h.getAnchor();
      if (!anchor) return { ok: false, reason: "no anchor captured" };

      // Track the exact element the anchor points at.
      const marked = h.markAnchor(anchor);
      const pageWhenCaptured = h.currentPage();
      const markPageWhenCaptured = h.markedElementPage();

      // Resize narrower (more/other pagination), then back to the original size.
      h.setViewport(480, 720);
      h.setViewport(800, 600);

      // Restore the anchor and check the target element is on the current page.
      h.restoreAnchor(anchor);
      const restoredPage = h.currentPage();
      const markPageAfter = h.markedElementPage();

      return {
        ok: true,
        marked,
        pageWhenCaptured,
        markPageWhenCaptured,
        restoredPage,
        markPageAfter,
      };
    });

    expect(result.ok, result.ok ? "" : (result as { reason?: string }).reason).toBe(true);
    if (!result.ok) return;

    // Containment: the anchor's target element sits on the page the engine
    // restored to. (Page NUMBERS may differ from capture time — that's fine.)
    expect(result.markPageAfter).toBe(result.restoredPage);
    // Sanity: at capture time the anchor's target was on the current page too.
    expect(result.markPageWhenCaptured).toBe(result.pageWhenCaptured);
  });
}

test("anchor page-number may legitimately change after shrink (containment, not equality)", async ({ page }) => {
  await loadFixture(page, "prose", 1000, 700);
  const res = await page.evaluate(() => {
    const h = window.__pagetml;
    h.goToPage(2);
    const anchor = h.getAnchor()!;
    h.markAnchor(anchor);
    // Shrink and keep it shrunk.
    h.setViewport(520, 700);
    h.restoreAnchor(anchor);
    return {
      restoredPage: h.currentPage(),
      markPage: h.markedElementPage(),
      count: h.pageCount(),
    };
  });
  // The target is contained on the restored page, whatever its number now is.
  expect(res.markPage).toBe(res.restoredPage);
  expect(res.restoredPage).toBeGreaterThanOrEqual(0);
  expect(res.restoredPage).toBeLessThan(res.count);
});
