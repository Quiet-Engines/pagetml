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
      event: {
        // Store handlers so a test can dispatch shell events (e.g. fullscreen).
        listen: (name: string, handler: (e: { payload: unknown }) => void) => {
          (window as unknown as { __handlers: Record<string, unknown> }).__handlers ??= {};
          (window as unknown as { __handlers: Record<string, unknown> }).__handlers[name] = handler;
          return Promise.resolve(() => {});
        },
      },
    };
  }, recents);
}

/** Dispatch a mocked shell event to the chrome's listener. */
async function emit(page: import("@playwright/test").Page, name: string, payload: unknown) {
  await page.evaluate(
    ([n, p]) => {
      const h = (window as unknown as { __handlers: Record<string, (e: { payload: unknown }) => void> }).__handlers?.[
        n as string
      ];
      h?.({ payload: p });
    },
    [name, payload] as const,
  );
}

/** Open a document via the file input so reading mode is reachable in a browser
 *  (the native pagetml:// path can't load here). */
async function openReadingMode(page: import("@playwright/test").Page) {
  await page.getByTestId("start").waitFor();
  await page.locator("[data-testid=file-input]").setInputFiles({
    name: "doc.html",
    mimeType: "text/html",
    buffer: Buffer.from("<h1>Doc</h1>" + "<p>para</p>".repeat(40)),
  });
  await expect(page.getByTestId("counter")).toHaveText(/^1 \/ \d+$/);
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

test("presentation uses native fullscreen and re-locks when it enters (QE-1446)", async ({ page }) => {
  await mockTauri(page, []);
  await page.goto("/app/index.html");
  await openReadingMode(page);

  await page.getByTestId("present").click();
  await expect(page.getByTestId("chip")).toHaveText("Presenting");
  // Native mode enters real fullscreen via the shell, not element fullscreen.
  expect((await invokes(page)).some((c) => c.cmd === "set_native_fullscreen" && (c.args as { on: boolean }).on === true)).toBe(true);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();

  // A transient fullscreen-changed(false) before fullscreen actually enters must
  // NOT drop presentation (enter-animation race guard).
  await emit(page, "fullscreen-changed", false);
  await expect(page.getByTestId("chip")).toHaveText("Presenting");

  // Fullscreen entered → still presenting (and the engine is re-locked).
  await emit(page, "fullscreen-changed", true);
  await expect(page.getByTestId("chip")).toHaveText("Presenting");
});

test("macOS leaving fullscreen drops presentation (display disconnect / Esc) (QE-1446)", async ({ page }) => {
  await mockTauri(page, []);
  await page.goto("/app/index.html");
  await openReadingMode(page);

  await page.getByTestId("present").click();
  await emit(page, "fullscreen-changed", true); // enter fullscreen
  await expect(page.getByTestId("chip")).toHaveText("Presenting");

  // macOS leaves fullscreen (Esc, green button, or presenting display gone).
  await emit(page, "fullscreen-changed", false);
  await expect(page.getByTestId("chip")).toHaveText("Reading");
  // The chrome also asks the shell to leave fullscreen.
  expect((await invokes(page)).some((c) => c.cmd === "set_native_fullscreen" && (c.args as { on: boolean }).on === false)).toBe(true);
});
