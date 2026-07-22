import { test, expect } from "@playwright/test";
import { openApp } from "./helpers.js";

// Opening a local file via the picker / drag-and-drop (QE-1428, browser-doable
// entry points). The chrome reads the file and hands its HTML to the content
// frame over the `loadDocument` message; the engine paginates it. (OS file
// association and the CLI argument are native/Tauri.)

test("opening a picked HTML file paginates it in reading mode", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 820 });
  await openApp(page);

  // A real .html file on disk (the picker/drop path reads the File's text and
  // hands it to the content frame via loadDocument).
  await page.locator("[data-testid=file-input]").setInputFiles("public/fixtures/prose.html");

  await expect(page.getByTestId("reading")).toBeVisible();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  const total = Number((await page.getByTestId("counter").textContent())!.split("/")[1].trim());
  expect(total).toBeGreaterThan(1);

  // The opened document navigates like any other.
  await page.getByTestId("next").click();
  await expect(page.getByTestId("counter")).toHaveText(/^2 \//);
});
