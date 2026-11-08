import { describe, expect, it } from "vitest";
import { breaks, files } from "./conventionsRules";

const F = "src/features/x/X.tsx";
const U = "src/ui/X.tsx";

describe("feature-flex matcher", () => {
  it("sees plain string constants", () => {
    expect(breaks("feature-flex", F, 'const BOX = "inline-flex gap-2";')).toBe(
      true,
    );
    expect(breaks("feature-flex", F, "const base = 'flex gap-2';")).toBe(true);
  });
  it("sees nested cx( calls", () => {
    expect(
      breaks("feature-flex", F, 'cx(a(b), c && "p-2", "justify-between")'),
    ).toBe(true);
  });
  it("ignores prose, other files and flex-like words", () => {
    expect(
      breaks("feature-flex", F, 'const s = "Let it grow, then flex.";'),
    ).toBe(false);
    expect(breaks("feature-flex", F, 'const s = "grow";')).toBe(false);
    expect(
      breaks("feature-flex", F, '<div className="grid flexible-x" />'),
    ).toBe(false);
    expect(breaks("feature-flex", U, 'const BOX = "flex gap-2";')).toBe(false);
  });
  it("ignores comments", () => {
    expect(breaks("feature-flex", F, '// "flex gap-2"\nconst a = 1;')).toBe(
      false,
    );
  });
});

describe("hand-hint matcher", () => {
  it("flags two cap Kbds in one parent, however long the labels", () => {
    const long = "word ".repeat(80);
    expect(
      breaks("hand-hint", F, `<div><Kbd>a</Kbd> ${long} <Kbd>b</Kbd></div>`),
    ).toBe(true);
  });
  it("flags a cap Kbd rendered in .map", () => {
    expect(
      breaks("hand-hint", F, "<>{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</>"),
    ).toBe(true);
  });
  it("exempts inline Kbds in separate controls", () => {
    const src = `<div><Button>Save <Kbd variant="inline">⌘↵</Kbd></Button><Button>Cancel <Kbd variant="inline">esc</Kbd></Button></div>`;
    expect(breaks("hand-hint", F, src)).toBe(false);
  });
  it("allows cap Kbds in different parents and a lone cap", () => {
    expect(
      breaks(
        "hand-hint",
        F,
        "<div><p><Kbd>a</Kbd></p><p><Kbd>b</Kbd></p></div>",
      ),
    ).toBe(false);
    expect(breaks("hand-hint", F, "<Kbd>a</Kbd>")).toBe(false);
  });
  it("does not trip on arrow functions in attributes or generics", () => {
    const src = `const [a] = useState<string>(""); <div><Kbd onClick={() => go()}>a</Kbd></div>`;
    expect(breaks("hand-hint", F, src)).toBe(false);
  });
  it("exempts HintLine itself", () => {
    expect(
      breaks(
        "hand-hint",
        "src/ui/HintLine.tsx",
        "<div><Kbd>a</Kbd><Kbd>b</Kbd></div>",
      ),
    ).toBe(false);
  });
});

describe("esc-close matcher", () => {
  it("catches text, expression children and props with =>", () => {
    expect(breaks("esc-close", U, "<Kbd>esc</Kbd>")).toBe(true);
    expect(breaks("esc-close", U, '<Kbd>{"esc"}</Kbd>')).toBe(true);
    expect(breaks("esc-close", U, "<Kbd>{'Esc'}</Kbd>")).toBe(true);
    expect(breaks("esc-close", U, "<Kbd onClick={() => x()}> ESC </Kbd>")).toBe(
      true,
    );
  });
  it("ignores other keys", () => {
    expect(breaks("esc-close", U, "<Kbd>⌘K</Kbd>")).toBe(false);
  });
});

describe("tiny-type and joined-strings", () => {
  it("tiny-type ignores comments", () => {
    expect(breaks("tiny-type", U, "// was text-xs\nconst a = 1;")).toBe(false);
    expect(breaks("tiny-type", U, '<i className="text-[11px]" />')).toBe(true);
  });
  it("joined-strings skips <p> prose", () => {
    expect(breaks("joined-strings", U, "<p>a — b</p>")).toBe(false);
    expect(breaks("joined-strings", U, "<span>a · b</span>")).toBe(true);
  });
  it("joined-strings catches a separator between two expressions, even inside <p>", () => {
    expect(breaks("joined-strings", U, "<p>{a} · {b}</p>")).toBe(true);
    expect(breaks("joined-strings", U, "<p>{a} — {b}</p>")).toBe(true);
    expect(breaks("joined-strings", U, "<p>{a} → {b}</p>")).toBe(true);
    expect(breaks("joined-strings", U, "<p>{a} and {b}</p>")).toBe(false);
  });
  it("joined-strings catches escaped separators", () => {
    for (const j of ["\\u00B7", "\\u2014", "\\u2192", "&middot;", "&mdash;", "&rarr;"])
      expect(breaks("joined-strings", U, `const s = \`a ${j} b\`;`)).toBe(true);
  });
});

describe("unknown-color matcher", () => {
  const bad = (s: string) => breaks("unknown-color", F, s);
  it("flags colours tokens.css does not define, with variants and opacity", () => {
    expect(bad('<a className="hover:bg-surface-2" />')).toBe(true);
    expect(bad('<a className="text-red-500" />')).toBe(true);
    expect(bad('<a className="border-gray-300/50" />')).toBe(true);
    expect(bad('<a className="md:focus-visible:ring-blue-400" />')).toBe(true);
  });
  it("accepts token colours, special values and the important suffix", () => {
    expect(bad('<a className="bg-surface-hi/50 text-fg-2 border-line-strong hover:text-accent" />')).toBe(false);
    expect(bad('<a className="bg-transparent text-current border-inherit text-warn!" />')).toBe(false);
  });
  it("accepts the shadcn colour names global.css aliases to Ink tokens", () => {
    expect(bad('<a className="bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent border-sidebar-border ring-sidebar-ring" />')).toBe(false);
    expect(bad('<a className="bg-background text-foreground bg-popover text-muted-foreground border-input bg-destructive/10" />')).toBe(false);
    expect(bad('<a className="bg-chart-1" />')).toBe(true);
  });
  it("flags arbitrary colour values", () => {
    for (const c of ["bg-[#123]", "text-[color:var(--x)]", "border-[rgb(1,2,3)]", "from-[#fff]", "hover:bg-[hsl(0_0%_50%)]", "ring-[oklch(0.5_0.1_120)]", "text-[#abcdef]/50"])
      expect(bad(`<a className="${c}" />`), c).toBe(true);
  });
  it("flags named colours, unknown vars, colours anywhere in an arbitrary value, and arbitrary colour properties", () => {
    for (const c of ["bg-[red]", "text-[white]", "bg-[var(--x)]", "bg-(--x)", "shadow-[0_0_0_1px_#fff]", "shadow-[0_0_0_1px_red]", "[color:#123]", "[background-color:rgb(1,2,3)]", "hover:[color:var(--nope)]", "[--pane-bg:#000]"])
      expect(bad(`<a className="${c}" />`), c).toBe(true);
  });
  it("accepts token vars in arbitrary values and local vars defined from tokens", () => {
    expect(bad('<a className="shadow-[inset_2px_0_0_var(--accent)] shadow-[0_0_0_1px_var(--sidebar-border)] accent-[var(--color-accent)] [--pane-bg:var(--bg)] bg-(--pane-bg,var(--surface))" />')).toBe(false);
  });
  it("accepts arbitrary non-colour values", () => {
    expect(bad('<a className="border-[2px] bg-[url(/a.png)] bg-[length:4px_4px] text-[length:13px] from-[10%]" />')).toBe(false);
  });
  it("strips named-group and arbitrary variants before judging", () => {
    expect(bad('<a className="group-hover/item:text-accent [&>svg]:text-muted data-[state=open]:bg-surface-hi" />')).toBe(false);
    expect(bad('<a className="group-hover/item:text-red-500" />')).toBe(true);
    expect(bad('<a className="[&>svg]:text-red-500" />')).toBe(true);
  });
  it("accepts per-side border colours that are tokens", () => {
    expect(bad('<a className="border-l-accent border-t-line border-x-line-2 border-b-transparent" />')).toBe(false);
    expect(bad('<a className="border-l-red-500" />')).toBe(true);
  });
  it("does not treat type roles, sizes, widths or modes as colours", () => {
    expect(
      bad('<a className="text-title text-body text-meta text-sm text-2xl text-left border-2 border-t border-dashed outline-none ring-2 bg-none from-10% stroke-2 divide-y" />'),
    ).toBe(false);
  });
});

describe("off-scale-spacing matcher", () => {
  const bad = (s: string, file = F) => breaks("off-scale-spacing", file, s);
  it("flags half steps, steps off the scale and arbitrary px, with variants and negatives", () => {
    for (const c of ["p-1.5", "px-0.5", "gap-x-5", "mt-7", "hover:gap-2.5", "md:-ml-3.5", "py-10", "gap-[6px]", "pt-[10px]", "space-y-12"])
      expect(bad(`<a className="${c}" />`), c).toBe(true);
  });
  it("accepts the 4/8/12/16/24/32 scale, zero, px, auto, and non-spacing utilities", () => {
    expect(bad('<a className="p-1 px-2 py-3 gap-4 gap-x-6 mt-8 -ml-2 m-0 mx-auto pt-px gap-[0] size-7 h-7 w-0.5 top-1.5 inset-2.5 text-body" />')).toBe(false);
  });
  it("sees px inside arbitrary expressions", () => {
    expect(bad('<a className="pl-[max(78px,calc(50%_-_10px))]" />')).toBe(true);
    expect(bad('<a className="pr-[max(var(--a),calc(50%_+_var(--b)))]" />')).toBe(false);
  });
  it("sees lengths after an underscore in arbitrary values", () => {
    expect(bad('<a className="pl-[calc(50%_-_10px)]" />')).toBe(true);
    expect(bad('<a className="p-[6px_10px]" />')).toBe(true);
    expect(bad('<a className="p-[0_0]" />')).toBe(false);
  });
  it("allows the title bar's 78px traffic-light inset, only in TitleBar", () => {
    expect(bad('<a className="pl-[78px]" />', "src/ui/TitleBar.tsx")).toBe(false);
    expect(bad('<a className="pl-[max(78px,calc((100%_-_var(--col-max))/2_+_var(--col-inset)))]" />', "src/ui/TitleBar.tsx")).toBe(false);
    expect(bad('<a className="pl-[78px]" />')).toBe(true);
    expect(bad('<a className="pl-[80px]" />', "src/ui/TitleBar.tsx")).toBe(true);
  });
  it("allows only the documented 6px hint gap, only in HintLine", () => {
    expect(bad('<a className="gap-[6px]" />', "src/ui/HintLine.tsx")).toBe(false);
    expect(bad('<a className="gap-x-5" />', "src/ui/HintLine.tsx")).toBe(true);
  });
});

describe("scan scope", () => {
  it("covers .ts and .tsx under features and ui, App.tsx, and engines", () => {
    expect(files).toContain("src/App.tsx");
    expect(files).toContain("src/features/palette/suggest.ts");
    expect(files).toContain("src/ui/controlStyles.ts");
    expect(files).toContain("src/engines/stuck/engagementStuck.ts");
    expect(files.filter((f) => f.startsWith("src/engines/") && !f.endsWith(".ts"))).toEqual([]);
  });
  it("tiny-type catches rem and em arbitrary sizes", () => {
    for (const c of ["text-[0.7rem]", "text-[.75em]", "text-[1rem]", "md:text-[0.6875rem]"])
      expect(breaks("tiny-type", U, `<i className="${c}" />`), c).toBe(true);
  });
  it("joined-strings sees UI strings in .ts files", () => {
    expect(breaks("joined-strings", "src/features/x/x.ts", "const s = { hint: `${dc.name} · DC` };")).toBe(true);
    expect(breaks("joined-strings", "src/ui/x.ts", 'export const T = "Close — Esc";')).toBe(true);
  });
});

describe("joined-strings in engines (narrow)", () => {
  const E = "src/engines/x/x.ts";
  it("flags a separator joined to an interpolation", () => {
    expect(breaks("joined-strings", E, "const t = `${host} — no foothold`;")).toBe(true);
    expect(breaks("joined-strings", E, "const t = `${a} · ${b}`;")).toBe(true);
    expect(breaks("joined-strings", E, "const t = `from → ${b}`;")).toBe(true);
  });
  it("leaves prose fields, comments and separators away from interpolations alone", () => {
    expect(breaks("joined-strings", E, 'const p = { text: "Note your tun0 IP → this is `{LHOST}` — always" };')).toBe(false);
    expect(breaks("joined-strings", E, "// `${a} — ${b}` was the old title\nconst a = 1;")).toBe(false);
    expect(breaks("joined-strings", E, "const w = `${n} hosts detected — primary target ports mapped.`;")).toBe(false);
  });
  it("exempts the import writers: stored titles and note bodies stay as they were", () => {
    expect(breaks("joined-strings", "src/engines/import/plan.ts", "const t = `${a} · ${b}`;")).toBe(false);
    expect(breaks("joined-strings", "src/engines/import/loot.ts", "const t = `${a} · ${b}`;")).toBe(false);
  });
  it("applies no markup rules to engines", () => {
    for (const r of ["tiny-type", "feature-flex", "hand-hint", "esc-close", "unknown-color", "off-scale-spacing"] as const)
      expect(breaks(r, E, 'const c = "text-xs flex bg-[#fff] p-1.5"; <div><Kbd>a</Kbd><Kbd>esc</Kbd></div>'), r).toBe(false);
  });
});
