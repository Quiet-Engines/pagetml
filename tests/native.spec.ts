import { test, expect } from "@playwright/test";

// The chrome's native (Tauri shell) branch is normally inert in a browser
// because `window.__TAURI__` is absent. These tests mock that global so the
// native code paths run headlessly — the shell itself is covered separately by
// the Rust unit tests and the driven smoke (test:shell / test:native), but the
// chrome-side native branch had no coverage, which let a real recents bug ship.

/** Install a minimal __TAURI__ that records invokes and lets `recent_names`
 *  return a fixed list. Must run before the page's scripts. */
async function mockTauri(page: import("@playwright/test").Page, recents: string[]) {
  await page.addInitScript((names) => {
    (window as unknown as { __calls: Array<{ cmd: string; args: unknown }> }).__calls = [];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: unknown) => {
          (window as unknown as { __calls: Array<{ cmd: string; args: unknown }> }).__calls.push({ cmd, args });
          if (cmd === "recent_names") return Promise.resolve(names);
          return Promise.resolve(undefined);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
  }, recents);
}

const invokes = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __calls: Array<{ cmd: string; args: unknown }> }).__calls ?? []);

test("native start screen renders shell-provided recents", async ({ page }) => {
  await mockTauri(page, ["report.html", "notes.htm"]);
  await page.goto("/app/index.html");
  await page.getByTestId("start").waitFor();

  const buttons = page.locator(".recent-list [data-doc]");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.locator(".name")).toHaveText(["report.html", "notes.html"]);
  // The recents came from the shell, not localStorage.
  expect((await invokes(page)).some((c) => c.cmd === "recent_names")).toBe(true);
});

test("clicking a native recent asks the shell to reopen it by index", async ({ page }) => {
  await mockTauri(page, ["report.html", "notes.htm"]);
  await page.goto("/app/index.html");
  await page.getByTestId("start").waitFor();

  await page.locator(".recent-list [data-doc]").nth(1).click();
  const openRecent = (await invokes(page)).find((c) => c.cmd === "open_recent");
  expect(openRecent).toBeTruthy();
  expect(openRecent!.args).toEqual({ index: 1 });
});
