import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { FLOWS, runFlow } from "./checks/flows";
import { collectLayoutIssues } from "./checks/layout";
import { collectOptOuts } from "./checks/optouts";
import { collectStateIssues, type AuditState } from "./checks/states";
import { collectUxIssues } from "./checks/ux";
import { writeIssues } from "./report";
import { openReportItem, reportChecks, SCREENS } from "./screens";
import { CHECK_IDS, gateFailures } from "./types";

const WIDTH = 1280;
const SHOTS = fileURLToPath(new URL("../audit-output/shots/", import.meta.url));
const SCENARIOS: AuditState[] = ["empty", "loading", "error"];
// A screen that already names its scenario (`?audit=`) is its own state run.
const STATE_SCREENS = SCREENS.filter((s) => /^\/(e|arsenal|manual)\b/.test(s.path) && !s.path.includes("audit="));

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
  "host-checklist", "host-findings", "host-log", "finding-split", "exam-host-locked", "findings", "log-images", "transfer-generator", "credentials-hash", "credentials-folded",
  // No host under `empty`, so OS is unknown and every payload fits: there is no misfit fold to open.
  "payloads-drawer-misfits",
  // The rail tip is a host's tooltip; with no hosts there is nothing to focus.
  "sidebar-rail-tip",
  // No import under `empty`: the Manual shows its empty state, with no note or link to open.
  "manual-tool", "manual-card-drawer",
  // No hosts under `empty`: the Report shows "No hosts yet", with no outline row, page or check to open.
  "report-details", "report-target", "report-ad", "report-appendix", "report-narrow",
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
      // The scenario goes in the query, before any #anchor.
      const [where, hash = ""] = screen.path.split("#");
      await page.goto(`${where}${where.includes("?") ? "&" : "?"}audit=${scenario}${hash ? `#${hash}` : ""}`);
      await page.locator("body").waitFor();
      const setup = screen.setup?.(page);
      if (scenario === "empty") await setup;
      else await setup?.catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      const issues = [
        ...(await collectStateIssues(page, scenario)),
        // The state screens obey the same conventions as the full ones.
        ...(await page.evaluate(collectLayoutIssues)),
        ...(await page.evaluate(collectUxIssues)),
        ...(await page.evaluate(collectOptOuts, CHECK_IDS)),
      ];
      await writeIssues(`${screen.id}~${scenario}`, WIDTH, issues);
      await page.screenshot({ path: `${SHOTS}${screen.id}@${WIDTH}~${scenario}.png`, fullPage: true, animations: "disabled" });
      expect(errors, "page errors").toEqual([]);
      expect(gateFailures(issues), "convention breaks").toEqual([]);
    });
  }
}

// The Report on the mock exam, as the owner uses it.
test("report: ms01's proof passes its checks", async ({ page }) => {
  await page.setViewportSize({ width: WIDTH, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/s/report");
  await openReportItem("ms01")(page);
  await page.locator(".report-page .report-code").first().waitFor();
  const checks = await reportChecks(page);
  await expect(checks).toBeVisible();
  // ipconfig with 10.10.30.5, whoami, hostname, type from the Desktop, a screenshot: no proof check is left.
  await expect(checks.getByText(/proof/i)).toHaveCount(0);
  await expect(checks.getByText(/No (local|proof)\.txt/)).toHaveCount(0);
});

test("report: an OSID that is not OS- and digits turns the file name amber", async ({ page }) => {
  await page.setViewportSize({ width: WIDTH, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/s/report");
  const strip = page.getByRole("group", { name: "Report status" });
  const name = strip.getByText(/^OSCP-OS-.*-Exam-Report\.pdf$/);
  await expect(name).toHaveText("OSCP-OS-48213-Exam-Report.pdf");
  const amber = () => name.evaluate((el) => getComputedStyle(el).color);
  const before = await amber();
  await openReportItem("Report details")(page);
  const osid = page.getByLabel("OSID");
  await osid.fill("os-1");
  await osid.blur();
  await expect(name).toHaveText("OSCP-OS-?????-Exam-Report.pdf");
  // The warn tone: #e0a030.
  await expect.poll(amber).toBe("rgb(224, 160, 48)");
  expect(before).not.toBe("rgb(224, 160, 48)");
});
