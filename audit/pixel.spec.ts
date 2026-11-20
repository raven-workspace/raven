import { test, expect } from "@playwright/test";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { SCREENS, widthsOf } from "./screens";

/*
 * Pixel diff for style migrations: every audit screen at every width, compared with a baseline taken before the change.
 * `npm run audit:baseline` writes the baseline (audit-output/baseline, gitignored; run it on the commit you compare
 * against), `npm run audit:pixel` compares. The viewport stays 900 high: Raven scrolls inside its panes, and growing the
 * window (as visual.spec does) would make the shot depend on how much content scrolls.
 */
for (const screen of SCREENS) {
  for (const width of widthsOf(screen)) {
    test(`${screen.id}@${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install({ time: AUDIT_NOW });
      await page.goto(screen.path);
      await page.locator("body").waitFor();
      await screen.setup?.(page);
      await expect(page.locator(screen.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // Some screens (the payloads workbench) show their ready element a beat before the content around it renders,
      // and a blank frame is "stable" too: settle before comparing.
      await page.waitForTimeout(300);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      await expect(page).toHaveScreenshot(`${screen.id}@${width}.png`, { animations: "disabled", caret: "hide" });
    });
  }
}
