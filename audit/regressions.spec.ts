import { expect, test, type Page } from "@playwright/test";
import { AUDIT_NOW } from "../src/audit/fixtures";

// Hard regressions: unlike the audit checks, these fail the run.

for (const path of ["/arsenal", "/"]) {
  test(`search from ${path}: the field stays usable next to a long engagement name`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install({ time: AUDIT_NOW });
    await page.goto(path);
    // The app is ready once the title bar's Search button is up (⌘K is bound behind the vault gate).
    await page.getByRole("button", { name: /Search/ }).waitFor();
    await page.keyboard.press("Meta+K");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const bar = dialog.getByRole("search");
    const input = dialog.getByRole("combobox", { name: "Search" });

    // The input keeps most of the bar; the host chip never covers it.
    const barBox = (await bar.boundingBox())!;
    const inputBox = (await input.boundingBox())!;
    expect(inputBox.width).toBeGreaterThan(barBox.width * 0.5);

    // Clicking where you type lands in the search field, not the hidden host select.
    await page.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
    await expect(input).toBeFocused();

    // Results are selectable: typing filters, ArrowDown moves the selection, the preview follows.
    await input.fill("nmap");
    const options = dialog.getByRole("listbox", { name: "Results" }).getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    const before = await dialog.locator("pre").textContent();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator("pre")).not.toHaveText(before ?? "");
  });
}

// A scroll pane must keep every focusable (plus a 2px focus outline) inside its client box:
// clipped outlines and controls under the overlay scrollbar are both caught here.
const PANE_CHECK = `(() => {
  const bad = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const focusables = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  for (const el of focusables) {
    if (!visible(el)) continue;
    let pane = el.parentElement;
    while (pane && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (!pane || pane === document.body) continue;
    // Overlay scrollbars (macOS WKWebView) reserve no gutter: the pane itself must pad the right edge.
    if (pane.closest('[class*="@container/host"]') && parseFloat(getComputedStyle(pane).paddingRight) < 12) bad.push("padding-right < 12px: " + (pane.getAttribute("aria-label") || pane.className.slice(0, 40)));
    const p = pane.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = p.left + pane.clientLeft;
    const right = left + pane.clientWidth;
    if (r.left - 2 < left - 0.5 || r.right + 2 > right + 0.5) {
      bad.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40) + " in " + (pane.getAttribute("aria-label") || pane.className.slice(0, 40)));
    }
  }
  return bad;
})()`;

test("scroll panes never clip focus or hide controls under the scrollbar", async ({ page }) => {
  await page.clock.install({ time: AUDIT_NOW });
  const ready = async (path: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    await page.getByRole("button", { name: /Search/ }).waitFor();
  };

  for (const width of [1280, 900]) {
    await ready("/e/e-exam/h/h-exam-ms01", width);
    await page.getByRole("button", { name: "Edit who am I" }).waitFor();
    expect(await page.evaluate(PANE_CHECK), `ms01 at ${width}`).toEqual([]);

    await page.getByRole("button", { name: "Edit who am I" }).click();
    const input = page.getByRole("textbox", { name: "User", exact: true });
    await input.focus();
    const fits = await input.evaluate((el) => {
      let pane = el.parentElement;
      while (pane && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
      const p = pane!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const left = p.left + pane!.clientLeft;
      return r.left - 2 >= left - 0.5 && r.right + 2 <= left + pane!.clientWidth + 0.5;
    });
    expect(fits, `who am I input at ${width}`).toBe(true);
  }

  await ready("/e/e-lab/h/h-web", 1280);
  await page.keyboard.press("f");
  await page.getByRole("region", { name: "Finding" }).waitFor();
  expect(await page.evaluate(PANE_CHECK), "finding split").toEqual([]);

  // The step picker's list is a scroll pane too.
  await page.getByRole("button", { name: "Add step" }).click();
  const picker = page.getByRole("group", { name: "Reproduction steps section" });
  const candidate = picker.locator("ul button[aria-label^='Add ']").first();
  await candidate.waitFor();
  // The candidate list is its own scroll pane inside the picker, and PANE_CHECK covers its rows.
  const pane = await candidate.evaluate((el, group) => {
    let p = el.parentElement;
    while (p && !/auto|scroll/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    return { found: !!p && document.querySelector(group)!.contains(p), padRight: p ? parseFloat(getComputedStyle(p).paddingRight) : 0 };
  }, "[aria-label='Reproduction steps section']");
  expect(pane, "step picker list is a scroll pane").toEqual({ found: true, padRight: expect.any(Number) });
  expect(pane.padRight).toBeGreaterThanOrEqual(12);
  expect(await page.evaluate(PANE_CHECK), "finding split with the step picker open").toEqual([]);
});

// Host page, finding split and sidebar (redesign).

const LAB_HOST = "/e/e-lab/h/h-web";
const WEB_SHORT = "web-finance-dmz-portal-01";

/** Opens a path at a width with a frozen clock and waits for the app shell. */
async function open(page: Page, path: string, width: number, height = 900) {
  await page.clock.install({ time: AUDIT_NOW });
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await page.getByRole("button", { name: /Search/ }).waitFor();
}

test("host page never scrolls sideways", async ({ page }) => {
  for (const width of [800, 900, 1024, 1280, 1440]) {
    await open(page, LAB_HOST, width);
    await page.getByRole("tab", { name: "Next" }).waitFor();
    const r = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      outside: [...document.querySelectorAll('[role="tab"]')]
        .map((t) => ({ name: (t.textContent ?? "").trim(), r: t.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.left < 0 || r.right > window.innerWidth))
        .map(({ name }) => name),
    }));
    expect(r.scroll, `scrollWidth at ${width}`).toBeLessThanOrEqual(r.inner);
    expect(r.outside, `tabs outside the viewport at ${width}`).toEqual([]);
  }
});

test("credentials notice stays one line", async ({ page }) => {
  await open(page, LAB_HOST, 900);
  await page.getByRole("tab", { name: "Next" }).click();
  await page.getByRole("button", { name: "Full checklist" }).click();
  const notice = page.getByText(/new creds since done/).first();
  await notice.waitFor();
  const { height, lineHeight } = await notice.evaluate((el) => {
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    return { height: el.getBoundingClientRect().height, lineHeight: s.lineHeight === "normal" ? fs * 1.2 : parseFloat(s.lineHeight) };
  });
  expect(height).toBeLessThanOrEqual(2 * lineHeight);
});

test("add finding opens beside the log", async ({ page }) => {
  await open(page, LAB_HOST, 1280);
  await page.getByRole("tab", { name: "Next" }).waitFor();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("f");
  const finding = page.getByRole("region", { name: "Finding" });
  await finding.waitFor();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const logTab = page.getByRole("tab", { name: "Log" });
  await expect(logTab).toBeVisible();
  await logTab.click();

  const steps = page.getByRole("list", { name: "Reproduction steps" }).getByRole("listitem");
  await expect(steps).toHaveCount(0);
  await page.getByRole("tabpanel", { name: "Log" }).getByRole("button", { name: /^Add .* as a step$/ }).first().click();
  await expect(steps).toHaveCount(1);

  await finding.getByRole("textbox", { name: "Title" }).fill("Kept title");
  await page.keyboard.press("Escape");
  await expect(finding).toHaveCount(0);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("f");
  await expect(page.getByRole("region", { name: "Finding" }).getByRole("textbox", { name: "Title" })).toHaveValue("Kept title");
});

test("finding services are the selected hosts' only", async ({ page }) => {
  await open(page, LAB_HOST, 1280);
  await page.getByRole("tab", { name: "Next" }).waitFor();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("f");
  const finding = page.getByRole("region", { name: "Finding" });
  await finding.waitFor();
  const services = finding.getByRole("group", { name: "Affected services" });
  await services.waitFor();
  await expect(services.getByText(/dc01/i)).toHaveCount(0);
  await expect(services.getByRole("button").first()).toBeVisible();
});

test("sidebar collapses without sideways scroll and shows IPs", async ({ page }) => {
  await open(page, LAB_HOST, 1280);
  await page.getByRole("tab", { name: "Next" }).waitFor();
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const hostRows = page.locator('nav a[href*="/h/"]');

  await page.keyboard.press("Meta+B");
  await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
  expect(await fits(), "collapsed").toBe(true);

  await page.keyboard.press("Meta+B");
  await page.getByRole("button", { name: "Collapse sidebar" }).waitFor();
  expect(await fits(), "expanded").toBe(true);
  const rows = await hostRows.evaluateAll((els) =>
    els.map((a) => ({ text: (a.textContent ?? "").trim(), title: a.getAttribute("title") ?? "" })),
  );
  // e-lab has exactly these six hosts in the fixtures; every row must show its own IP.
  const ips: Record<string, string> = {
    [WEB_SHORT]: "10.10.20.15", dc01: "10.10.20.10", fs01: "10.10.20.21", sql01: "10.10.20.22", "pivot-gw": "10.10.20.30", ws07: "10.10.20.57",
  };
  expect(rows).toHaveLength(Object.keys(ips).length);
  for (const r of rows) {
    const short = Object.keys(ips).find((n) => r.text.includes(n));
    expect(short, `row "${r.text}" shows a known short name`).toBeDefined();
    expect(r.text, `row ${short} shows its IP`).toContain(ips[short!]);
    expect(r.text, "no clipped host name").not.toMatch(/^web-fin…/);
    expect(r.text, "short name, not the FQDN").not.toContain(".dmz.finance");
  }
  expect(rows.some((r) => r.text.includes(WEB_SHORT))).toBe(true);
});

test("log rows on a host page have no chip for that host", async ({ page }) => {
  await open(page, LAB_HOST, 1280);
  await page.getByRole("tab", { name: "Log" }).click();
  const rows = page.getByRole("tabpanel", { name: "Log" }).locator("button[aria-expanded]");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(rows.filter({ hasText: WEB_SHORT })).toHaveCount(0);

  // Positive control: the engagement Log shows that host's chip on the same entries.
  await page.goto("/e/e-lab/s/log");
  const all = page.getByRole("region", { name: "Log" }).locator("button[aria-expanded]");
  await expect(all.first()).toBeVisible();
  expect(await all.filter({ hasText: WEB_SHORT }).count(), "engagement Log has chips for the web host").toBeGreaterThan(0);
});

test("post-foothold facts show without scrolling", async ({ page }) => {
  await open(page, "/e/e-exam/h/h-exam-ms01", 1280);
  for (const text of ["Who am I", "SeImpersonatePrivilege (potato)"]) {
    const el = page.getByText(text).first();
    await el.waitFor();
    const box = await el.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 900, `${text} is inside the 900px viewport`).toBe(true);
  }
});
