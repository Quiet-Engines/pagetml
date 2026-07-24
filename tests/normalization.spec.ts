import { test, expect } from "@playwright/test";
import { loadFixture } from "./helpers.js";

// Regression tests for the two normalization gaps found in review:
//  - QE-1422: scroll-trap detection must work at any depth and by measurement
//    (the old string checks against `100vh`/`100%` were dead), and must re-run
//    on reflow.
//  - QE-1421: fixed/sticky converted to absolute must keep their static
//    position (insets neutralized) rather than pinning to the origin.

test("nested scroll-shell (grandchild of body) is unwrapped into multiple pages", async ({ page }) => {
  // The old one-level-deep scan missed this; it would collapse to a single page.
  await loadFixture(page, "scroll-shell-nested", 800, 600);
  const res = await page.evaluate(() => ({
    pageCount: window.__pagetml.pageCount(),
    overflow: window.__pagetml.computedStyle("#app", "overflow-y"),
  }));
  expect(res.pageCount).toBeGreaterThan(1);
  expect(res.overflow).toBe("visible");
});

test("mid-document sticky keeps its page instead of pinning to the origin", async ({ page }) => {
  await loadFixture(page, "sticky-midflow", 800, 600);
  const res = await page.evaluate(() => ({
    stickyPage: window.__pagetml.pageOf("#midsticky"),
    position: window.__pagetml.computedStyle("#midsticky", "position"),
    pageCount: window.__pagetml.pageCount(),
  }));
  // Converted off sticky (which is inconsistent inside columns) to static —
  // in-flow, so it fragments normally on every engine (absolute is not an
  // option: WebKit resolves an abspos static position against column 1).
  expect(res.position).toBe("static");
  // ...and, staying in flow, it sits on a later page with its content rather
  // than being pinned to the origin (page 0). (We assert on the
  // resulting page, not the computed `top`, since getComputedStyle resolves
  // `top:auto` on an absolute box to its used px value, not the string "auto".)
  expect(res.pageCount).toBeGreaterThan(1);
  expect(res.stickyPage).toBeGreaterThan(0);
});

test("sticky inside a preserved scroller keeps pinning", async ({ page }) => {
  await loadFixture(page, "prose", 800, 600);
  const res = await page.evaluate(() => {
    const h = window.__pagetml;
    h.injectStickyScroller();
    return {
      overflow: h.computedStyle("#small-scroller", "overflow-y"),
      position: h.computedStyle("#scroller-sticky", "position"),
    };
  });
  // The small scroller is below the trap threshold, so it is preserved...
  expect(res.overflow).toBe("auto");
  // ...and its sticky header must NOT be flattened — sticky works in a live
  // scroller; only sticky in the paginated flow is normalized.
  expect(res.position).toBe("sticky");
});

test("script-injected scroll trap is normalized on reflow, not just at setup", async ({ page }) => {
  await loadFixture(page, "prose", 800, 600);
  const res = await page.evaluate(() => {
    const h = window.__pagetml;
    const before = h.pageCount();
    h.injectScrollTrap(); // adds a 100vh overflow:auto shell after load, then reflows
    return {
      before,
      after: h.pageCount(),
      overflow: h.computedStyle("#injected-shell", "overflow-y"),
    };
  });
  // The injected shell was detected + neutralized on the reflow pass...
  expect(res.overflow).toBe("visible");
  // ...so its content added pages instead of collapsing behind an inner scroll.
  expect(res.after).toBeGreaterThan(res.before);
});
