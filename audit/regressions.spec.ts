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
