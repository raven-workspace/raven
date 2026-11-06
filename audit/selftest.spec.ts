import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { collectLayoutIssues } from "./checks/layout";
import { collectA11yIssues } from "./checks/a11y";
import { tabWalk } from "./checks/keyboard";
import type { RawIssue } from "./types";

const FIXTURE = "file://" + fileURLToPath(new URL("./fixtures/selftest-layout.html", import.meta.url));

async function run(page: Page): Promise<RawIssue[]> {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(FIXTURE);
  const layout = await page.evaluate(collectLayoutIssues);
  return [...layout, ...(await collectA11yIssues(page))];
}

/** The data-case of every fixture section containing an element the selector resolves to. */
async function casesOf(page: Page, selector: string): Promise<string[]> {
  const cases = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => el.closest("section")?.getAttribute("data-case") ?? ""),
  );
  return cases.filter(Boolean);
}

test("each expected case is flagged with its check", async ({ page }) => {
  const issues = await run(page);
  const expected = await page.$$eval("[data-expect]", (els) =>
    els
      .map((e) => [e.getAttribute("data-case")!, e.getAttribute("data-expect")!])
      .filter(([, x]) => x !== "none"),
  );
  expect(expected.length).toBeGreaterThan(0);
  for (const [name, check] of expected) {
    let found = false;
    for (const i of issues.filter((x) => x.check === check)) {
      if ((await casesOf(page, i.selector)).includes(name)) found = true;
    }
    expect(found, `case ${name} should be flagged as ${check}`).toBe(true);
  }
});

test("clean cases produce no issues", async ({ page }) => {
  const issues = await run(page);
  for (const i of issues) {
    for (const c of await casesOf(page, i.selector)) {
      const expected = await page.locator(`section[data-case="${c}"]`).getAttribute("data-expect");
      expect(expected, `unexpected ${i.check} in ${c}: ${i.selector} (${i.detail})`).not.toBe("none");
    }
  }
});

const KBD_FIXTURE = "file://" + fileURLToPath(new URL("./fixtures/selftest-keyboard.html", import.meta.url));

async function walk(page: Page, hash = ""): Promise<RawIssue[]> {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(KBD_FIXTURE + hash);
  return tabWalk(page, { maxStops: 20 });
}

test("tabWalk flags each keyboard case", async ({ page }) => {
  const issues = await walk(page);
  for (const name of ["focus-invisible", "unreachable"]) {
    let found = false;
    for (const i of issues.filter((x) => x.check === name)) {
      if ((await casesOf(page, i.selector)).includes(name)) found = true;
    }
    expect(found, `case ${name} should be flagged as ${name}`).toBe(true);
  }
  const trapPage = await page.context().newPage();
  const trap = await walk(trapPage, "#trap");
  expect(trap.map((i) => i.check)).toContain("focus-trap");
  expect(await casesOf(trapPage, trap.find((i) => i.check === "focus-trap")!.selector)).toContain("focus-trap");
});

test("tabWalk leaves roving and styled cases alone", async ({ page }) => {
  const issues = await walk(page);
  expect(issues.length).toBeGreaterThan(0);
  for (const i of issues) {
    for (const c of await casesOf(page, i.selector)) {
      const expected = await page.locator(`section[data-case="${c}"]`).getAttribute("data-expect");
      expect(expected, `unexpected ${i.check} in ${c}: ${i.selector} (${i.detail})`).not.toBe("none");
    }
  }
  expect(issues.map((i) => i.check)).not.toContain("focus-trap");
});
