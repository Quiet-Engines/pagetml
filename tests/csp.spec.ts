import { test, expect, type Frame, type Page } from "@playwright/test";
import { openApp } from "./helpers.js";

// Content-frame CSP + per-file "allow remote resources" toggle (QE-1431, spec
// §4.4). Assertions use securitypolicyviolation events, so they test the CSP
// decision itself, independent of whether the network would have succeeded.

const CONTENT = "/app/content.html";

function contentFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => f.url().includes(CONTENT));
}

/** Inject a remote (https) image into the content frame and report whether CSP
 *  blocked it (an img-src securitypolicyviolation fired). */
async function remoteImageBlocked(frame: Frame): Promise<boolean> {
  return frame.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const onViolation = (e: SecurityPolicyViolationEvent) => {
          if (e.violatedDirective.startsWith("img-src")) resolve(true);
        };
        document.addEventListener("securitypolicyviolation", onViolation);
        const img = document.createElement("img");
        img.src = `https://example.com/pixel-${Math.round(performance.now())}.png`;
        document.body.appendChild(img);
        setTimeout(() => resolve(false), 1200);
      }),
  );
}

async function openDoc(page: Page, fixture: string): Promise<void> {
  await openApp(page);
  await page.locator(`[data-doc=${fixture}]`).click();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
}

test("remote resources are blocked by default", async ({ page }) => {
  await openDoc(page, "prose");
  await expect(page.getByTestId("remote-toggle")).toHaveText("Remote off");
  const frame = contentFrame(page)!;
  expect(await remoteImageBlocked(frame)).toBe(true);
});

test("the per-file toggle allows remote resources", async ({ page }) => {
  await openDoc(page, "prose");
  await page.getByTestId("remote-toggle").click();

  // The frame reloads under the relaxed CSP.
  await expect.poll(() => contentFrame(page)?.url() ?? "").toContain("remote=1");
  const frame = contentFrame(page)!;
  await frame.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("remote-toggle")).toHaveText("Remote on");

  expect(await remoteImageBlocked(frame)).toBe(false);
});

test("the toggle is remembered per file", async ({ page }) => {
  await openDoc(page, "prose");
  await page.getByTestId("remote-toggle").click();
  await expect.poll(() => contentFrame(page)?.url() ?? "").toContain("remote=1");

  // Leave and reopen the same document — the setting persists.
  await page.getByTestId("back").click();
  await page.locator("[data-doc=prose]").click();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  await expect(page.getByTestId("remote-toggle")).toHaveText("Remote on");
  await expect(page.getByTestId("remote-toggle")).toHaveAttribute("aria-pressed", "true");

  // A different document is unaffected (off by default).
  await page.getByTestId("back").click();
  await page.locator("[data-doc=breaks]").click();
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
  await expect(page.getByTestId("remote-toggle")).toHaveText("Remote off");
});
