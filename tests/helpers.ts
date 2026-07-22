import { type Page } from "@playwright/test";

// Shared across the spec files so the fixture list and load routine live in one
// place (the fixture set otherwise had to be kept in sync across three files).

export const FIXTURES = [
  "prose",
  "breaks",
  "tall-media",
  "fixed-sticky",
  "scroll-shell",
  "tables-code",
  "gdocs-export",
] as const;

// A few representative window sizes. Auto-fit means page counts differ across
// these; the invariants must hold at every size (spec §7).
export const VIEWPORTS = [
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 480, h: 720 },
] as const;

export async function loadFixture(page: Page, fixture: string, w = 800, h = 600): Promise<void> {
  await page.goto(`/harness/index.html?fixture=${fixture}&w=${w}&h=${h}`);
  await page.waitForFunction(() => window.__pagerReady === true);
}
