import { test, expect } from "@playwright/test";
import { FIXTURES, loadFixture } from "./helpers.js";

// Guards against vacuous invariant passes: every fixture must actually
// paginate into multiple pages at a normal window size (otherwise "no fragment
// straddles a boundary" is trivially true). Also logs concrete page counts,
// which serve as the recorded metrics behind the engine go/no-go (QE-1426).

for (const fixture of FIXTURES) {
  test(`${fixture} paginates into multiple pages`, async ({ page }, testInfo) => {
    await loadFixture(page, fixture, 800, 600);
    const m = await page.evaluate(() => window.__pagetml.metrics());
    testInfo.annotations.push({
      type: "metrics",
      description: `${fixture} @ 800x600 → ${m.pageCount} pages (stride ${m.stride}px, scrollWidth ${m.scrollWidth}px)`,
    });
    expect(m.pageCount, `${fixture} should be non-trivially multi-page`).toBeGreaterThanOrEqual(2);
  });
}
