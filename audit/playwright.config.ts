import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  // The pixel diff runs only on its own (npm run audit:baseline / audit:pixel): it needs a baseline to compare against.
  testIgnore: process.env.AUDIT_PIXEL ? [] : ["pixel.spec.ts"],
  snapshotPathTemplate: "../audit-output/baseline/{arg}{ext}",
  // The payloads workbench renders a frame or two differently from run to run with no change; a real regression fails
  // every attempt, so pixel runs retry.
  retries: process.env.AUDIT_PIXEL ? 2 : 0,
  outputDir: "../test-results",
  reporter: [["list"]],
  fullyParallel: true,
  globalSetup: "./setup.ts",
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
