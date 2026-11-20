import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { collectLayoutIssues } from "./checks/layout";
import { collectA11yIssues } from "./checks/a11y";
import { checkShortcut, tabWalk } from "./checks/keyboard";
import { collectOptOuts } from "./checks/optouts";
import { collectUxIssues } from "./checks/ux";
import { groupRows, renderMarkdown } from "./report";
import { CHECK_IDS, gateFailures, type Issue, type RawIssue } from "./types";

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

const UX_FIXTURE = "file://" + fileURLToPath(new URL("./fixtures/selftest-ux.html", import.meta.url));

/** Runs the UX collector inside each case's iframe. */
async function uxCases(page: Page) {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(UX_FIXTURE);
  const out: { name: string; expect: string; issues: RawIssue[]; frame: import("@playwright/test").Frame }[] = [];
  for (const handle of await page.locator("iframe[data-case]").elementHandles()) {
    const frame = (await handle.contentFrame())!;
    await frame.waitForLoadState();
    await frame.evaluate(() => document.fonts.ready);
    out.push({
      name: (await handle.getAttribute("data-case"))!,
      expect: (await handle.getAttribute("data-expect"))!,
      issues: await frame.evaluate(collectUxIssues),
      frame,
    });
  }
  return out;
}

test("ux checks flag each case", async ({ page }) => {
  const cases = (await uxCases(page)).filter((c) => c.expect !== "none");
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const hits = c.issues.filter((i) => i.check === c.expect);
    expect(hits.length, `case ${c.name} should be flagged as ${c.expect}`).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.selector, `${c.name} names its element`).not.toBe("");
      if (h.selector !== "(page)") {
        expect(await c.frame.locator(h.selector).count(), `${c.name} selector ${h.selector} resolves`).toBeGreaterThan(0);
      }
    }
  }
});

test("ux checks leave clean cases alone", async ({ page }) => {
  const cases = (await uxCases(page)).filter((c) => c.expect === "none");
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    expect(c.issues, `case ${c.name} should be clean`).toEqual([]);
  }
});

test("groupRows collapses nth variants and caps groups per check", () => {
  const mk = (selector: string, width = 900): Issue => ({ screen: "s", width, check: "tiny-text", selector, detail: "d" });
  const collapsed = groupRows([mk("ul > li:nth-of-type(1) > b"), mk("ul > li:nth-of-type(2) > b", 1024)]);
  expect(collapsed.groups).toHaveLength(1);
  expect(collapsed.groups[0]).toMatchObject({ selector: "ul > li > b", count: 2, widths: [900, 1024] });
  const many = groupRows(Array.from({ length: 15 }, (_, n) => mk(`.c${n}`)));
  expect(many.groups).toHaveLength(12);
  expect(many.more).toEqual([{ check: "tiny-text", count: 3 }]);
});

// ---------------------------------------------------------------- the gate: convention breaks fail the run

/** Everything a screen run collects, on a page built from `html`. */
async function gateRun(page: Page, html: string): Promise<RawIssue[]> {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;font:14px/20px sans-serif">${html}</body></html>`);
  return [...(await page.evaluate(collectLayoutIssues)), ...(await page.evaluate(collectUxIssues)), ...(await page.evaluate(collectOptOuts, CHECK_IDS))];
}

test("a 10px text fixture fails the run", async ({ page }) => {
  const fails = gateFailures(await gateRun(page, `<p style="margin:0;font-size:10px">Tiny caption text</p>`));
  expect(fails.some((f) => f.startsWith("tiny-text "))).toBe(true);
});

test("non-label text under 13px fails; 12px labels, chips and key caps pass", async ({ page }) => {
  const body = gateFailures(await gateRun(page, `<p style="margin:0;font-size:12px">Body copy at twelve pixels</p>`));
  expect(body.some((f) => f.startsWith("tiny-text "))).toBe(true);
  const roles = await gateRun(page, [
    `<span class="section-label" style="font-size:12px;text-transform:uppercase">Services</span>`,
    `<span class="section-label" style="font-size:12px;border:1px solid;border-radius:999px">open</span>`,
    `<kbd style="font-size:12px">K</kbd>`,
    `<p style="margin:0;font-size:13px">Meta text at thirteen</p>`,
  ].join(""));
  expect(gateFailures(roles)).toEqual([]);
});

test("a document that scrolls fails the run; one that fits passes", async ({ page }) => {
  const tall = await gateRun(page, `<div style="height:2000px">Taller than the window</div>`);
  expect(gateFailures(tall).some((f) => f.startsWith("document-scroll "))).toBe(true);
  const wide = await gateRun(page, `<div style="width:2000px;height:20px">Wider than the window</div>`);
  expect(gateFailures(wide).some((f) => f.startsWith("document-scroll "))).toBe(true);
  // The escape that shipped: an absolutely placed box inside a pane that scrolls, but is not itself positioned.
  const escaped = await gateRun(page, `<div style="height:300px;overflow:auto"><span style="position:absolute;top:5000px">label</span></div>`);
  expect(gateFailures(escaped).some((f) => f.startsWith("document-scroll "))).toBe(true);
  const fits = await gateRun(page, `<div style="height:300px;overflow:auto"><div style="position:relative;height:2000px">Scrolls inside its pane</div></div>`);
  expect(gateFailures(fits).filter((f) => f.startsWith("document-scroll "))).toEqual([]);
});

test("data-audit-allow without a reason is itself an error", async ({ page }) => {
  const issues = await gateRun(page, `<p data-audit-allow="tiny-text" style="margin:0;font-size:10px">Tiny but allowed</p>`);
  expect(issues.some((i) => i.check === "tiny-text")).toBe(false);
  expect(gateFailures(issues).some((f) => f.startsWith("opt-out-unreasoned "))).toBe(true);
});

test("a data-audit-allow naming no real check is an error", async ({ page }) => {
  const issues = await gateRun(page, `<p data-audit-allow="tiny-txt" data-audit-reason="typo" style="margin:0;font-size:10px">Tiny text with a typo'd opt-out</p>`);
  expect(gateFailures(issues).some((f) => f.startsWith("opt-out-invalid "))).toBe(true);
  // The typo opts out of nothing: the text is still flagged.
  expect(issues.some((i) => i.check === "tiny-text")).toBe(true);
});

test("an opt-out with a reason skips only its check and is listed", async ({ page }) => {
  const issues = await gateRun(
    page,
    `<p data-audit-allow="tiny-text" data-audit-reason="synthetic fixture" style="margin:0;font-size:10px">Tiny but allowed</p>` +
      `<p style="margin:0;font-size:10px">Tiny and not allowed</p>`,
  );
  expect(issues.filter((i) => i.check === "tiny-text")).toHaveLength(1);
  expect(issues.filter((i) => i.check === "opt-out").map((i) => i.detail)).toEqual(["tiny-text: synthetic fixture"]);
});

test("report.md lists every opt-out with its reason", () => {
  const mk = (screen: string, width: number): Issue => ({ screen, width, check: "opt-out", selector: "p.x", detail: "tiny-text: synthetic fixture" });
  const md = renderMarkdown([mk("a", 900), mk("b", 1024)], ["a", "b"], new Set(), new Set(["a@900", "b@1024"]));
  const section = md.slice(md.indexOf("## Opt-outs"));
  expect(md).toContain("## Opt-outs");
  expect(section).toMatch(/`p\.x`.*tiny-text: synthetic fixture.*a, b/);
});

/** A host picker like ChipPicker: K opens a listbox; focus either stays on the trigger (active descendant) or goes nowhere near it. */
const PICKER = (activeDescendant: boolean) => `
  <button id="t" aria-haspopup="listbox">Host</button><button id="other">Other</button>
  <ul role="listbox" aria-label="Fill for host" id="l" hidden><li role="option" id="l-0">dc01</li></ul>
  <script>
    document.addEventListener("keydown", (e) => {
      const t = document.getElementById("t"), l = document.getElementById("l");
      if (e.key === "k") {
        l.hidden = false;
        ${activeDescendant ? `t.setAttribute("aria-controls", "l"); t.setAttribute("aria-activedescendant", "l-0"); t.focus();` : `document.getElementById("other").focus();`}
      }
      if (e.key === "Escape") { l.hidden = true; t.removeAttribute("aria-activedescendant"); t.focus(); }
    });
  </script>`;

test("an active-descendant listbox counts as focus inside it; focus elsewhere does not", async ({ page }) => {
  const s = { id: "picker", path: "/", keys: ["k"], opens: "role=listbox[name='Fill for host']", focusInside: true, closesWithEscape: true };
  await page.setContent(PICKER(true));
  expect(await checkShortcut(page, s)).toEqual([]);
  await page.setContent(PICKER(false));
  const issues = await checkShortcut(page, s);
  expect(issues.map((i) => i.detail).join("\n")).toMatch(/focus is not inside it/);
});
