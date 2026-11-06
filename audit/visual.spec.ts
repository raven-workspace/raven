import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { collectLayoutIssues } from "./checks/layout";
import { collectA11yIssues } from "./checks/a11y";
import { writeIssues } from "./report";
import { SCREENS, WIDTHS } from "./screens";

const SHOTS = fileURLToPath(new URL("../audit-output/shots/", import.meta.url));

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

for (const screen of SCREENS) {
  for (const width of WIDTHS) {
    test(`${screen.id}@${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install({ time: AUDIT_NOW });
      await page.goto(screen.path);
      await page.locator("body").waitFor();
      await screen.setup?.(page);
      await expect(page.locator(screen.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(collectLayoutIssues);
      const a11y = await collectA11yIssues(page);
      await writeIssues(screen.id, width, [...layout, ...a11y]);
      await page.screenshot({ path: `${SHOTS}${screen.id}@${width}.png`, fullPage: true, animations: "disabled" });
      expect(errors, "page errors").toEqual([]);
    });
  }
}
