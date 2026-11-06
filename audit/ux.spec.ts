import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { FLOWS, runFlow } from "./checks/flows";
import { collectStateIssues, type AuditState } from "./checks/states";
import { writeIssues } from "./report";
import { SCREENS } from "./screens";

const WIDTH = 1280;
const SHOTS = fileURLToPath(new URL("../audit-output/shots/", import.meta.url));
const SCENARIOS: AuditState[] = ["empty", "loading", "error"];
const STATE_SCREENS = SCREENS.filter((s) => s.path.startsWith("/e/") || s.path.startsWith("/arsenal"));

test.beforeAll(async () => { await mkdir(SHOTS, { recursive: true }); });

for (const flow of FLOWS) {
  test(`flow:${flow.id}`, async ({ page, context }) => {
    // Copying goes through the browser clipboard, which headless Chromium denies unless asked.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: WIDTH, height: 900 });
    await page.clock.install({ time: AUDIT_NOW });
    await page.goto(flow.path);
    await page.locator("body").waitFor();
    await expect(page.locator("main").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Keyboard shortcuts need focus on the page, not in a field; clicking the corner is not a counted action.
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await writeIssues(`flow:${flow.id}`, WIDTH, await runFlow(page, flow));
  });
}

for (const screen of STATE_SCREENS) {
  for (const scenario of SCENARIOS) {
    test(`${screen.id}~${scenario}`, async ({ page }) => {
      // A state can hide the controls a screen's setup needs; give up on it quickly and check what rendered.
      page.setDefaultTimeout(2000);
      await page.setViewportSize({ width: WIDTH, height: 900 });
      await page.clock.install({ time: AUDIT_NOW });
      await page.goto(`${screen.path}${screen.path.includes("?") ? "&" : "?"}audit=${scenario}`);
      await page.locator("body").waitFor();
      await screen.setup?.(page).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      const issues = await collectStateIssues(page, scenario);
      await writeIssues(`${screen.id}~${scenario}`, WIDTH, issues);
      await page.screenshot({ path: `${SHOTS}${screen.id}@${WIDTH}~${scenario}.png`, fullPage: true, animations: "disabled" });
    });
  }
}
