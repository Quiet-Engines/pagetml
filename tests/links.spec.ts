import { test, expect, type Page } from "@playwright/test";
import { openApp } from "./helpers.js";

// Link routing (QE-1435, spec §3.4). Clicks happen INSIDE the sandboxed content
// frame; we reach them via frameLocator. Internal links must jump within the
// document (the chrome's page counter moves); external links must open in a new
// browser context and never navigate the frame.

const paper = '[data-testid="paper"]';

async function openLinks(page: Page): Promise<void> {
  await openApp(page);
  await page.locator("[data-doc=links]").click();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
}

test("internal link jumps to the page holding the anchor", async ({ page }) => {
  await openLinks(page);
  const counter = page.getByTestId("counter");

  await page.frameLocator(paper).locator("#to-target").click();

  // The reader moved off page 1 to the target's page (mid-document).
  await expect(counter).not.toHaveText(/^1 \//);
  const [cur, tot] = (await counter.textContent())!.split("/").map((s) => Number(s.trim()));
  expect(cur).toBeGreaterThan(1);
  expect(cur).toBeLessThanOrEqual(tot);
});

test("external link is handed to the chrome to open externally, not in the frame", async ({ page }) => {
  // Record window.open calls in the chrome instead of really opening a tab, so
  // the assertion is on the URL the chrome received over the message channel
  // (hermetic — no external network).
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });

  await openLinks(page);
  await page.frameLocator(paper).locator("#to-external").click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
    .toContainEqual("https://example.com/docs");

  // The frame did not navigate away — still in reading mode on a valid page.
  await expect(page.getByTestId("reading")).toBeVisible();
  await expect(page.getByTestId("counter")).toHaveText(/^\d+ \/ \d+$/);
});
