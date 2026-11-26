import { expect, test, type Page } from "@playwright/test";
import { AUDIT_NOW } from "../src/audit/fixtures";
import { openReportItem, reportChecks, reportTab } from "./screens";

// The report's tab row: its keyboard, focus and layout (RAV-17). Hard regressions: these fail the run.

/** The Report at the owner's window, 1400 wide with the sidebar open, on `item`'s page. */
async function openReport(page: Page, item: string) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/s/report");
  await openReportItem(item)(page);
  await page.locator(".report-page .ProseMirror > *").first().waitFor();
}

const tabRow = (page: Page) => page.getByRole("tablist", { name: "Report pages" });
const titleField = (page: Page) => page.getByRole("textbox", { name: "Page title" });

/** Renames the open free page from its focused tab (F2), typing `title` and ↵. */
async function rename(page: Page, from: string, title: string) {
  await reportTab(page, from).focus();
  await page.keyboard.press("F2");
  await titleField(page).fill(title);
  await page.keyboard.press("Enter");
  await expect(reportTab(page, title)).toBeFocused();
}

/** Each tab's left edge, by its label. */
const lefts = (page: Page) =>
  tabRow(page)
    .getByRole("tab")
    .evaluateAll((tabs) => tabs.map((t) => [t.querySelector("[data-tab-label]")?.textContent ?? "", Math.round(t.getBoundingClientRect().left)] as const));

test("Report: renaming a page's tab keeps the row still, the title field as wide as the tab (at least 12rem), with the focus ring", async ({ page }) => {
  await openReport(page, "Tools and versions");
  // A title wider than 12rem: the field takes the tab's width, and no other tab moves.
  const long = "Tools, versions and every flag each run took";
  await rename(page, "Tools and versions", long);
  const tab = reportTab(page, long);
  const before = await lefts(page);
  const width = (await tab.boundingBox())!.width;
  expect(width).toBeGreaterThan(192);
  await page.keyboard.press("F2");
  const field = titleField(page);
  await expect(field).toBeFocused();
  expect(Math.round((await field.boundingBox())!.width)).toBe(Math.round(width));
  // The field sits on the tab's place, outside the tablist; every tab stays where it was.
  expect(Math.round((await field.boundingBox())!.x)).toBe(before.find(([l]) => l?.endsWith(long))![1]);
  expect((await lefts(page)).filter(([l]) => !l?.endsWith(long))).toEqual(before.filter(([l]) => !l?.endsWith(long)));
  // The app's focus ring: a 2px solid outline, not a border colour alone.
  const ring = await field.evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
  expect(ring).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("Escape");
  await expect(tab).toBeFocused();

  // A title narrower than 12rem: the field is 12rem wide.
  await rename(page, long, "Tools");
  await page.keyboard.press("F2");
  expect(Math.round((await titleField(page).boundingBox())!.width)).toBe(192);
});

test("Report: after a check is picked, Esc closes To do and focus stays in the page, in WebKit too", async ({ page, playwright, baseURL }) => {
  const run = async (p: Page) => {
    await openReport(p, "AD set");
    const checks = await reportChecks(p);
    await checks.getByRole("button").first().click();
    const editor = p.locator(".report-page .ProseMirror");
    await expect(editor).toBeFocused();
    await p.keyboard.press("Escape");
    await expect(p.getByRole("region", { name: "To do" })).toHaveCount(0);
    await expect(editor).toBeFocused();
    expect(new URL(p.url()).pathname).toBe("/e/e-exam/s/report");
  };
  await run(page);
  const browser = await playwright.webkit.launch();
  try {
    await run(await browser.newPage({ baseURL }));
  } finally {
    await browser.close();
  }
});
