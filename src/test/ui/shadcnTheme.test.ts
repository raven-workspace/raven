import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "../../lib/utils";
import { SHADCN_COLORS } from "../conventionsRules";

const ROOT = join(__dirname, "..", "..", "..");
const css = readFileSync(join(ROOT, "src/styles/global.css"), "utf8");
const tokens = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
const INK = new Set([...tokens.matchAll(/^\s*--([\w-]+):/gm)].map((m) => m[1]));

/** The `--name: value;` declarations of the shadcn alias block in global.css. */
function shadcnVars(): [string, string][] {
  const block = /shadcn aliases:[\s\S]*?:root\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  return [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
}

describe("shadcn Ink theme", () => {
  it("defines the shadcn colour variables shadcn components use", () => {
    const names = shadcnVars().map(([n]) => n);
    for (const n of ["background", "foreground", "popover", "primary", "border", "input", "ring", "destructive", "muted-foreground", "sidebar", "sidebar-foreground", "sidebar-accent", "sidebar-border", "sidebar-ring"])
      expect(names).toContain(n);
  });

  it("aliases every shadcn variable to an Ink token, never a new colour", () => {
    const vars = shadcnVars();
    expect(vars.length).toBeGreaterThan(10);
    for (const [name, value] of vars) {
      const m = /^var\(--([\w-]+)\)$/.exec(value);
      expect(m, `--${name}: ${value}`).not.toBeNull();
      expect(INK.has(m![1]), `--${name} -> --${m![1]}`).toBe(true);
    }
  });

  it("keeps Ink's own --accent and --muted (shadcn must not redefine them)", () => {
    const names = shadcnVars().map(([n]) => n);
    expect(names).not.toContain("accent");
    expect(names).not.toContain("muted");
    expect(css).not.toMatch(/oklch\(/);
  });

  it("the conventions allowlist names exactly the registered shadcn colours", () => {
    const registered = [...css.matchAll(/--color-([\w-]+):\s*var\(--\1\)/g)].map((m) => m[1]).sort();
    expect([...SHADCN_COLORS].sort()).toEqual(registered);
  });

  it("destructive is amber, not red", () => {
    expect(shadcnVars()).toContainEqual(["destructive", "var(--warn)"]);
  });

  it("cn keeps a Raven type role next to a colour", () => {
    expect(cn("text-body", "text-fg-2")).toBe("text-body text-fg-2");
    expect(cn("text-meta text-muted", "text-label")).toBe("text-muted text-label");
    expect(cn("h-8", "h-11")).toBe("h-11");
  });
});
