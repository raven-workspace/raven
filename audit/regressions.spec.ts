import { expect, test } from "@playwright/test";
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
});
