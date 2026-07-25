import { test, expect } from "@playwright/test";
import { openApp, seedRecents } from "./helpers.js";

// End-to-end tests for the app chrome (QE-1432/1433/1430). These drive the real
// UI — start screen, reading-mode navigation — and assert on the page counter,
// which is only updated via `state` messages coming back from the engine inside
// the sandboxed content frame. So a green run also proves the postMessage
// contract (QE-1423) and the engine-in-frame architecture end to end.

test("start screen lists documents and opens one into reading mode", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("[data-doc=prose]")).toBeVisible();

  await page.locator("[data-doc=prose]").click();

  await expect(page.getByTestId("reading")).toBeVisible();
  // Counter is "– / –" until the first state message arrives from the frame.
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  const total = Number((await page.getByTestId("counter").textContent())!.split("/")[1].trim());
  expect(total).toBeGreaterThan(1);
});

test("navigation (buttons + keyboard) turns pages via the message channel", async ({ page }) => {
  await openApp(page);
  await page.locator("[data-doc=prose]").click();
  const counter = page.getByTestId("counter");
  await expect(counter).toHaveText(/^1 \//);

  // At page 1, prev is disabled.
  await expect(page.getByTestId("prev")).toBeDisabled();

  await page.getByTestId("next").click();
  await expect(counter).toHaveText(/^2 \//);
  await expect(page.getByTestId("prev")).toBeEnabled();

  await page.keyboard.press("ArrowRight");
  await expect(counter).toHaveText(/^3 \//);

  await page.keyboard.press("ArrowLeft");
  await expect(counter).toHaveText(/^2 \//);

  // End jumps to the last page and disables next.
  await page.keyboard.press("End");
  const total = Number((await counter.textContent())!.split("/")[1].trim());
  await expect(counter).toHaveText(new RegExp(`^${total} / ${total}$`));
  await expect(page.getByTestId("next")).toBeDisabled();
});

test("resizing the window repaginates and keeps a valid position", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page);
  await page.locator("[data-doc=gdocs-export]").click();
  const counter = page.getByTestId("counter");
  await expect(counter).toHaveText(/^1 \/ \d+$/);

  await page.getByTestId("next").click();
  await expect(counter).toHaveText(/^2 \/ \d+$/);

  // Shrink: the total page count may change (auto-fit) but the reader stays on a
  // valid page — the current page never exceeds the (possibly new) total.
  await page.setViewportSize({ width: 620, height: 820 });
  await expect(counter).toHaveText(/^\d+ \/ \d+$/);
  const [cur, tot] = (await counter.textContent())!.split("/").map((s) => Number(s.trim()));
  expect(cur).toBeGreaterThanOrEqual(1);
  expect(cur).toBeLessThanOrEqual(tot);
});

test("back returns to the start screen", async ({ page }) => {
  await openApp(page);
  await page.locator("[data-doc=prose]").click();
  await expect(page.getByTestId("reading")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page.getByTestId("start")).toBeVisible();
});

test("document names render as text, not HTML (no injection into the chrome)", async ({ page }) => {
  // A recent whose name contains markup must not execute or create elements.
  await seedRecents(page, ['<img src=x onerror="window.__xss=1">evil']);
  await openApp(page);

  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator(".recent-list img").count()).toBe(0);
  // The name is present as literal text on a real button.
  await expect(page.locator(".recent-list")).toContainText("<img");
  expect(await page.locator(".recent-list button.recent").count()).toBeGreaterThan(0);
});

test("corrupt recents storage does not break the start screen", async ({ page }) => {
  await seedRecents(page, "not-an-array");
  await openApp(page);
  await expect(page.locator("[data-doc=prose]")).toBeVisible();
});

test("chrome ignores spoofed messages not from the content frame", async ({ page }) => {
  await openApp(page);
  await page.locator("[data-doc=prose]").click();
  const counter = page.getByTestId("counter");
  await expect(counter).toHaveText(/^1 \/ \d+$/);
  const before = (await counter.textContent())!;

  // Post a fake state from the chrome window itself — ev.source is this window,
  // not the content iframe, so the transport must reject it.
  await page.evaluate(() =>
    window.postMessage({ v: 1, type: "state", state: { pageCount: 9999, currentPage: 500, locked: false } }, "*"),
  );
  await page.waitForTimeout(120);
  await expect(counter).toHaveText(before); // unchanged
});

test("two-finger swipe over the document turns pages (QE-1445)", async ({ page }) => {
  await openApp(page);
  await page.locator("[data-doc=prose]").click();
  const counter = page.getByTestId("counter");
  await expect(counter).toHaveText(/^1 \//);

  const frame = page.frames().find((f) => f.url().includes("/app/content.html"))!;
  // A cross-origin iframe swallows wheel events; the content forwards them so
  // the chrome turns pages. Horizontal swipe (deltaX) = the trackpad case.
  // A discrete swipe: one wheel event past the deadzone, then wait past the
  // burst-coalescing window so the next swipe is a separate turn.
  const swipe = async (dx: number) => {
    await frame.evaluate((d) => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaX: d, bubbles: true, cancelable: true }));
    }, dx);
    await page.waitForTimeout(300);
  };

  await swipe(120); // swipe forward
  await expect(counter).toHaveText(/^2 \//);

  await swipe(120);
  await expect(counter).toHaveText(/^3 \//);

  await swipe(-120); // swipe back
  await expect(counter).toHaveText(/^2 \//);

  // Below the deadzone → no turn.
  await swipe(10);
  await expect(counter).toHaveText(/^2 \//);
});
