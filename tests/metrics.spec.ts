import { test, expect, type Page } from "@playwright/test";

// Guards against vacuous invariant passes: every fixture must actually
// paginate into multiple pages at a normal window size (otherwise "no fragment
// straddles a boundary" is trivially true). Also logs concrete page counts,
// which serve as the recorded metrics behind the engine go/no-go (QE-1426).

const FIXTURES = [
  "prose",
  "breaks",
  "tall-media",
  "fixed-sticky",
  "scroll-shell",
  "tables-code",
  "gdocs-export",
];

async function loadFixture(page: Page, fixture: string, w: number, h: number) {
  await page.goto(`/harness/index.html?fixture=${fixture}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__pagerReady === true);
}

for (const fixture of FIXTURES) {
  test(`${fixture} paginates into multiple pages`, async ({ page }, testInfo) => {
    await loadFixture(page, fixture, 800, 600);
    const m = await page.evaluate(() => window.__pager.metrics());
    testInfo.annotations.push({
      type: "metrics",
      description: `${fixture} @ 800x600 → ${m.pageCount} pages (stride ${m.stride}px, scrollWidth ${m.scrollWidth}px)`,
    });
    expect(m.pageCount, `${fixture} should be non-trivially multi-page`).toBeGreaterThanOrEqual(2);
  });
}
