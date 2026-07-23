import { type Page } from "@playwright/test";

// Shared across the spec files so the fixture list and load routine live in one
// place. The fixture list itself is the shared src/fixtures.ts, so app and tests
// can't drift.
export { FIXTURES } from "../src/fixtures.js";

// A few representative window sizes. Auto-fit means page counts differ across
// these; the invariants must hold at every size (spec §7).
export const VIEWPORTS = [
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 480, h: 720 },
] as const;

export async function loadFixture(page: Page, fixture: string, w = 800, h = 600): Promise<void> {
  await page.goto(`/harness/index.html?fixture=${fixture}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__pagetmlReady === true);
}

// --- app chrome helpers (tests/chrome.spec.ts) ---

// The chrome's recent-files localStorage key (mirrors RECENTS_KEY in chrome.ts,
// which is an entry module with side effects and so can't be imported here).
export const RECENTS_KEY = "pagetml.recents";

/** Seed the recent-files list before the app boots. */
export async function seedRecents(page: Page, names: unknown): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [RECENTS_KEY, JSON.stringify(names)] as const,
  );
}

/** Open the app chrome and wait for the start screen. */
export async function openApp(page: Page): Promise<void> {
  // The chrome's best-effort requestFullscreen actually succeeds on macOS
  // Chromium, leaving the OS window fullscreen — after which setViewportSize
  // refuses to resize. No test asserts OS fullscreen (presentation is a
  // logical state), so fail the request deterministically suite-wide.
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error("fullscreen disabled in tests"));
  });
  await page.goto("/app/index.html");
  await page.getByTestId("start").waitFor();
}
