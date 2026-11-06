import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
