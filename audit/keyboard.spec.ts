import { test, expect } from "@playwright/test";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { checkShortcut, SHORTCUTS, tabWalk } from "./checks/keyboard";
import { writeIssues } from "./report";
import { SCREENS } from "./screens";

const WIDTH = 1280;
// Host and checklist screens have hundreds of tab stops; the default would call a long page a trap.
const MAX_STOPS = 1500;

for (const screen of SCREENS) {
  test(`${screen.id}:kbd`, async ({ page }) => {
    await page.setViewportSize({ width: WIDTH, height: 900 });
    await page.clock.install({ time: AUDIT_NOW });
    await page.goto(screen.path);
    await page.locator("body").waitFor();
    await screen.setup?.(page);
    await expect(page.locator(screen.ready).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await writeIssues(`${screen.id}:kbd`, WIDTH, await tabWalk(page, { maxStops: MAX_STOPS }));
  });
}

for (const shortcut of SHORTCUTS) {
  test(`shortcut:${shortcut.id}`, async ({ page }) => {
    const ready = SCREENS.find((s) => s.path === shortcut.path)?.ready;
    expect(ready, `a SCREENS entry for ${shortcut.path}`).toBeDefined();
    await page.setViewportSize({ width: WIDTH, height: 900 });
    await page.clock.install({ time: AUDIT_NOW });
    await page.goto(shortcut.path);
    await page.locator("body").waitFor();
    await expect(page.locator(ready!).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await writeIssues(`shortcut:${shortcut.id}`, WIDTH, await checkShortcut(page, shortcut));
  });
}
