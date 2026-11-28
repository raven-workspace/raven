import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { AUDIT_NOTE_IDS, AUDIT_NOW, FIXTURES } from "../src/audit/fixtures";
import { MEANS_HEADER } from "../src/engines/manual/lookup";
import { caretAtEnd, garnetOutput, openGarnet, openReportItem, openReportPart, SCREENS } from "./screens";

// Hard regressions: unlike the audit checks, these fail the run.

/**
 * Waits for the app shell: the title bar's Search button, which is up only past the vault gate, where ⌘K is bound.
 * Its accessible name is exactly "Search" (the ⌘K key cap is aria-hidden). It's matched exactly because a looser
 * /Search/ also matches command copy buttons, such as "Copy command: Search the disk for …" on a host page.
 */
async function waitForShell(page: Page) {
  await page.getByRole("button", { name: "Search", exact: true }).waitFor();
}

for (const path of ["/arsenal", "/"]) {
  test(`search from ${path}: the field stays usable next to a long engagement name`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install({ time: AUDIT_NOW });
    await page.goto(path);
    await waitForShell(page);
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
  // Inside the host page's container (or the finding split's, which takes the same name), whatever class declares it.
  const inHost = (el) => { for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).containerName === "host") return true; return false; };
  const focusables = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  for (const el of focusables) {
    if (!visible(el)) continue;
    let pane = el.parentElement;
    while (pane && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (!pane || pane === document.body) continue;
    // Overlay scrollbars (macOS WKWebView) reserve no gutter: the pane itself must pad the right edge.
    if (inHost(pane) && parseFloat(getComputedStyle(pane).paddingRight) < 12) bad.push("padding-right < 12px: " + (pane.getAttribute("aria-label") || pane.className.slice(0, 40)));
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
    await waitForShell(page);
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
  await waitForShell(page);
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
  // One row per e-lab host in the fixtures, each showing its short name and its own IP.
  const ips: Record<string, string> = Object.fromEntries(
    FIXTURES.hosts.filter((h) => h.engagementId === "e-lab").map((h) => [h.name.split(".")[0], h.ip ?? ""]),
  );
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
    // One box per engagement section (seven since Network).
    expect(geo.sections).toHaveLength(7);
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

test("host picker is a Tab stop", async ({ page }) => {
  await open(page, FS01, 1280);
  await page.keyboard.press("Meta+K");
  const search = page.getByRole("dialog").getByRole("combobox", { name: "Search" });
  await search.waitFor();
  await search.fill("smb");
  const chip = page.getByRole("button", { name: /^Fill for host/ });
  await expect(chip).not.toHaveAttribute("tabindex", "-1");
  let reached = false;
  for (let i = 0; i < 8 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await chip.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  // Triage 8e: the focused picker shows a ring (it used to be an opacity-0 native select with no visible focus).
  const ring = await chip.evaluate((el) => {
    const s = getComputedStyle(el);
    return { visible: s.opacity !== "0" && s.visibility !== "hidden", outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1 };
  });
  expect(ring).toEqual({ visible: true, outline: true });
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
  await expect(page.getByText("{SECOND_LPORT} not filled. Press ↵ again to copy anyway")).toBeVisible();
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
  // Categories are a tablist (each tab names its category and its match count).
  await expect(page.getByRole("tab", { name: /^Pivoting/ })).toBeVisible();
  await page.getByRole("tab", { name: /^Pivoting/ }).click();
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
  "$ nxc smb 10.10.20.10 -u zoe omar -p 'Synth123!' 'Guess1' --continue-on-success",
  "SMB  10.10.20.10  445  DC01  [+] acme.corp\\zoe:Synth123! (Pwn3d!)",
  "SMB  10.10.20.10  445  DC01  [-] acme.corp\\omar:Guess1 STATUS_LOGON_FAILURE",
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
  await expect(toast.getByText(/zoe:Synth123! works on SMB/)).toBeVisible();

  // The new entry's own Extracted line shows without a reload.
  await page.getByRole("tab", { name: "Log" }).click();
  await page.getByRole("button", { name: /nxc/ }).first().click();
  const extracted = page.getByRole("button", { name: /Extracted: zoe:Synth123! works on SMB/ });
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
    await expect(tried.first()).toContainText("omar");
    await expect(tried.first()).toContainText("tried");
    await expect(tried.first()).toHaveClass(/test-grid__row--tried/); // muted (TestGrid.scss)
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

// Owner, 2026-11-10: the drawer's pickers flow in runs, so any of them can end a line at the drawer's right edge. Its
// list must open from that side instead of running past the drawer.
test("payloads drawer: every picker list stays inside the drawer", async ({ page }) => {
  for (const path of [IIS, "/e/e-lab/h/h-sql01"]) {
    for (const width of PAYLOADS_WIDTHS) {
      const aside = await openDrawer(page, path, width);
      await aside.getByRole("button", { name: /^Port:/ }).waitFor();
      const pickers = aside.locator("[data-picker-trigger][aria-haspopup='listbox']");
      for (let i = 0; i < (await pickers.count()); i++) {
        const name = await pickers.nth(i).getAttribute("aria-label");
        await pickers.nth(i).click();
        const list = page.locator(`[id="${await pickers.nth(i).getAttribute("aria-controls")}"]`);
        await list.waitFor();
        const [box, pane] = [(await list.boundingBox())!, (await aside.boundingBox())!];
        expect(box.x + box.width, `${name} list right edge, ${path} at ${width}`).toBeLessThanOrEqual(pane.x + pane.width);
        expect(box.x, `${name} list left edge, ${path} at ${width}`).toBeGreaterThanOrEqual(pane.x);
        await page.keyboard.press("Escape");
        await list.waitFor({ state: "detached" });
      }
    }
  }
});

test("payloads drawer and workbench: no pane scrolls sideways or clips focus", async ({ page }) => {
  for (const width of PAYLOADS_WIDTHS) {
    const aside = await openIisDrawer(page, width);
    // The long host name and "Paste into Web shell ?cmd=" share the chip row; every generator tab shows.
    await expect(aside.getByRole("button", { name: /^Paste into: Web shell \?cmd=/ })).toBeVisible();
    expect(await truncatedChips(aside), `chips cut short at ${width}`).toEqual([]);
    await aside.getByRole("button", { name: /^Don't fit here \(\d+\)$/ }).click();
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
    page.locator(`${root} pre[aria-label='Command: Payload']`).evaluate((el) => {
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
  const shown = await aside.locator("pre[aria-label='Command: Payload']").textContent();
  expect(shown).toMatch(/^powershell/);
  // A sentinel, so a stale or empty clipboard cannot pass.
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
});

test("a payload that failed here stays a fit, marked, and sorts below the unmarked ones", async ({ page }) => {
  const aside = await openIisDrawer(page, 1280);
  // A marked payload sorts down but stays a fit (spec 2b-C): nc.exe -e failed here before, so it is listed with the mark.
  const fits = aside.getByRole("listbox", { name: "Fits" }).getByRole("option");
  const nc = fits.filter({ hasText: "nc.exe -e" }).filter({ hasNotText: "bind" });
  await expect(nc).toHaveCount(1);
  await expect(nc).toContainText("Failed here before");
  const names = await fits.evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  const firstMarked = names.findIndex((t) => t.includes("Failed here before"));
  expect(firstMarked, "a marked fit exists").toBeGreaterThan(0);
  expect(names.slice(firstMarked).every((t) => t.includes("Failed here before") || /Needs /.test(t)), "marked fits sort below the unmarked").toBe(true);
});

test("an uploaded file's name keeps its case in the heading (no text-transform)", async ({ page }) => {
  for (const width of PAYLOADS_WIDTHS) {
    const aside = await openIisDrawer(page, width);
    await aside.getByRole("button", { name: /^Paste into: / }).click();
    await page.getByRole("option", { name: /^Uploaded file/ }).click();
    const file = aside.locator("h3 [data-upload-file]");
    await expect(file).toHaveText("shell.php");
    expect(await file.evaluate((el) => getComputedStyle(el).textTransform), `file name text-transform at ${width}`).toBe("none");
    // The words around it are still the label style.
    expect(await file.evaluate((el) => getComputedStyle(el.parentElement!).textTransform)).toBe("uppercase");
  }
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

// Owner, 2026-11-10: header actions sit right after the title at every width, never out at the pane's far edge.
test("headers: actions are icon buttons right after the title, at every width", async ({ page }) => {
  await open(page, LAB_HOST, 900);
  await page.getByRole("tab", { name: "Next" }).waitFor();
  await expect(page.getByRole("button", { name: "Edit host" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stuck?" })).toBeVisible();
  for (const width of [900, 1440]) {
    await open(page, "/e/e-lab", width);
    const edit = page.getByRole("button", { name: "Edit engagement" });
    await expect(edit).toBeVisible();
    await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
    const title = (await page.getByRole("heading", { level: 1 }).first().boundingBox())!;
    const pencil = (await edit.boundingBox())!;
    expect(pencil.x - (title.x + title.width), `pencil follows the title at ${width}`).toBeLessThanOrEqual(8);
  }
});

// Owner, 2026-11-09 (adc414c, 1f74942): the title bar is pinned to the window edges on every screen: the controls at
// pr-6 (24px from the right), the wordmark 94px from the left (the traffic lights' 78px plus 16px). It no longer
// follows the centred page column.
const TITLE_BAR_CASES = [
  ...(["/", "/settings", LAB_HOST] as const).flatMap((path) => [900, 1024, 1440].map((width) => [path, width] as const)),
  ["/settings", 1280] as const,
];

test("title bar: wordmark at the window's left inset, controls at its right edge (dashboard, settings, host)", async ({ page }) => {
  for (const [path, width] of TITLE_BAR_CASES) {
    await open(page, path, width);
    const bar = page.locator("[data-tauri-drag-region]").first();
    const mark = await bar.getByRole("img", { name: "Raven" }).evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(mark - 94), `${path} @${width}: wordmark left edge at 94px`).toBeLessThanOrEqual(1);
    const gear = await page.getByRole("button", { name: "Settings" }).evaluate((el) => el.getBoundingClientRect().right);
    expect(Math.abs(gear - (width - 24)), `${path} @${width}: gear right edge vs the window's right edge less pr-6`).toBeLessThanOrEqual(1);
    const g = await page.getByRole("button", { name: "Settings" }).evaluate((el) => {
      const svg = el.querySelector("svg")!.getBoundingClientRect();
      return { w: el.getBoundingClientRect().width, svg: svg.width, color: getComputedStyle(el).color };
    });
    expect([g.w, g.svg], `${path} @${width}: 28px box with a 16px gear`).toEqual([28, 16]);
    // Accent lime on /settings only (accent is #c6ff3d-ish: green channel far above blue).
    const lime = (c: string) => { const [r, gr, b] = c.match(/\d+/g)!.map(Number); return gr > 200 && b < 120 && r > 120; };
    expect(lime(g.color), `${path} @${width}: gear accent only on /settings`).toBe(path === "/settings");
  }
});

test("a screenshot's caption shows only when it says more than the title", async ({ page }) => {
  await open(page, "/e/e-lab/s/log", 1024);
  const log = page.getByRole("region", { name: "Log" });
  await log.getByRole("button", { name: /Cropped proof of the hostname/ }).click();
  await log.getByRole("button", { name: /Desktop of the file server/ }).click();
  await expect(log.locator("li img")).toHaveCount(2);
  // Caption = title (as capture saves it): the title is the only line saying it.
  await expect(log.getByText("Cropped proof of the hostname", { exact: true })).toHaveCount(1);
  // A caption that adds to its title still shows (positive control).
  await expect(log.getByText("Desktop of the file server: the finance share is mapped as F:", { exact: true })).toBeVisible();
});

test("capture: the screenshot's file name is labelled, not loose under the caption", async ({ page }) => {
  const screen = SCREENS.find((s) => s.id === "capture-image")!;
  await open(page, screen.path, 1024);
  await screen.setup!(page);
  const dialog = page.getByRole("dialog");
  const row = dialog.getByTestId("capture-file-name");
  await expect(row).toContainText("Saved as");
  await expect(row).toContainText(".png");
  // Label and name share a line.
  const [label, name] = await row.locator("span").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(Math.abs(label - name)).toBeLessThan(6);
});

test("payloads: the Other… port field opens under the Port chip and keeps the drawer its width", async ({ page }) => {
  for (const width of [900, 1024]) {
    const aside = await openIisDrawer(page, width);
    const before = await aside.evaluate((el) => el.scrollWidth);
    await aside.getByRole("button", { name: /^Port/ }).click();
    await page.getByRole("option", { name: /Other/ }).click();
    const field = aside.getByRole("textbox", { name: "Custom port" });
    await expect(field).toBeFocused();
    const chip = (await aside.getByRole("button", { name: /^Port/ }).boundingBox())!;
    const box = (await field.boundingBox())!;
    const drawer = (await aside.boundingBox())!;
    expect(box.y, `field under the chip at ${width}`).toBeGreaterThanOrEqual(chip.y + chip.height);
    expect(Math.abs(box.x - chip.x), `field lines up with the chip at ${width}`).toBeLessThan(2);
    expect(box.x + box.width, `field inside the drawer at ${width}`).toBeLessThanOrEqual(drawer.x + drawer.width);
    expect(await aside.evaluate((el) => el.scrollWidth), `drawer width unchanged at ${width}`).toBe(before);
    expect(await page.evaluate(CLIPPED(DRAWER)), `drawer controls with the port field at ${width}`).toEqual([]);
    await page.keyboard.type("8443");
    await page.keyboard.press("Enter");
    await expect(aside.getByRole("button", { name: /^Port: 8443/ })).toBeVisible();
  }
});

// The Manual's five-column table: as a table its auto layout squeezed the code columns until every status code broke
// mid-token. Now a table that can't fit its codes stacks each row as name/value lines; one that can stays a table.
test("Manual: a wide table stacks when its codes don't fit, stays a table when they do, and no code breaks", async ({ page }) => {
  // The pane is wider at 1024 (no outline column) than at 1280 (the outline appears at 1100px); at 1024 the table still
  // stacks, as its means column would fall under its 14ch floor (it sat at ~12ch before the floor).
  for (const [width, stacked] of [[900, true], [1024, true], [1280, true], [1440, false]] as const) {
    await open(page, `/manual/${AUDIT_NOTE_IDS.long}`, width);
    const pane = page.getByRole("region", { name: "Note" });
    const table = pane.locator("[id='table-1'] + div table");
    await table.waitFor();
    expect(await table.getAttribute("data-stacked"), `stacked at ${width}`).toBe(stacked ? "" : null);
    // Stacked, each value shows its column name; as a table the header row does.
    await expect(table.getByRole("cell").first().locator("[data-column-label]")).toBeVisible({ visible: stacked });
    await expect(table.getByRole("columnheader").first()).toBeVisible({ visible: !stacked });
    const [t, p] = await Promise.all([table.boundingBox(), pane.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { right: r.left + el.clientWidth - parseFloat(getComputedStyle(el).paddingRight) };
    })]);
    expect(t!.x + t!.width, `table inside the pane at ${width}`).toBeLessThanOrEqual(p.right + 0.5);
    const broken = await table.evaluate((el) => [...el.querySelectorAll("code")].filter((c) => {
      const tops = new Set([...c.getClientRects()].map((r) => Math.round(r.top)));
      return tops.size > 1;
    }).map((c) => c.textContent));
    expect(broken, `codes on one line at ${width}`).toEqual([]);
  }
});

// A flags table (Flag | Does): auto layout squeezed the flag column until `-m MODE` broke at its space while the
// description column had room to spare. A short key cell now keeps to one line and its column sizes to it.
test("Manual: short key cells in a flags table stay on one line", async ({ page }) => {
  for (const width of [1280, 1440]) {
    await open(page, `/manual/${AUDIT_NOTE_IDS.long}`, width);
    const pane = page.getByRole("region", { name: "Note" });
    const table = pane.locator("[id='table-6'] + div table");
    await table.scrollIntoViewIfNeeded();
    expect(await table.getAttribute("data-stacked"), `a table at ${width}`).toBeNull();
    const keys = await table.evaluate((el) => [...el.querySelectorAll("tbody tr")].map((tr) => {
      const code = tr.querySelector("td code")!;
      const lineHeight = parseFloat(getComputedStyle(code).lineHeight);
      const tops = new Set([...code.getClientRects()].map((r) => Math.round(r.top)));
      return { text: code.textContent, lines: tops.size, oneLine: code.getBoundingClientRect().height <= lineHeight * 1.5 };
    }));
    expect(keys.length, `flag rows at ${width}`).toBe(5);
    for (const k of keys) {
      expect(k.lines, `${k.text} on one line at ${width}`).toBe(1);
      expect(k.oneLine, `${k.text} one line tall at ${width}`).toBe(true);
    }
    const [t, p] = await Promise.all([table.boundingBox(), pane.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { right: r.left + el.clientWidth - parseFloat(getComputedStyle(el).paddingRight) };
    })]);
    expect(t!.x + t!.width, `table inside the pane at ${width}`).toBeLessThanOrEqual(p.right + 0.5);
  }
});

// A lookup table's Means column was squeezed to a word or two a line at 900px while the table stayed a table. Prose
// columns now keep a 14ch floor that counts in the fit: the cause column drops, then the table stacks, before that.
test("Manual: a lookup table's prose (means) column is never narrower than 14ch in table layout", async ({ page }) => {
  for (const id of [AUDIT_NOTE_IDS.lookup, AUDIT_NOTE_IDS.long]) {
    for (const width of [900, 1024, 1280, 1440]) {
      await open(page, `/manual/${id}`, width);
      const pane = page.getByRole("region", { name: "Note" });
      await pane.locator("table").first().waitFor();
      const r = await pane.evaluate((el, src) => {
        const means = new RegExp(src, "i");
        const out: { table: number; text: string; width: number; floor: number }[] = [];
        let tables = 0;
        el.querySelectorAll("table").forEach((t, ti) => {
          if (t.hasAttribute("data-stacked")) return;
          const heads = [...t.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
          const col = heads.findIndex((h) => means.test(h));
          if (col < 0) return;
          tables++;
          for (const tr of t.querySelectorAll("tbody tr")) {
            const td = tr.children[col] as HTMLElement | undefined;
            if (!td) continue;
            const probe = document.createElement("span");
            probe.style.cssText = "position:absolute;visibility:hidden;width:14ch";
            td.append(probe);
            const floor = probe.getBoundingClientRect().width;
            probe.remove();
            out.push({ table: ti, text: (td.textContent ?? "").slice(0, 40), width: td.getBoundingClientRect().width, floor });
          }
        });
        return { tables, narrow: out.filter((c) => c.width < c.floor - 0.5) };
      }, MEANS_HEADER.source);
      expect(r.narrow, `prose cells under 14ch in ${id} at ${width}`).toEqual([]);
      // The lookup note's table stays a table at the wide sizes, so the check is not vacuous there.
      if (id === AUDIT_NOTE_IDS.lookup && width >= 1280) expect(r.tables, `a measured lookup table at ${width}`).toBeGreaterThan(0);
    }
  }
});

// Note links and card links sat in 16-18px lines: under the 24px target floor when they stand alone (a list item, a cell).
test("Manual: every link in a note is a 24px target", async ({ page }) => {
  await open(page, `/manual/${AUDIT_NOTE_IDS.links}`, 1280);
  const note = page.locator("section[aria-label='Note'] article");
  await note.getByRole("button", { name: "the card" }).waitFor();
  const small = await note.evaluate((el) => [...el.querySelectorAll("a, button")]
    .map((c) => ({ name: c.textContent, h: c.getBoundingClientRect().height }))
    .filter((c) => c.h < 24));
  expect(small).toEqual([]);
});

// The outline's scroll-spy and lime bar, in a real layout: the current entry follows the reading, the bar sits beside
// it, and a pick scrolls the note in place without a history entry (Esc leaves the Manual in one press).
test("Manual: On this page follows the scroll, and a pick adds no history entry", async ({ page }) => {
  // Short window: the outline shows every h2 and only the current section's entries, so it overflows only when short.
  await open(page, `/manual/${AUDIT_NOTE_IDS.long}`, 1440, 240);
  const aside = page.locator("aside[aria-label='Outline']");
  const current = aside.locator("[aria-current=location]");
  await expect(current).toHaveText("Core concept");
  const pane = page.getByRole("region", { name: "Note" });
  await pane.evaluate((el) => (el.scrollTop = el.querySelector("#kerberos")!.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop));
  await expect(current).toHaveText("Kerberos");
  await pane.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(current).toHaveText("Related");
  // The aside followed the outline to its end; its label stays on top, and the current entry clear of it.
  await expect.poll(() => aside.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const [box, head, row] = await Promise.all([
    aside.boundingBox(), aside.getByRole("heading", { name: "On this page" }).boundingBox(), current.boundingBox(),
  ]);
  expect(Math.abs(head!.y - box!.y)).toBeLessThan(1);
  expect(row!.y).toBeGreaterThanOrEqual(head!.y + head!.height - 1);
  const bar = aside.getByTestId("section-indicator");
  await expect(async () => {
    const [b, c] = await Promise.all([bar.boundingBox(), current.boundingBox()]);
    expect(Math.abs(b!.y - c!.y)).toBeLessThan(1);
    expect(Math.abs(b!.height - c!.height)).toBeLessThan(1);
  }).toPass();
  const before = await page.evaluate(() => history.length);
  await aside.getByRole("button", { name: "Is this normal?", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Is this normal?" })).toBeFocused();
  await expect(current).toHaveText("Is this normal?");
  await expect.poll(() => pane.evaluate((el) => {
    const h = el.querySelector("#is-this-normal")!;
    return Math.round(h.getBoundingClientRect().top - el.getBoundingClientRect().top);
  })).toBeLessThan(40);
  expect(await page.evaluate(() => history.length)).toBe(before);
  expect(new URL(page.url()).hash).toBe("");
  await page.screenshot({ path: "audit-output/shots/manual-outline-pick@1440.png" });
});

// An inline command is a 24px target, but must not make its line taller than a line without one (text-read is 26px).
test("Manual: a prose line or list item holding an inline command is as tall as one without", async ({ page }) => {
  await open(page, `/manual/${AUDIT_NOTE_IDS.tool}`, 1280);
  const article = page.locator("section[aria-label='Note'] article[aria-label='Zz Scanner']");
  await article.getByRole("button", { name: /^Copy command: zzscan --list/ }).first().waitFor();
  const h = await article.evaluate((el) => {
    const pick = (sel: string, withCmd: boolean) => [...el.querySelectorAll(sel)].find((n) => !!n.querySelector('button[aria-label^="Copy command"]') === withCmd && /(Plain|with nothing|in it)/.test(n.textContent ?? ""))!.getBoundingClientRect().height;
    return { p: [pick("p", false), pick("p", true)], li: [pick("li", false), pick("li", true)] };
  });
  expect(h.p[1], "paragraph with an inline command").toBe(h.p[0]);
  expect(h.li[1], "list item with an inline command").toBe(h.li[0]);
});

// The subnet in "eth1 … reaches 172.16.5.0/24" is a 24px target, but must not make its sentence taller than one line.
test("Interfaces: the inline subnet is a 24px target and keeps its line height", async ({ page }) => {
  await open(page, LAB_HOST, 1280);
  const p = page.locator("section[aria-label='Network interfaces'] li p").first();
  await p.waitFor();
  const h = await p.evaluate((el) => {
    const btn = el.querySelector("button")!;
    const sized = { btn: btn.getBoundingClientRect().height, line: el.getBoundingClientRect().height };
    // The same sentence with a plain inline button: the height the line would have without the 24px target.
    btn.style.cssText = "display:inline;min-height:0;margin:0";
    return { ...sized, plain: el.getBoundingClientRect().height };
  });
  expect(h.btn).toBeGreaterThanOrEqual(24);
  expect(h.line, "not grown by the button").toBe(h.plain);
});

// ---------------------------------------------------------------- Report: the page as a grader reads it

/** The owner's window: about 1400 wide, the sidebar folded to its rail, so the evidence rail is a column. */
async function openReportAt1400(page: Page, target: string) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/s/report");
  const fold = page.getByRole("button", { name: "Collapse sidebar" });
  await fold.first().waitFor();
  await fold.first().click();
  await openReportItem(target)(page);
  await page.locator(".report-page .ProseMirror > *").first().waitFor();
}

/** Runs a check in Chromium (the test's page), then in WebKit at the owner's 1400x900: the owner's app is a WKWebView. */
async function inBothEngines(page: Page, playwright: { webkit: { launch(): Promise<Browser> } }, baseURL: string | undefined, run: (p: Page) => Promise<void>) {
  await run(page);
  const browser = await playwright.webkit.launch();
  try {
    await run(await browser.newPage({ baseURL, viewport: { width: 1400, height: 900 } }));
  } finally {
    await browser.close();
  }
}

test("Report: code shows the characters typed, with no font ligatures", async ({ page }) => {
  await openReportAt1400(page, "garnet");
  const code = page.locator(".report-page .report-code").first();
  expect(await code.evaluate((el) => getComputedStyle(el).fontVariantLigatures)).toBe("none");
});

test("Report: the formatting bar fits its pane at 1400 with the evidence rail open, the core controls in reach", async ({ page }) => {
  await openReportAt1400(page, "garnet");
  await expect(page.getByRole("tablist", { name: "Evidence" })).toBeVisible();
  const bar = page.getByRole("toolbar", { name: "Formatting" });
  const add = page.getByRole("button", { name: "Add new evidence" });
  const barBox = (await bar.boundingBox())!;
  const addBox = (await add.boundingBox())!;
  // Every control on the bar ends before Add new evidence; the rest are under More.
  const rights = await bar.locator("button, [role=combobox]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  for (const r of rights) expect(r).toBeLessThanOrEqual(addBox.x);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(addBox.x);
  // The owner's order of what must stay: the core marks, the headings, the two lists, undo and redo.
  const kept = ["Bold", "Italic", "Inline code", "Link", "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Undo", "Redo"];
  for (const name of kept) await expect(bar.getByRole("button", { name })).toBeVisible();
  // Find and replace is in reach: on the bar when it fits, else under More.
  const find = bar.getByRole("button", { name: "Find and replace" });
  if (!(await find.isVisible())) {
    await bar.getByRole("button", { name: "More formatting" }).click();
    await expect(page.getByRole("dialog", { name: "More formatting" }).getByRole("button", { name: "Find and replace" })).toBeVisible();
  }
});

test("Report: Esc closes the evidence drawer and stays on the report, in WebKit too", async ({ page, playwright, baseURL }) => {
  // A 1200 window with the sidebar open: under 1000px of pane, so the rail is a drawer. The drawer mounts after the
  // engagement's own Esc (back to the dashboard), which once heard the key first.
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1200, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    await openGarnet(p);
    await p.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true }).click();
    const drawer = p.locator("aside.evidence-drawer[aria-label='Evidence']");
    await expect(drawer).toBeVisible();
    await p.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    expect(new URL(p.url()).pathname).toBe("/e/e-exam/s/report");
  });
});

test("Report: at the owner's 1400 with the sidebar open, the evidence column opens beside the page, never over it, in WebKit too", async ({ page, playwright, baseURL }) => {
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    await openGarnet(p);
    await expect(p.getByRole("button", { name: "Collapse sidebar" }).first()).toBeVisible();
    const toggle = p.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true });
    const paper = p.locator(".report-page");
    const closedWidth = (await paper.boundingBox())!.width;
    await toggle.click();
    const column = p.locator("aside[aria-label='Evidence']");
    await expect(column.getByRole("tablist", { name: "Evidence" })).toBeVisible();
    expect(await column.evaluate((el) => getComputedStyle(el).position), "docked, not a drawer").not.toBe("fixed");
    const page_ = (await paper.boundingBox())!;
    const col = (await column.boundingBox())!;
    expect(page_.x + page_.width).toBeLessThanOrEqual(col.x + 0.5);
    expect(page_.width, "the paper narrows").toBeLessThan(closedWidth);
    // The paper keeps a readable measure, and its code blocks stay inside it.
    const text = (await p.locator(".report-page .ProseMirror").boundingBox())!;
    expect(text.width).toBeGreaterThanOrEqual(560);
    const over = await p.locator(".report-page .ProseMirror pre").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(over).toBe(0);
    // A toggle the owner controls: the strip's Evidence button closes it again and the paper takes the room back.
    await toggle.click();
    await expect(column).toHaveCount(0);
    await expect.poll(async () => (await paper.boundingBox())!.width).toBe(closedWidth);
  });
});

test("Report: every block type takes typing and the log stays as it was, in WebKit", async ({ page, playwright, baseURL }) => {
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    await openGarnet(p);
    const doc = p.locator(".report-page .ProseMirror");
    const notesColumn = await doc.locator("table").first().locator("tr").first().locator("th, td").evaluateAll((cells) => cells.findIndex((c) => c.textContent?.trim() === "Notes"));
    expect(notesColumn, "the ports table has a Notes column").toBeGreaterThanOrEqual(0);
    const blocks: [string, Locator][] = [
      ["paragraph", doc.locator(":scope > p").filter({ hasText: /^Vulnerability explanation:/ }).first()],
      ["step sentence", doc.locator("[data-list-kind='ordered'] .list-content > p").first()],
      ["code block", garnetOutput(p).locator("pre")],
      ["ports Notes cell", doc.locator("table").first().locator("tr").nth(1).locator("td").nth(notesColumn)],
      ["figure caption", doc.locator("figcaption").first()],
    ];
    const xs = (l: Locator) => l.evaluate((el) => (el.textContent ?? "").split("X").length - 1);
    for (const [name, block] of blocks) {
      const before = await xs(block);
      await caretAtEnd(p, block);
      await p.keyboard.type("X");
      await expect.poll(() => xs(block), name).toBe(before + 1);
    }
    // The summary's first hint paragraph: empty, its hint showing, until the owner types.
    await openReportPart("Front matter", "Summary")(p);
    const hint = p.locator(".report-page .ProseMirror > p[data-hint]").first();
    const hintText = await hint.getAttribute("data-hint");
    await hint.click();
    await p.waitForTimeout(150);
    await p.keyboard.type("X");
    const typed = p.locator(".report-page .ProseMirror > p", { hasText: /^X$/ });
    await expect(typed, "summary hint paragraph").toHaveCount(1);
    // Its hint no longer shows: no empty hint paragraph carries that hint any more.
    const stillShown = await p.locator(".report-page .ProseMirror > p.report-hint").evaluateAll((els, h) => els.filter((e) => e.getAttribute("data-hint") === h).length, hintText);
    expect(stillShown).toBe(0);
    // The page is the owner's copy: the command's output in the log is what the terminal printed.
    await p.getByRole("link", { name: /^Log\b/ }).first().click();
    await expect.poll(() => new URL(p.url()).pathname).toBe("/e/e-exam/s/log");
    await p.getByText("Identify the Jenkins version", { exact: true }).click();
    const output = p.locator("pre").filter({ hasText: /^X-Jenkins: 2\.401\.3/ });
    await expect(output).toHaveText("X-Jenkins: 2.401.3");
  });
});

test("Report: consecutive blocks never touch, in WebKit at 1400", async ({ page, playwright, baseURL }) => {
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    await openGarnet(p);
    const gaps = await p.locator(".report-page .ProseMirror").evaluate((root) => {
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && getComputedStyle(el).display !== "none";
      };
      const out: { pair: string; gap: number; inList: boolean }[] = [];
      for (const parent of [root, ...root.querySelectorAll(".list-content")]) {
        const kids = [...parent.children].filter(shown);
        for (let i = 1; i < kids.length; i++) {
          const prev = kids[i - 1]!.getBoundingClientRect();
          const next = kids[i]!.getBoundingClientRect();
          const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").slice(0, 30)}"`;
          out.push({ pair: `${name(kids[i - 1]!)} → ${name(kids[i]!)}`, gap: Math.round((next.top - prev.bottom) * 10) / 10, inList: parent !== root });
        }
      }
      return out;
    });
    expect(gaps.length).toBeGreaterThan(20);
    expect(gaps.filter((g) => g.inList).length, "pairs inside a step").toBeGreaterThan(0);
    expect(gaps.filter((g) => g.gap < 8)).toEqual([]);
  });
});

test("Report: the notice sits clear of the sidebar, expanded and collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/s/report");
  await openGarnet(page);
  await page.getByRole("button", { name: "Add new evidence" }).click();
  const notice = page.locator("body > [role=status]");
  // The gap reserves the sidebar's width in the layout but has no height (never "visible"); the fixed container beside
  // it is the sidebar as drawn, and ends where the gap does.
  const sidebar = page.locator("[data-slot='sidebar-container']");
  const clearance = async () => {
    const gap = (await sidebar.boundingBox())!;
    return (await notice.boundingBox())!.x - (gap.x + gap.width);
  };
  await expect(sidebar).toBeVisible();
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  expect(await clearance()).toBeGreaterThanOrEqual(8);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
  // The notice may have closed itself (5s): ask again, and it opens where the folded sidebar leaves room.
  if (!(await notice.isVisible())) await page.getByRole("button", { name: "Add new evidence" }).click();
  await expect(notice).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect.poll(clearance).toBeGreaterThanOrEqual(8);
});

test("Report: a long note with an IP in the ports table stays in its cell and on the page, in WebKit", async ({ page, playwright, baseURL }) => {
  // The owner's app is WebKit (WKWebView), where an automatic table layout once let an IP overprint the next column.
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    await openGarnet(p);
    const table = p.locator(".report-page .ProseMirror table").first();
    const notes = await table.locator("tr").first().locator("th, td").evaluateAll((cells) => cells.findIndex((c) => c.textContent?.trim() === "Notes"));
    expect(notes).toBeGreaterThanOrEqual(0);
    await caretAtEnd(p, table.locator("tr").nth(1).locator("td").nth(notes));
    await p.keyboard.type("10.10.20.143 WORKSTATION-FINANCE-WWW-01 admin panel behind basic auth, default credentials rejected");
    await expect(table).toContainText("10.10.20.143");
    const result = await table.evaluate((t) => {
      const doc = t.closest(".ProseMirror")!;
      const style = getComputedStyle(doc);
      const contentRight = doc.getBoundingClientRect().right - parseFloat(style.paddingRight);
      const bad: string[] = [];
      for (const row of t.querySelectorAll("tr")) {
        const cells = [...row.querySelectorAll("th, td")];
        cells.forEach((c, i) => {
          if (c.scrollWidth > c.clientWidth + 1) bad.push(`cell ${i} overflows: "${c.textContent?.slice(0, 30)}"`);
          // The cell's text never reaches into the next cell.
          const range = document.createRange();
          range.selectNodeContents(c);
          const textRight = Math.max(...[...range.getClientRects()].map((r) => r.right), 0);
          const next = cells[i + 1];
          if (next && textRight > next.getBoundingClientRect().left + 0.5) bad.push(`cell ${i} overlaps cell ${i + 1}: "${c.textContent?.slice(0, 30)}"`);
        });
      }
      return { bad, tableRight: t.getBoundingClientRect().right, contentRight };
    });
    expect(result.bad).toEqual([]);
    expect(result.tableRight).toBeLessThanOrEqual(result.contentRight + 0.5);
  });
});

test("Report: table columns size to their content and a word that fits never breaks inside, in WebKit too", async ({ page, playwright, baseURL }) => {
  // Equal columns once broke "SeImpersonatePrivil|ege" and "CVE-|2023-0386" while # and Step wasted room.
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    /** The table whose header row starts with `first`: each column's width, and every word that fits its cell yet
     *  spans two lines. */
    const measure = async (first: string) => {
      const table = p.locator(".report-page .ProseMirror table").filter({ has: p.locator("tr:first-child > :first-child", { hasText: new RegExp(`^${first}$`) }) }).first();
      await expect(table).toBeVisible();
      // Laid out: a page just opened draws its table a frame after the heading.
      await expect.poll(() => table.locator("tr").first().locator("th, td").first().evaluate((c) => c.getBoundingClientRect().width)).toBeGreaterThan(0);
      return table.evaluate((t: HTMLTableElement) => {
        const widths = Object.fromEntries([...t.rows[0]!.cells].map((c) => [c.textContent?.trim() ?? "", c.getBoundingClientRect().width]));
        const broken: string[] = [];
        for (const cell of t.querySelectorAll("td, th")) {
          const style = getComputedStyle(cell);
          const room = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
            for (const m of n.data.matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(n, m.index);
              range.setEnd(n, m.index + m[0].length);
              const rects = [...range.getClientRects()].filter((r) => r.width > 0);
              const lines = new Set(rects.map((r) => Math.round(r.top)));
              const wide = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
              if (lines.size > 1 && wide <= room) broken.push(m[0]);
            }
          }
        }
        const range = document.createRange();
        const word = [...t.querySelectorAll("td")].flatMap((c) => {
          const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
          const out: [Text, number][] = [];
          for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
            const i = n.data.indexOf("SeImpersonatePrivilege");
            if (i >= 0) out.push([n, i]);
          }
          return out;
        })[0];
        let rects = -1;
        if (word) {
          range.setStart(word[0], word[1]);
          range.setEnd(word[0], word[1] + "SeImpersonatePrivilege".length);
          rects = range.getClientRects().length;
        }
        return { widths, broken, seImpersonateRects: rects };
      });
    };

    await openReportPart("Front matter", "Summary")(p);
    // With the evidence column docked: the paper at its narrowest at the owner's width.
    await p.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true }).click();
    await p.getByRole("tablist", { name: "Evidence" }).waitFor();
    const findings = await measure("#");
    expect(findings.broken, "words broken in the findings table").toEqual([]);
    expect(findings.seImpersonateRects, "SeImpersonatePrivilege on one line").toBe(1);
    expect(findings.widths["#"]!).toBeLessThan(findings.widths["Finding"]!);

    await openReportItem("AD set")(p);
    await p.locator(".report-page >> role=heading[name=/^5 Active Directory Set$/]").waitFor();
    const path = await measure("Step");
    expect(path.broken, "words broken in the attack path").toEqual([]);
    expect(path.widths["Step"]!).toBeLessThan(path.widths["Technique"]!);
  });
});

test("Report: a code token never reaches past its block, at the narrowest report width", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/s/report");
  await openGarnet(page);
  await page.locator(".report-page .report-token").first().waitFor();
  const past = await page.locator(".report-page .ProseMirror").evaluate((root) =>
    [...root.querySelectorAll(".report-token")].flatMap((t) => {
      const box = (t.closest("pre") ?? t.closest("p, td, th, figcaption"))!.getBoundingClientRect();
      const r = t.getBoundingClientRect();
      return r.right > box.right + 0.5 || r.left < box.left - 0.5 ? [`"${t.textContent}" ${Math.round(r.right - box.right)}px past`] : [];
    }),
  );
  expect(past).toEqual([]);
});

test("Report: dragging a screenshot's corner resizes it, and Full width puts it back, in WebKit too", async ({ page, playwright, baseURL }) => {
  await inBothEngines(page, playwright, baseURL, async (p) => {
    await p.setViewportSize({ width: 1400, height: 900 });
    await p.clock.install({ time: AUDIT_NOW });
    await p.goto("/e/e-exam/s/report");
    await openGarnet(p);
    const fig = p.locator(".report-page .report-plain-figure").first();
    await fig.scrollIntoViewIfNeeded();
    const img = fig.locator(".report-resizable img");
    await expect(img).toBeVisible();
    const before = (await img.boundingBox())!.width;
    await fig.hover();
    const handle = fig.locator(".report-resize-handle");
    await expect(handle).toBeVisible();
    const h = (await handle.boundingBox())!;
    await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await p.mouse.down();
    await p.mouse.move(h.x - 200, h.y - 100, { steps: 8 });
    await p.mouse.up();
    await expect.poll(async () => (await img.boundingBox())!.width).toBeLessThan(before - 100);
    // The size is the page's: Full width in the block menu clears it.
    await fig.hover();
    await p.getByRole("button", { name: "Block actions" }).first().click();
    await p.getByRole("menuitem", { name: "Full width" }).click();
    await expect.poll(async () => Math.round((await img.boundingBox())!.width)).toBe(Math.round(before));
  });
});

// The workspace status bar (design §1.7): as it narrows, cells drop in the strip's order (Listeners, Cleanup, Threads,
// Metasploit, then Flags and Rooted); LHOST and the timebox never drop. The exam sim has every cell but Threads.
test("workspace status bar: cells drop in order, LHOST and the timebox never", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.clock.install({ time: AUDIT_NOW });
  await page.goto("/e/e-exam/h/h-exam-dc01?workspace");
  const bar = page.locator(".status-bar[role=status]");
  await bar.getByRole("group", { name: "Cleanup 1" }).waitFor();
  const shown = () => bar.locator(".status-bar__cells > *").evaluateAll((els) =>
    els.filter((e) => getComputedStyle(e).display !== "none").map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").split(" ")[0]));
  // At the window's minimum only Listeners has gone.
  expect(await shown()).toEqual(["LHOST", "Rooted", "Flags", "Metasploit", "Cleanup"]);
  const seen: string[][] = [];
  for (const w of [1000, 900, 800, 700, 600, 470]) {
    await page.evaluate((w) => { document.querySelector<HTMLElement>("[data-slot=status-bar]")!.style.width = `${w}px`; }, w);
    await expect.poll(async () => (await shown()).length).toBeLessThanOrEqual(seen.at(-1)?.length ?? 5);
    seen.push(await shown());
    await expect(bar.getByRole("group", { name: "Timebox" })).toBeVisible();
  }
  const order = ["LHOST", "Rooted", "Flags", "Metasploit", "Cleanup"];
  // Each width shows a prefix of the order: the cells at the end go first.
  for (const s of seen) expect(s).toEqual(order.slice(0, s.length));
  expect(seen.at(-1)).toEqual(["LHOST"]);
});

// The rail (design §1.2): 56 × 36 slots with 28 × 28 buttons, the views 8px apart, the app group at the foot, and the
// current view's 2 × 20 accent bar at its slot's left edge, 8px down, following the route.
test("workspace rail: slots, buttons, app group at the foot, and the current-view bar on the route's view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e/e-lab?workspace");
  const rail = page.getByRole("navigation", { name: "Workspace" });
  await rail.getByRole("button", { name: "Board", exact: true }).waitFor();
  const geo = () => rail.evaluate((nav) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const slots = [...nav.querySelectorAll("[data-rail-slot]")];
    const current = nav.querySelector('[data-rail-slot][data-current="true"]');
    const bar = nav.querySelector("[data-tab-marker]")!;
    const before = getComputedStyle(bar, "::before");
    const b = box(bar);
    return {
      slots: slots.map((s) => [Math.round(box(s).width), Math.round(box(s).height)]),
      buttons: slots.map((s) => [Math.round(box(s.querySelector("button")!).width), Math.round(box(s.querySelector("button")!).height)]),
      gaps: slots.slice(1).map((s, i) => Math.round(box(s).top - box(slots[i]!).bottom)),
      current: current?.getAttribute("data-rail-slot") ?? null,
      bar: current ? { dx: Math.round(b.left - box(current).left), dy: Math.round(b.top - box(current).top) } : null,
      barSize: [before.width, before.height, before.top],
      appBottom: Math.round(nav.getBoundingClientRect().bottom - box(nav.querySelector("[aria-label='Settings']")!).bottom),
    };
  });
  const g = await geo();
  expect(g.slots.every(([w, h]) => w === 56 && h === 36)).toBe(true);
  expect(g.buttons.every(([w, h]) => w === 28 && h === 28)).toBe(true);
  // 8px between slots; 24 = 8 + the separator's 8 + 8, between Terminals and Board.
  expect(g.gaps).toEqual([8, 24, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
  expect(g.current).toBe("board");
  expect(g.bar).toEqual({ dx: 0, dy: 0 });
  expect(g.barSize).toEqual(["2px", "20px", "8px"]);
  expect(g.appBottom).toBe(8);
  await rail.getByRole("button", { name: "Network" }).click();
  await expect(page).toHaveURL(/\/s\/network/);
  await expect.poll(async () => (await geo()).current).toBe("network");
  expect((await geo()).bar).toEqual({ dx: 0, dy: 0 });
});
