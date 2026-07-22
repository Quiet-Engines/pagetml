import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";

// Per-file position persistence (QE-1434, spec §3.2). The position is stored as
// a content anchor, so it survives repagination; here we verify the round-trip
// through the chrome (localStorage stands in for the native store).

test("reopening a document restores the last position", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 860 });
  await openApp(page);
  await page.locator("[data-doc=prose]").click();
  const counter = page.getByTestId("counter");
  await expect(counter).toHaveText(/^1 \/ \d+$/);
  const total = Number((await counter.textContent())!.split("/")[1].trim());
  expect(total).toBeGreaterThanOrEqual(3);

  // Read forward to page 3.
  await page.getByTestId("next").click();
  await expect(counter).toHaveText(/^2 \//);
  await page.getByTestId("next").click();
  await expect(counter).toHaveText(/^3 \//);

  // Leave and reopen the same document — position is restored (not page 1).
  await page.getByTestId("back").click();
  await page.locator("[data-doc=prose]").click();
  await expect(counter).not.toHaveText(/^1 \//, { timeout: 3000 });
  await expect(counter).toHaveText(/^3 \//);

  // A different document opens fresh at page 1.
  await page.getByTestId("back").click();
  await page.locator("[data-doc=breaks]").click();
  await expect(counter).toHaveText(/^1 \//);
});
