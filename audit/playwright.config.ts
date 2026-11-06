import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  reporter: [["list"]],
  fullyParallel: true,
  globalTeardown: "./report.ts",
  webServer: { command: "npm run dev:audit", url: "http://localhost:5199", reuseExistingServer: false },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5199",
    headless: true,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
