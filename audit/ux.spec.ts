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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    expect(errors, "page errors").toEqual([]);
  });
}

// Under `empty` these screens' setups act on fixture rows or a host (a tab, a finding, a log entry, a host option) that
// the scenario removes by definition, so there is nothing to set up. Skipped explicitly, not swallowed.
const NEEDS_DATA = new Set([
  "host-checklist", "host-findings", "host-log", "finding-split", "exam-host-locked", "findings", "log-images", "transfer-generator",
]);

for (const screen of STATE_SCREENS) {
  for (const scenario of SCENARIOS) {
    test(`${screen.id}~${scenario}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      test.skip(scenario === "empty" && NEEDS_DATA.has(screen.id), "setup needs fixture data, which this scenario removes");
      // While loading or failing, a screen's setup may legitimately not find its controls: give up quickly and check what rendered.
      // With data (empty), a failing setup is a real error.
      page.setDefaultTimeout(2000);
      await page.setViewportSize({ width: WIDTH, height: 900 });
      await page.clock.install({ time: AUDIT_NOW });
      await page.goto(`${screen.path}${screen.path.includes("?") ? "&" : "?"}audit=${scenario}`);
      await page.locator("body").waitFor();
      const setup = screen.setup?.(page);
      if (scenario === "empty") await setup;
      else await setup?.catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      const issues = await collectStateIssues(page, scenario);
      await writeIssues(`${screen.id}~${scenario}`, WIDTH, issues);
      await page.screenshot({ path: `${SHOTS}${screen.id}@${WIDTH}~${scenario}.png`, fullPage: true, animations: "disabled" });
      expect(errors, "page errors").toEqual([]);
    });
  }
}
