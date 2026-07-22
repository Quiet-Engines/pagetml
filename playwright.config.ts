import { defineConfig, devices } from "@playwright/test";

// Chromium stands in for WebView2 (the reference engine); WebKit stands in for
// WKWebView. M1's whole thesis is that the multicol technique behaves
// equivalently on both, so the invariant suite runs on each. If WebKit is not
// installed in this environment, run `npm run test:chromium` for the subset.
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5179",
    trace: "off",
  },
  webServer: {
    command: "npx vite --port 5179",
    url: "http://localhost:5179/harness/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
