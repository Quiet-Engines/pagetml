import { test, expect } from "@playwright/test";

// End-to-end tests for the app chrome (QE-1432/1433/1430). These drive the real
// UI — start screen, reading-mode navigation — and assert on the page counter,
// which is only updated via `state` messages coming back from the engine inside
// the sandboxed content frame. So a green run also proves the postMessage
// contract (QE-1423) and the engine-in-frame architecture end to end.

test("start screen lists documents and opens one into reading mode", async ({ page }) => {
  await page.goto("/app/index.html");
  await expect(page.getByTestId("start")).toBeVisible();
  await expect(page.locator("[data-doc=prose]")).toBeVisible();

  await page.locator("[data-doc=prose]").click();

  await expect(page.getByTestId("reading")).toBeVisible();
  // Counter is "– / –" until the first state message arrives from the frame.
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  const total = Number((await page.getByTestId("counter").textContent())!.split("/")[1].trim());
  expect(total).toBeGreaterThan(1);
});

test("navigation (buttons + keyboard) turns pages via the message channel", async ({ page }) => {
  await page.goto("/app/index.html");
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
  await page.goto("/app/index.html");
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await page.goto("/app/index.html");
  await page.locator("[data-doc=prose]").click();
  await expect(page.getByTestId("reading")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page.getByTestId("start")).toBeVisible();
});
