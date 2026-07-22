import { test, expect, type Page } from "@playwright/test";

// The fixture corpus (QE-1424). Each is paginated and asserted against the
// invariants (QE-1425) on both Chromium (WebView2 proxy) and WebKit (WKWebView
// proxy) — the cross-engine run is the evidence for the WKWebView go/no-go
// (QE-1426).
const FIXTURES = [
  "prose",
  "breaks",
  "tall-media",
  "fixed-sticky",
  "scroll-shell",
  "tables-code",
  "gdocs-export",
];

// A few representative window sizes. Auto-fit means page counts differ across
// these; the invariants must hold at every size (spec §7).
const VIEWPORTS = [
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 480, h: 720 },
];

async function loadFixture(page: Page, fixture: string, w: number, h: number) {
  await page.goto(`/harness/index.html?fixture=${fixture}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__pagerReady === true);
}

test.describe("pagination invariants", () => {
  for (const fixture of FIXTURES) {
    for (const vp of VIEWPORTS) {
      test(`${fixture} @ ${vp.w}x${vp.h} holds invariants`, async ({ page }) => {
        await loadFixture(page, fixture, vp.w, vp.h);
        const report = await page.evaluate(() => window.__pager.invariants());

        expect(report.leafCount, "fixture should contain content").toBeGreaterThan(0);
        expect(report.pageCount, "should paginate to at least one page").toBeGreaterThanOrEqual(1);

        // No fragment straddles a page boundary or exceeds a page (no clipping).
        expect(report.clipping, JSON.stringify(report.clipping, null, 2)).toEqual([]);
        // Every leaf's fragments land on a counted page (nothing lost).
        expect(report.unreachable, JSON.stringify(report.unreachable, null, 2)).toEqual([]);
      });
    }
  }
});

test.describe("engine behavior", () => {
  test("scroll-shell is unwrapped into multiple pages", async ({ page }) => {
    // If the single top-level 100vh scroll container were not unwrapped, this
    // document would collapse to a single page (QE-1422).
    await loadFixture(page, "scroll-shell", 800, 600);
    const pageCount = await page.evaluate(() => window.__pager.pageCount());
    expect(pageCount).toBeGreaterThan(1);
  });

  test("break-before: page starts a new page at a boundary", async ({ page }) => {
    await loadFixture(page, "breaks", 800, 600);
    const result = await page.evaluate(() => {
      const h = window.__pager;
      const m = h.metrics();
      const flow = document.querySelector("iframe")!.contentDocument!.querySelector(".pager-flow")!;
      const sec2 = flow.querySelector("#sec2")!;
      const flowRect = flow.getBoundingClientRect();
      const left = sec2.getBoundingClientRect().left - flowRect.left;
      const offsetInPage = ((left % m.stride) + m.stride) % m.stride;
      return { offsetInPage, stride: m.stride };
    });
    // The forced-break section should begin flush with a page's left edge.
    expect(Math.min(result.offsetInPage, result.stride - result.offsetInPage)).toBeLessThan(3);
  });

  test("navigation clamps at both ends", async ({ page }) => {
    await loadFixture(page, "prose", 800, 600);
    const res = await page.evaluate(() => {
      const h = window.__pager;
      h.first();
      const atFirst = h.currentPage();
      h.prev();
      const belowFirst = h.currentPage();
      h.last();
      const atLast = h.currentPage();
      h.next();
      const aboveLast = h.currentPage();
      return { atFirst, belowFirst, atLast, aboveLast, count: h.pageCount() };
    });
    expect(res.atFirst).toBe(0);
    expect(res.belowFirst).toBe(0);
    expect(res.atLast).toBe(res.count - 1);
    expect(res.aboveLast).toBe(res.count - 1);
  });

  test("protocol schema guard accepts valid and rejects invalid messages", async ({ page }) => {
    await loadFixture(page, "prose", 800, 600);
    const res = await page.evaluate(() => window.__pager.checkProtocol());
    expect(res.valid).toBe(true);
    expect(res.invalidType).toBe(false);
    expect(res.wrongVersion).toBe(false);
  });
});
