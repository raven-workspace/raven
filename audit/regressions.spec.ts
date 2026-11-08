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

    // Clicking where you type lands in the search field, not the host chip (which has no overlay and no Tab stop).
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
const WEB_SHORT = "web-portal-dmz-frontend-01";

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
  const notice = page.getByText(/New credentials since done/).first();
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

test("rail: 32px section boxes on the host glyphs' centre line, names inside the rail", async ({ page }) => {
  for (const width of [900, 1280]) {
    await open(page, LAB_HOST, width);
    await page.getByRole("tab", { name: "Next" }).waitFor();
    if (await page.getByRole("button", { name: "Collapse sidebar" }).isVisible()) await page.keyboard.press("Meta+B");
    await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
    const nav = page.getByRole("navigation", { name: "Engagement" });
    // The rail is 56px including its 1px hairline; let the width transition settle.
    await expect.poll(async () => (await nav.boundingBox())!.width).toBe(55);
    const geo = await nav.evaluate((el) => {
      const rail = el.getBoundingClientRect();
      const box = (e: Element) => e.getBoundingClientRect();
      const cx = (r: DOMRect) => r.left + r.width / 2;
      const sections = [...el.querySelectorAll('a:not([href*="/h/"])')].map(box);
      const hosts = [...el.querySelectorAll('a[href*="/h/"]')];
      const glyphs = hosts.map((a) => box(a.firstElementChild!));
      const labels = hosts.map((a) => a.querySelector("span[aria-hidden]")!);
      return {
        railCx: cx(rail), railRight: rail.right,
        sections: sections.map((r) => ({ w: r.width, h: r.height, cx: cx(r), top: r.top })),
        glyphCx: glyphs.map(cx),
        hostRight: hosts.map((a) => box(a).right),
        labelFits: labels.map((l) => l.scrollWidth <= l.clientWidth + 0.5 && box(l).right <= rail.right),
      };
    });
    expect(geo.sections).toHaveLength(6);
    for (const s of geo.sections) {
      expect(s.w, `${width}: section box width`).toBe(32);
      expect(s.h, `${width}: section box height`).toBe(32);
      expect(Math.abs(s.cx - geo.railCx), `${width}: section centred in the rail`).toBeLessThanOrEqual(0.5);
    }
    for (let i = 1; i < geo.sections.length; i++)
      expect(geo.sections[i].top - geo.sections[i - 1].top, `${width}: section pitch`).toBeGreaterThanOrEqual(36);
    expect(geo.glyphCx.length).toBeGreaterThan(0);
    for (const g of geo.glyphCx) expect(Math.abs(g - geo.sections[0].cx), `${width}: host glyph on the section centre line`).toBeLessThanOrEqual(0.5);
    for (const r of geo.hostRight) expect(r, `${width}: host row inside the rail`).toBeLessThanOrEqual(geo.railRight);
    expect(geo.labelFits.every(Boolean), `${width}: rail host names fit`).toBe(true);
  }
});

test("log rows on a host page have no chip for that host", async ({ page }) => {
  await open(page, LAB_HOST, 1280);
  await page.getByRole("tab", { name: "Log" }).click();
  const rows = page.getByRole("tabpanel", { name: "Log" }).locator("button[aria-expanded]");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(3);
  // Host names load after the rows; wait for the sidebar host row before asserting zero.
  await expect(page.getByRole("navigation", { name: "Engagement" }).getByText(WEB_SHORT).first()).toBeVisible();
  await expect(rows.filter({ hasText: WEB_SHORT })).toHaveCount(0);

  // Positive control: the engagement Log shows that host's chip on the same entries.
  await page.goto("/e/e-lab/s/log");
  const all = page.getByRole("region", { name: "Log" }).locator("button[aria-expanded]");
  await expect(all.first()).toBeVisible();
  await expect(all.filter({ hasText: WEB_SHORT }).first(), "engagement Log has chips for the web host").toBeVisible();
});

test("post-foothold facts show without scrolling", async ({ page }) => {
  await open(page, "/e/e-exam/h/h-exam-ms01", 1280);
  for (const text of ["Who am I", "SeImpersonatePrivilege (potato)"]) {
    const el = page.getByText(text).first();
    await el.waitFor();
    const box = await el.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 900, `${text} is inside the 900px viewport`).toBe(true);
    // In the viewport is not enough: it must not be clipped inside a scroll pane either.
    const inPane = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      for (let a = node.parentElement; a; a = a.parentElement) {
        if (!/^(auto|scroll)$/.test(getComputedStyle(a).overflowY)) continue;
        const p = a.getBoundingClientRect();
        // The client rect: inside the borders, without a horizontal scrollbar.
        const top = p.top + a.clientTop;
        const bottom = top + a.clientHeight;
        const left = p.left + a.clientLeft;
        const right = left + a.clientWidth;
        return { ok: r.top >= top && r.bottom <= bottom && r.left >= left && r.right <= right, pane: { top, bottom, left, right }, el: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
      }
      return { ok: true, pane: null, el: null };
    });
    expect(inPane.ok, `${text} is inside its scroll pane: ${JSON.stringify(inPane)}`).toBe(true);
  }
});

// Arsenal reference round.

const FS01 = "/e/e-lab/h/h-fs01";

test("host chip is never a Tab stop", async ({ page }) => {
  await open(page, FS01, 1280);
  await page.keyboard.press("Meta+K");
  const search = page.getByRole("dialog").getByRole("combobox", { name: "Search" });
  await search.waitFor();
  await search.fill("smb");
  const chip = page.getByRole("button", { name: /^Fill for host/ });
  await expect(chip).toHaveAttribute("tabindex", "-1");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await expect(chip).not.toBeFocused();
  }
});

test("Enter in the drawer copies", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, FS01, 1280);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("a");
  const input = page.locator("input[aria-label='Search the Arsenal']");
  await input.fill("smb");
  await page.getByRole("listbox", { name: "Arsenal results" }).getByRole("option").first().waitFor();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("10.10.20.21");
  await expect(page.getByText(/^Copied for fs01/)).toBeVisible();
});

async function holdBack(page: Page, context: import("@playwright/test").BrowserContext) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, FS01, 1280);
  await page.keyboard.press("Meta+K");
  await page.getByRole("combobox", { name: "Search" }).fill("several ports");
  await page.getByRole("option", { name: /Listen on several ports at once/ }).waitFor();
  // A sentinel, so "not copied" cannot pass on an empty or stale clipboard.
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
  await page.keyboard.press("Enter");
  await expect(page.getByText("{SECOND_LPORT} not filled · ↵ again to copy anyway")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Value for SECOND_LPORT" })).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SENTINEL");
}

test("copy guard focuses the first unfilled field, and a second Enter copies anyway", async ({ page, context }) => {
  await holdBack(page, context);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("{SECOND_LPORT}");
});

test("copy guard: filling the field then Enter copies the filled command", async ({ page, context }) => {
  await holdBack(page, context);
  await page.keyboard.type("5555");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("4444,5555");
});

test("browse pane 3: a held-back copy focuses the field, and Enter copies the filled command", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "/arsenal", 1280);
  await page.locator("input[aria-label='Search the Arsenal']").fill("several ports");
  await page.getByRole("option", { name: /Listen on several ports at once/ }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
  await page.keyboard.press("c");
  const field = page.getByRole("combobox", { name: "Value for SECOND_LPORT" });
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SENTINEL");
  await page.keyboard.type("5555");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(",5555");
});

test("lateral movement finds Pivoting", async ({ page }) => {
  await open(page, "/arsenal", 1280);
  await page.locator("input[aria-label='Search the Arsenal']").fill("lateral movement");
  await expect(page.getByRole("button", { name: /^Pivoting/ })).toBeVisible();
  await page.getByRole("button", { name: /^Pivoting/ }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
});

test("browse never shows 'Pick a card.'", async ({ page }) => {
  await page.goto("/arsenal");
  await page.getByRole("navigation", { name: "Categories" }).waitFor();
  // Wait for the reading pane to show a card before asserting the empty-state text is absent.
  await expect(page.getByRole("region", { name: "Reading" }).getByRole("heading").first()).toBeVisible();
  await expect(page.getByText("Pick a card.")).toHaveCount(0);
});

test("TokenInput suggestions stay inside the dialog and above the hint line", async ({ page }) => {
  for (const width of [900, 1280]) {
    await open(page, FS01, width);
    await page.keyboard.press("Meta+K");
    const dialog = page.getByRole("dialog");
    await page.getByRole("combobox", { name: "Search" }).fill("psexec");
    await page.getByRole("combobox", { name: "Value for TARGET_IP" }).focus();
    const list = dialog.getByRole("listbox", { name: "Suggestions for TARGET_IP" });
    await list.waitFor();
    const box = (await list.boundingBox())!;
    const dlg = (await dialog.boundingBox())!;
    const hint = (await dialog.locator("[data-hint-line]").boundingBox())!;
    expect(box.x, `list left edge at ${width}`).toBeGreaterThanOrEqual(dlg.x);
    expect(box.x + box.width, `list right edge at ${width}`).toBeLessThanOrEqual(dlg.x + dlg.width);
    expect(box.y, `list top at ${width}`).toBeGreaterThanOrEqual(dlg.y);
    expect(box.y + box.height, `list above the hint line at ${width}`).toBeLessThanOrEqual(hint.y);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
});

test("the credential list in ⌘K stays inside the dialog", async ({ page }) => {
  for (const width of [900, 1280]) {
    await open(page, FS01, width);
    await page.keyboard.press("Meta+K");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Search" }).waitFor();
    await page.keyboard.press("Alt+KeyC");
    const list = dialog.getByRole("listbox", { name: /Fill with credential/ });
    await list.waitFor();
    const box = (await list.boundingBox())!;
    const dlg = (await dialog.boundingBox())!;
    expect(box.x, `list left edge at ${width}`).toBeGreaterThanOrEqual(dlg.x);
    expect(box.x + box.width, `list right edge at ${width}`).toBeLessThanOrEqual(dlg.x + dlg.width);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
});

// Arsenal layout: the drawer keeps a steady split, and no Arsenal pane scrolls sideways or clips focus.

/** Every scroll pane under `root` with its sideways overflow, and focusables (plus a 2px outline) outside their pane. */
const ARSENAL_PANES = (root: string) => `(() => {
  const bad = [];
  const scope = document.querySelector(${JSON.stringify(root)});
  const panes = [...scope.querySelectorAll("*")].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) || /auto|scroll/.test(getComputedStyle(e).overflowX));
  // A [data-scroll-x] row scrolls sideways on purpose (the card's contents strip).
  for (const p of panes) if (!p.hasAttribute("data-scroll-x") && p.scrollWidth > p.clientWidth + 1) bad.push("sideways: " + (p.getAttribute("aria-label") || p.className.slice(0, 40)) + " " + p.scrollWidth + ">" + p.clientWidth);
  for (const p of panes) {
    if (!/auto|scroll/.test(getComputedStyle(p).overflowY)) continue;
    // Overlay scrollbars (macOS WKWebView) reserve no gutter: a pane with controls pads its right edge.
    if (p.scrollHeight > p.clientHeight + 1 && p.querySelector("button, input") && parseFloat(getComputedStyle(p).paddingRight) < 12) bad.push("padding-right < 12px: " + (p.getAttribute("aria-label") || p.className.slice(0, 40)));
  }
  const focusables = scope.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  for (const el of focusables) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.closest("[data-scroll-x]")) continue;
    let pane = el.parentElement;
    while (pane && pane !== scope.parentElement && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (!pane || pane === scope.parentElement) continue;
    const p = pane.getBoundingClientRect();
    const left = p.left + pane.clientLeft;
    const right = left + pane.clientWidth;
    if (r.left - 2 < left - 0.5 || r.right + 2 > right + 0.5) bad.push("clipped: " + (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40));
  }
  return bad;
})()`;

test("drawer: a long command never squeezes the list or hides its fields, and the split never moves", async ({ page }) => {
  await open(page, FS01, 1280);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("a");
  const aside = page.locator("aside[aria-label='Arsenal']");
  await page.locator("input[aria-label='Search the Arsenal']").fill("library");
  const options = aside.getByRole("listbox", { name: "Arsenal results" }).getByRole("option");
  await options.first().waitFor();
  const listPane = aside.locator("#arsenal-results").locator("..");
  const heights = new Set<number>();
  const n = Math.min(await options.count(), 8);
  let sawLong = false;
  for (let i = 0; i < n; i++) {
    if (i > 0) await page.keyboard.press("ArrowDown");
    heights.add(Math.round((await listPane.boundingBox())!.height));
    if (/Create the \.Library-ms file/.test((await options.nth(i).textContent()) ?? "")) {
      sawLong = true;
      // Every field of the long command can be scrolled to and seen inside the drawer.
      const fields = aside.getByRole("combobox", { name: /^Value for / });
      for (let f = 0; f < (await fields.count()); f++) {
        await fields.nth(f).scrollIntoViewIfNeeded();
        await expect(fields.nth(f)).toBeInViewport();
      }
    }
  }
  expect(sawLong, "the long command was among the results").toBe(true);
  expect([...heights], "list height is the same for every selection").toHaveLength(1);
  expect([...heights][0]).toBeGreaterThanOrEqual(300);
  expect(await page.evaluate(ARSENAL_PANES("aside[aria-label='Arsenal']"))).toEqual([]);
});

test("browse: no pane scrolls sideways or clips focus, and the contents strip sits the same stuck or not", async ({ page }) => {
  for (const width of [1280, 1100, 900]) {
    await open(page, "/arsenal", width);
    const reading = page.getByRole("region", { name: "Reading" });
    await reading.getByRole("heading").first().waitFor();
    await page.locator("input[aria-label='Search the Arsenal']").fill("library");
    await page.getByRole("option", { name: /Library-ms/ }).first().click();
    await reading.getByRole("heading", { name: /Library/ }).first().waitFor();
    expect(await page.evaluate(ARSENAL_PANES("[data-arsenal-browse]")), `panes at ${width}`).toEqual([]);

    // The whole card: blocks, fill fields and the contents strip.
    await reading.getByRole("button", { name: /^From card / }).click();
    const strip = reading.getByRole("navigation", { name: "On this card" });
    await strip.waitFor();
    expect(await page.evaluate(ARSENAL_PANES("[data-arsenal-browse]")), `card panes at ${width}`).toEqual([]);
    // Stuck, the strip is flush with the pane's top (nothing shows above it) and its labels sit in its middle.
    await reading.evaluate((el) => el.scrollTo(0, 400));
    const [pane, nav, label] = await Promise.all([reading.boundingBox(), strip.boundingBox(), strip.getByRole("button").first().boundingBox()]);
    expect(Math.abs(nav!.y - pane!.y), `strip flush at ${width}`).toBeLessThanOrEqual(1);
    const above = label!.y - nav!.y;
    const below = nav!.y + nav!.height - 1 - (label!.y + label!.height);
    expect(Math.abs(above - below), `strip labels centred at ${width}: ${above} vs ${below}`).toBeLessThanOrEqual(1);
    // The strip's own sideways scrollbar never sits over its labels.
    expect(await strip.locator("div").first().evaluate((el) => getComputedStyle(el).scrollbarWidth), `strip scrollbar at ${width}`).toBe("none");
  }
});

test("a [[link]] in a note opens its card, in browse and in the drawer", async ({ page }) => {
  await open(page, "/arsenal", 1280);
  const reading = page.getByRole("region", { name: "Reading" });
  await page.locator("input[aria-label='Search the Arsenal']").fill("full tcp scan of a target list");
  await page.getByRole("option", { name: /Full TCP scan of a target list/ }).first().click();
  const link = reading.getByRole("button", { name: "Host-Discovery" });
  await expect(link).toBeVisible();
  await expect(reading.getByText(/\[\[/)).toHaveCount(0);
  await link.click();
  await expect(reading.getByRole("heading", { name: "Host Discovery" })).toBeVisible();

  await open(page, FS01, 1280);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("a");
  await page.locator("input[aria-label='Search the Arsenal']").fill("full tcp scan of a target list");
  await page.getByRole("option", { name: /Full TCP scan of a target list/ }).first().waitFor();
  await page.keyboard.press("ArrowRight");
  const aside = page.locator("aside[aria-label='Arsenal']");
  await aside.getByRole("button", { name: "Host-Discovery" }).click();
  await expect(aside.getByRole("heading", { name: "Host Discovery" })).toBeVisible();
});

test("jumping to a block from the contents strip leaves its outline clear of the strip", async ({ page }) => {
  for (const width of [1280, 900]) {
    await open(page, "/arsenal", width);
    const reading = page.getByRole("region", { name: "Reading" });
    await page.locator("input[aria-label='Search the Arsenal']").fill("library");
    await page.getByRole("option", { name: /Library-ms/ }).first().click();
    await reading.getByRole("button", { name: /^From card / }).click();
    const strip = reading.getByRole("navigation", { name: "On this card" });
    await strip.waitFor();
    for (const i of [1, 3]) {
      await strip.getByRole("button").nth(i).click();
      await page.waitForTimeout(600);
      const block = reading.locator("[data-block]:focus");
      await expect(block).toHaveCount(1);
      const [s, b] = await Promise.all([strip.boundingBox(), block.boundingBox()]);
      // The outline is a 1px ring at the block's edge: it must start below the strip.
      expect(b!.y - 1, `block ${i} at ${width}`).toBeGreaterThanOrEqual(s!.y + s!.height);
    }
  }
});

// ---------------------------------------------------------------- interpreters and the save summary

const NXC_PASTE = [
  "$ nxc smb 10.10.20.10 -u jay drew -p 'Synth123!' 'Guess1' --continue-on-success",
  "SMB  10.10.20.10  445  DC01  [+] acme.corp\\jay:Synth123! (Pwn3d!)",
  "SMB  10.10.20.10  445  DC01  [-] acme.corp\\drew:Guess1 STATUS_LOGON_FAILURE",
].join("\n");

/** Opens the capture sheet on a host page, pastes `text` and saves with the Save button. */
async function captureAndSave(page: Page, text: string) {
  await page.keyboard.press("l");
  const paste = page.getByRole("textbox", { name: "Paste" });
  await paste.waitFor();
  await paste.fill(text);
  await page.getByRole("button", { name: /^Save/ }).click();
}

test("saving nxc spray output shows the win in the toast and the Extracted line, and Undo removes the credential", async ({ page }) => {
  await open(page, "/e/e-lab/h/h-dc01", 1280);
  await captureAndSave(page, NXC_PASTE);
  const toast = page.getByRole("status").filter({ has: page.getByRole("button", { name: "Close summary" }) });
  await expect(toast.getByText(/jay:Synth123! works on SMB/)).toBeVisible();

  // The new entry's own Extracted line shows without a reload.
  await page.getByRole("tab", { name: "Log" }).click();
  await page.getByRole("button", { name: /nxc/ }).first().click();
  const extracted = page.getByRole("button", { name: /Extracted: jay:Synth123! works on SMB/ });
  await expect(extracted).toBeVisible();

  // Navigating inside the app keeps the fake backend's state (a reload would restore the fixtures).
  const credentialsNav = page.getByRole("link", { name: "Credentials", exact: true });
  await credentialsNav.click();
  await expect(page.getByText("Synth123!").first()).toBeVisible();

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toBeHidden();
  await expect(page.getByText("Synth123!")).toHaveCount(0);
});

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("the toast never covers the capture Save button or the hint line", async ({ page }) => {
  for (const width of [900, 1280]) {
    await open(page, "/e/e-lab/h/h-dc01", width);
    await captureAndSave(page, NXC_PASTE);
    const toast = page.getByRole("status").filter({ has: page.getByRole("button", { name: "Close summary" }) });
    await toast.waitFor();
    await toast.hover(); // hovering holds the toast open while the boxes are measured
    const toastBox = (await toast.boundingBox())!;

    await page.keyboard.press("l");
    const save = page.getByRole("button", { name: /^Save/ });
    await save.waitFor();
    expect(overlaps(toastBox, (await save.boundingBox())!), `toast over Save at ${width}`).toBe(false);
    await page.keyboard.press("Escape");

    await page.keyboard.press("Meta+K");
    const hint = page.getByRole("dialog").locator("[data-hint-line]");
    await hint.waitFor();
    expect(overlaps(toastBox, (await hint.boundingBox())!), `toast over the hint line at ${width}`).toBe(false);
    await page.keyboard.press("Escape");
  }
});

test("tried pairs render muted in the test matrix with no sideways scroll", async ({ page }) => {
  for (const width of [900, 1280]) {
    await open(page, "/e/e-lab/s/credentials", width);
    const tried = page.locator("tr[data-tried]");
    await tried.first().waitFor();
    await expect(tried.first()).toContainText("drew");
    await expect(tried.first()).toContainText("tried");
    await expect(tried.first()).toHaveClass(/text-muted/);
    await expect(tried.first().getByRole("img", { name: /failed \(tried\)/ }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `the page scrolls sideways at ${width}`).toBe(true);
  }
});

// ---------------------------------------------------------------- Payloads

const IIS = "/e/e-pay/h/h-pay-iis";
const PG = "/e/e-pay/h/h-pay-pg";
const PAYLOADS_WIDTHS = [900, 1100, 1280, 1440];
const DRAWER = "aside[aria-label='Payloads']";
const WORKBENCH = "main[aria-label='Payloads']";

/**
 * Controls cut off by an ancestor that hides overflow (a tab row, a chip row), or poking out of the view itself.
 * ARSENAL_PANES only looks at scroll panes; this catches `overflow: hidden` rows and grid tracks wider than the view.
 */
const CLIPPED = (root: string) => `(() => {
  const bad = [];
  const scope = document.querySelector(${JSON.stringify(root)});
  const s = scope.getBoundingClientRect();
  for (const el of scope.querySelectorAll('button, input, [role="tab"], [role="option"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const name = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
    if (r.left < s.left - 0.5 || r.right > s.right + 0.5) { bad.push("outside the view: " + name); continue; }
    for (let a = el.parentElement; a && a !== scope.parentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const p = a.getBoundingClientRect();
      const left = p.left + a.clientLeft;
      if (r.left < left - 0.5 || r.right > left + a.clientWidth + 0.5) { bad.push("clipped: " + name); break; }
    }
  }
  return bad;
})()`;

/**
 * The context chips whose value is cut short (an ellipsis): OS, paste context and port must always read in full.
 * Each of the three must exist, so a renamed or missing chip fails instead of passing with nothing to check.
 */
async function truncatedChips(aside: import("@playwright/test").Locator) {
  const chips = aside.getByRole("button", { name: /^(OS|Paste into|Port): / });
  const names = await chips.evaluateAll((els) => els.map((c) => (c.getAttribute("aria-label") ?? "").split(":")[0]));
  const missing = ["OS", "Paste into", "Port"].filter((n) => names.filter((x) => x === n).length !== 1).map((n) => `expected one ${n} chip`);
  const cut = await chips.evaluateAll((els) =>
    els.filter((c) => [c, ...c.querySelectorAll("*")].some((e) => e.scrollWidth > e.clientWidth + 0.5)).map((c) => c.getAttribute("aria-label")),
  );
  return [...missing, ...cut];
}

/** Opens the Payloads drawer on a host page and waits for the payload in view. */
async function openDrawer(page: Page, path: string, width: number) {
  await open(page, path, width);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("p");
  const aside = page.locator(DRAWER);
  await aside.getByRole("heading", { level: 2 }).waitFor();
  return aside;
}

/** The IIS host's drawer, settled on its best fit (the host and its log have loaded). */
async function openIisDrawer(page: Page, width: number) {
  const aside = await openDrawer(page, IIS, width);
  await expect(aside.getByText("Fits: Windows, Web shell ?cmd=")).toBeVisible();
  await expect(aside.getByRole("heading", { level: 2 })).toHaveText("PowerShell base64 (-e)");
  return aside;
}

test("payloads drawer and workbench: no pane scrolls sideways or clips focus", async ({ page }) => {
  for (const width of PAYLOADS_WIDTHS) {
    const aside = await openIisDrawer(page, width);
    // The long host name and "Paste into Web shell ?cmd=" share the chip row; every generator tab shows.
    await expect(aside.getByRole("button", { name: /^Paste into: Web shell \?cmd=/ })).toBeVisible();
    expect(await truncatedChips(aside), `chips cut short at ${width}`).toEqual([]);
    await aside.getByRole("button", { name: "show" }).click();
    await aside.getByRole("list", { name: "Don't fit here" }).waitFor();
    expect(await page.evaluate(ARSENAL_PANES(DRAWER)), `drawer panes at ${width}`).toEqual([]);
    expect(await page.evaluate(CLIPPED(DRAWER)), `drawer controls at ${width}`).toEqual([]);

    await aside.getByRole("button", { name: "Full screen" }).click();
    const main = page.locator(WORKBENCH);
    await expect(main.getByRole("heading", { level: 2, name: "PowerShell base64 (-e)" })).toBeVisible();
    expect(await page.evaluate(ARSENAL_PANES(WORKBENCH)), `workbench panes at ${width}`).toEqual([]);
    expect(await page.evaluate(CLIPPED(WORKBENCH)), `workbench controls at ${width}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `page at ${width}`).toBe(true);

    // The Postgres host, with the longest paste context picked, then its SQL generator (long steps, fields, Copy buttons).
    const pg = await openDrawer(page, PG, width);
    await pg.getByRole("button", { name: /^Paste into: / }).click();
    await pg.getByRole("option", { name: "Injected command (Linux)" }).click();
    await expect(pg.getByRole("button", { name: "Paste into: Injected command (Linux)" })).toBeVisible();
    expect(await truncatedChips(pg), `chips cut short on the Postgres host at ${width}`).toEqual([]);
    expect(await page.evaluate(CLIPPED(DRAWER)), `Postgres drawer controls at ${width}`).toEqual([]);
    await page.keyboard.press("Alt+Digit3");
    await expect(pg.getByRole("tab", { name: "SQL injection" })).toHaveAttribute("aria-selected", "true");
    await expect(pg.getByText("PostgreSQL").first()).toBeVisible();
    expect(await page.evaluate(ARSENAL_PANES(DRAWER)), `SQL panes at ${width}`).toEqual([]);
    expect(await page.evaluate(CLIPPED(DRAWER)), `SQL controls at ${width}`).toEqual([]);
  }
});

test("long ps-b64 payload wraps inside its block", async ({ page }) => {
  /** The block's overflow and how far it sits outside its scroll pane (0 when inside). */
  const measure = (root: string) =>
    page.locator(`${root} pre[aria-label='Payload']`).evaluate((el) => {
      let pane = el.parentElement;
      while (pane && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
      const r = el.getBoundingClientRect();
      const p = pane!.getBoundingClientRect();
      return {
        length: (el.textContent ?? "").length, sideways: el.scrollWidth - el.clientWidth,
        paneSideways: pane!.scrollWidth - pane!.clientWidth, outside: Math.max(0, r.right - (p.left + pane!.clientWidth)),
      };
    });
  for (const width of PAYLOADS_WIDTHS) {
    const aside = await openIisDrawer(page, width);
    const drawer = await measure(DRAWER);
    expect(drawer.length, "the base64 payload is the long one").toBeGreaterThan(1000);
    expect(drawer, `drawer at ${width}`).toMatchObject({ sideways: 0, paneSideways: 0, outside: 0 });

    await aside.getByRole("button", { name: "Full screen" }).click();
    await expect(page.locator(WORKBENCH).getByRole("heading", { level: 2, name: "PowerShell base64 (-e)" })).toBeVisible();
    const bench = await measure(WORKBENCH);
    expect(bench.length).toBe(drawer.length);
    expect(bench, `workbench at ${width}`).toMatchObject({ sideways: 0, paneSideways: 0, outside: 0 });
  }
});

test("P opens on the best fit for the IIS host and ↵ copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const aside = await openIisDrawer(page, 1280);
  await expect(aside.getByText("Best fit", { exact: true })).toBeVisible();
  const shown = await aside.locator("pre[aria-label='Payload']").textContent();
  expect(shown).toMatch(/^powershell/);
  // A sentinel, so a stale or empty clipboard cannot pass.
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
});

test("the misfit fold lists nc.exe as failed here before", async ({ page }) => {
  const aside = await openIisDrawer(page, 1280);
  // Not among the fits the drawer offers.
  await expect(aside.getByRole("button", { name: "nc.exe -e" })).toHaveCount(0);
  const show = aside.getByRole("button", { name: "show" });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await show.click();
  const row = aside.getByRole("list", { name: "Don't fit here" }).getByRole("listitem").filter({ hasText: "nc.exe -e" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Failed here before");
});

// Board: lanes share their header row, so every lane's first card starts on one line (DESIGN.md Layout rule 5).

test("board: first cards share a top line at 900/1100/1280/1440", async ({ page }) => {
  // e-board has a 20-host lane, three one-host lanes and two empty lanes; e-lab has a long host name.
  for (const id of ["e-board", "e-lab"]) {
    for (const width of [900, 1100, 1280, 1440]) {
      await open(page, `/e/${id}`, width);
      await page.locator("section[aria-label='Information gathering'] [data-lane-body]").waitFor();
      const r = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("section[aria-label]:has(> [data-lane-body])")].map((lane) => {
          const body = lane.querySelector<HTMLElement>("[data-lane-body]")!;
          const cards = [...body.querySelectorAll<HTMLElement>("a[data-host-id]")];
          const overflow = cards.flatMap((card) => {
            const box = card.getBoundingClientRect();
            return [...card.querySelectorAll<HTMLElement>("[data-variant], img[data-brand]")]
              .filter((el) => {
                const b = el.getBoundingClientRect();
                return b.left < box.left - 0.5 || b.right > box.right + 0.5;
              })
              .map((el) => `${card.dataset.hostId}: ${el.textContent || el.dataset.brand}`);
          });
          return {
            lane: lane.getAttribute("aria-label")!,
            cards: cards.length,
            top: (cards[0] ?? body).getBoundingClientRect().top,
            overflow,
          };
        }),
      );
      expect(r, `${id} lanes at ${width}`).toHaveLength(6);
      if (id === "e-board") {
        expect(r.map((l) => l.cards), "fixture shape").toEqual([20, 1, 1, 1, 0, 0]);
      }
      for (const l of r) {
        expect(Math.abs(l.top - r[0].top), `${id} "${l.lane}" first card top at ${width}`).toBeLessThanOrEqual(1);
        if (width === 900) expect(l.overflow, `${id} "${l.lane}" chips inside cards at 900`).toEqual([]);
      }
    }
  }
});

test("status strip drops by its own free space: LHOST stays while it fits", async ({ page }) => {
  for (const path of ["/e/e-lab", "/e/e-lab/h/h-web", "/e/e-exam"]) {
    await open(page, path, 900);
    await page.getByRole("tab", { name: "Next" }).or(page.getByRole("status", { name: "Engagement status" })).first().waitFor();
    // Below 1000px the sidebar starts as the 56px rail (strip ~844px); expanded it is ~660px. LHOST outlasts Cleanup and Threads.
    const strip = page.getByRole("status", { name: "Engagement status" });
    for (const expanded of [false, true]) {
      await page.getByRole("button", { name: /(Expand|Collapse) sidebar/ }).waitFor();
      // The choice persists across pages, so press only when the sidebar is not already in the wanted state.
      if (await page.getByRole("button", { name: expanded ? "Expand sidebar" : "Collapse sidebar" }).isVisible()) await page.keyboard.press("Meta+B");
      await page.getByRole("button", { name: expanded ? "Collapse sidebar" : "Expand sidebar" }).waitFor();
      await expect(strip.getByRole("link", { name: /LHOST/ }), `${path}: LHOST, sidebar ${expanded ? "expanded" : "collapsed"}`).toBeVisible();
    }
    // Nothing hidden that would have fit: un-hide the first hidden part and it must overflow.
    const wasteful = await strip.evaluate((el) => {
      const box = el.firstElementChild as HTMLElement;
      const hidden = [...box.querySelectorAll<HTMLElement>("[data-drop]")]
        .filter((p) => p.style.display === "none")
        .sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop));
      if (!hidden.length) return false;
      hidden[hidden.length - 1].style.display = "";
      const fits = box.scrollWidth <= box.clientWidth;
      hidden[hidden.length - 1].style.display = "none";
      return fits;
    });
    expect(wasteful, `${path}: the last dropped part would still fit`).toBe(false);
    expect(await strip.evaluate((el) => el.firstElementChild!.scrollWidth <= el.firstElementChild!.clientWidth), `${path}: strip content fits`).toBe(true);
  }
});

test("headers: actions are icon buttons under 1000px, so the title keeps its room", async ({ page }) => {
  await open(page, LAB_HOST, 900);
  await page.getByRole("tab", { name: "Next" }).waitFor();
  await expect(page.getByRole("button", { name: "Edit host" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stuck?" })).toBeVisible();
  await open(page, "/e/e-lab", 900);
  await expect(page.getByRole("button", { name: "Edit engagement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  await open(page, "/e/e-lab", 1440);
  if (await page.getByRole("button", { name: "Expand sidebar" }).isVisible()) await page.keyboard.press("Meta+B");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
});

test("title bar controls end where the centred page column ends (dashboard, settings)", async ({ page }) => {
  for (const [path, right] of [["/", 1440], ["/", 900], ["/", 1024], ["/settings", 1280], ["/settings", 900]] as const) {
    await open(page, path, right);
    const gear = await page.getByRole("button", { name: "Settings" }).evaluate((el) => el.getBoundingClientRect().right);
    const col = await page.evaluate(() => {
      const root = document.querySelector("[data-testid=app-root], [data-testid=settings-root]");
      const r = (root as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(root as HTMLElement);
      return r.right - parseFloat(cs.paddingRight);
    });
    expect(Math.abs(gear - col), `${path} @${right}: gear right edge vs content right edge`).toBeLessThanOrEqual(1);
    const g = await page.getByRole("button", { name: "Settings" }).evaluate((el) => {
      const svg = el.querySelector("svg")!.getBoundingClientRect();
      return { w: el.getBoundingClientRect().width, svg: svg.width, color: getComputedStyle(el).color };
    });
    expect([g.w, g.svg], `${path} @${right}: 28px box with a 16px gear`).toEqual([28, 16]);
    // Accent lime on /settings only (accent is #c6ff3d-ish: green channel far above blue).
    const lime = (c: string) => { const [r, gr, b] = c.match(/\d+/g)!.map(Number); return gr > 200 && b < 120 && r > 120; };
    expect(lime(g.color), `${path} @${right}: gear accent only on /settings`).toBe(path === "/settings");
  }
});
