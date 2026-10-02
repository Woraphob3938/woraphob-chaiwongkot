import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the real stack: `next dev` on :3000 and the XAMPP
 * API on :80. Start Apache and MySQL in XAMPP first; the dev server is
 * started here, or reused when one is already running.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./output/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "output/playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
