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

test("Report: at 1400 with the tabs overflowing, Page actions and + Page stay in view beside Export; only the tabs scroll", async ({ page }) => {
  await openReport(page, "Tools and versions");
  const scroller = page.locator(".report-tabs__scroller");
  const add = page.getByRole("button", { name: "+ Page" });
  // Enough free pages to overflow the row (each opens as it is added, so Page actions stays offered).
  while (await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)) {
    const count = await tabRow(page).getByRole("tab").count();
    await add.click();
    await page.getByRole("menu", { name: "Add a page" }).getByRole("menuitem", { name: "Free page" }).click();
    await expect(tabRow(page).getByRole("tab")).toHaveCount(count + 1);
  }
  const actions = page.getByRole("button", { name: "Page actions" });
  const exportButton = page.getByRole("button", { name: /^Export/ }).first();
  const inView = async () => {
    const view = page.viewportSize()!;
    const row = (await scroller.boundingBox())!;
    for (const control of [actions, add, exportButton]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      // Right of the scrolling tabs, inside the window.
      expect(box.x).toBeGreaterThanOrEqual(row.x + row.width - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    }
    // Page actions, + Page, then Export, left to right.
    const xs = await Promise.all([actions, add, exportButton].map(async (c) => (await c.boundingBox())!.x));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  };
  // The open (last) tab is scrolled into view, the row scrolled to its end; scrolled back to the start, nothing moves.
  await inView();
  await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
  await inView();
});

test("Report: after + add in the evidence column, by key or click, focus moves on to a row of the column, in WebKit too", async ({ page, playwright, baseURL }) => {
  const run = async (p: Page) => {
    // ms01 has five unused log entries.
    await openReport(p, "ms01");
    await p.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true }).click();
    const column = p.locator("aside[aria-label='Evidence']");
    const rows = column.locator("li[data-rail-row]");
    await rows.first().waitFor();
    const before = await rows.count();
    const add = rows.first().getByRole("button", { name: /^Add / });
    await add.focus();
    await p.keyboard.press("Enter");
    await expect(rows).toHaveCount(before - 1);
    await expect(column.locator("li[data-rail-row]:focus")).toHaveCount(1);
    // And by a click, which WebKit doesn't follow with focus.
    await rows.first().getByRole("button", { name: /^Add / }).click();
    await expect(rows).toHaveCount(before - 2);
    await expect(column.locator("li[data-rail-row]:focus")).toHaveCount(1);
  };
  await run(page);
  const browser = await playwright.webkit.launch();
  try {
    await run(await browser.newPage({ baseURL }));
  } finally {
    await browser.close();
  }
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
