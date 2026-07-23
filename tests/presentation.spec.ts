import { test, expect, type Page } from "@playwright/test";
import { openApp } from "./helpers.js";

// Presentation mode (M3, spec §3.3). Fullscreen is best-effort (and flaky
// headless), so the chrome enters presentation as a logical state — locked
// engine + presentation UI — whether or not the browser grants fullscreen.
// These tests assert that logical behavior.

async function present(page: Page, fixture = "prose"): Promise<void> {
  // On macOS Chromium the chrome's best-effort requestFullscreen actually
  // succeeds, putting the OS window in fullscreen — after which
  // setViewportSize refuses to resize. Make the request fail deterministically
  // everywhere: these tests assert the logical presentation state, not OS
  // fullscreen.
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error("fullscreen disabled in tests"));
  });
  await openApp(page);
  await page.locator(`[data-doc=${fixture}]`).click();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  await page.getByTestId("present").click();
  await expect(page.getByTestId("chip")).toHaveText("Presenting");
}

test("enter and exit presentation mode", async ({ page }) => {
  await present(page);
  await expect(page.getByTestId("reading")).toHaveClass(/presenting/);
  // HUD toast appears on entry.
  await expect(page.getByTestId("hud")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chip")).toHaveText("Reading");
  await expect(page.getByTestId("reading")).not.toHaveClass(/presenting/);
});

test("black screen toggles and any key returns", async ({ page }) => {
  await present(page);
  await expect(page.getByTestId("blackout")).toBeHidden();

  await page.keyboard.press("b");
  await expect(page.getByTestId("blackout")).toBeVisible();
  await expect(page.getByTestId("blackout")).toHaveClass(/black/);

  // Any navigation key returns from black.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("blackout")).toBeHidden();

  // White screen too.
  await page.keyboard.press("w");
  await expect(page.getByTestId("blackout")).toBeVisible();
  await expect(page.getByTestId("blackout")).toHaveClass(/white/);
});

test("type a page number then Enter jumps to that page", async ({ page }) => {
  // Narrow viewport so the document is comfortably multi-page even at the
  // full-window presentation size.
  await page.setViewportSize({ width: 600, height: 860 });
  await present(page, "prose");
  const counter = page.getByTestId("counter");
  await page.waitForTimeout(200); // let the lock repagination settle
  const total = Number((await counter.textContent())!.split("/")[1].trim());
  expect(total).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("2");
  await expect(page.getByTestId("jump")).toHaveText("2");
  await page.keyboard.press("Enter");
  await expect(counter).toHaveText(/^2 \//);
  await expect(page.getByTestId("jump")).toBeHidden();
});

test("locking freezes the page count against resize", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 780 });
  await present(page);
  const counter = page.getByTestId("counter");
  // Let the lock's one-time repagination at this size settle before sampling.
  await page.waitForTimeout(200);
  const before = (await counter.textContent())!.split("/")[1].trim();

  // In reading mode this resize would repaginate; while locked the total holds.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(300);
  const after = (await counter.textContent())!.split("/")[1].trim();
  expect(after).toBe(before);
});

test("cursor auto-hides after inactivity and returns on movement", async ({ page }) => {
  await present(page);
  const reading = page.getByTestId("reading");
  await expect(reading).not.toHaveClass(/cursor-hidden/);
  // Hides after 2s of no movement.
  await expect(reading).toHaveClass(/cursor-hidden/, { timeout: 3000 });
  // Returns on movement.
  await page.mouse.move(400, 300);
  await expect(reading).not.toHaveClass(/cursor-hidden/);
});

test("content growth while locked raises the overflow indicator", async ({ page }) => {
  await present(page);
  await expect(page.getByTestId("overflow-flag")).toBeHidden();

  // Grow the (locked) document well past its frozen boundaries.
  const frame = page.frames().find((f) => f.url().includes("/app/content.html"))!;
  await frame.evaluate(() => {
    const flow = document.querySelector(".pagetml-flow")!;
    for (let i = 0; i < 40; i++) {
      const p = document.createElement("p");
      p.textContent = `Injected overflow content block ${i}. `.repeat(30);
      flow.appendChild(p);
    }
  });

  await expect(page.getByTestId("overflow-flag")).toBeVisible({ timeout: 6000 });
});
