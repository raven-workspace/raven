import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./conventionsRules";

const config = (name: string) => JSON.parse(readFileSync(join(ROOT, "src-tauri", name), "utf8"));

// Tauri merges tauri.linux.conf.json over tauri.conf.json as a JSON merge patch, and a patch replaces an array whole.
// So the Linux file restates the window, and this keeps the copy from drifting: it is the base window minus the
// macOS-only chrome (docs/specs/terminal.md §3), which on Linux leaves the desktop's own title bar.
describe("Tauri config", () => {
  const base = config("tauri.conf.json");
  const linux = config("tauri.linux.conf.json");

  it("macOS keeps its overlay title bar", () => {
    expect(base.app.windows).toHaveLength(1);
    expect(base.app.windows[0]).toMatchObject({ titleBarStyle: "Overlay", hiddenTitle: true });
  });

  it("the Linux window is the base window without the macOS-only chrome", () => {
    const shared = { ...base.app.windows[0] };
    delete shared.titleBarStyle;
    delete shared.hiddenTitle;
    expect(linux.app.windows).toEqual([shared]);
  });

  it("Linux bundles only the .deb", () => {
    expect(linux.bundle.targets).toEqual(["deb"]);
  });
});
