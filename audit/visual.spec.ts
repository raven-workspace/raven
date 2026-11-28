import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { collectLayoutIssues } from "./checks/layout";
import { collectA11yIssues } from "./checks/a11y";
import { collectOptOuts } from "./checks/optouts";
import { collectUxIssues } from "./checks/ux";
import { writeIssues } from "./report";
import { VISUAL_SCREENS, widthsOf } from "./screens";
import { CHECK_IDS, gateFailures } from "./types";

const SHOTS = fileURLToPath(new URL("../audit-output/shots/", import.meta.url));

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

for (const screen of VISUAL_SCREENS) {
  for (const width of widthsOf(screen)) {
    test(`${screen.id}@${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install({ time: screen.time ?? AUDIT_NOW });
      // `AUDIT_OS=linux`: the app reads a Linux platform, so every shortcut shows (and is bound to) its Linux key.
      if (process.env.AUDIT_OS === "linux") await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "Linux x86_64" }));
      await page.goto(screen.path);
      await page.locator("body").waitFor();
      await screen.setup?.(page);
      await expect(page.locator(screen.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(collectLayoutIssues);
      const a11y = await collectA11yIssues(page);
      const ux = await page.evaluate(collectUxIssues);
      const issues = [...layout, ...a11y, ...ux, ...(await page.evaluate(collectOptOuts, CHECK_IDS))];
      await writeIssues(screen.id, width, issues);
      // Raven scrolls inside its own containers: grow the viewport so the shot shows the below-fold content.
      const overflow = await page.evaluate(() => {
        let max = document.documentElement.scrollHeight - window.innerHeight;
        for (const el of document.querySelectorAll("*")) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === "auto" || oy === "scroll") max = Math.max(max, el.scrollHeight - el.clientHeight);
        }
        return Math.max(0, max);
      });
      await page.setViewportSize({ width, height: Math.min(6000, 900 + overflow) });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      await page.screenshot({ path: `${SHOTS}${screen.id}@${width}.png`, fullPage: true, animations: "disabled" });
      expect(errors, "page errors").toEqual([]);
      // Convention breaks fail the run (after the shot, so the report can show them).
      expect(gateFailures(issues), "convention breaks").toEqual([]);
    });
  }
}
