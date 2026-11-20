import { describe, expect, it } from "vitest";
import { breaks, files } from "./conventionsRules";

const F = "src/features/x/X.tsx";
const U = "src/ui/X.tsx";

const FS = "src/features/x/X.scss";
const US = "src/ui/X.scss";

describe("feature-flex matcher", () => {
  it("flags a flex container, its direction or wrapping, growth and space-between in feature sheets", () => {
    for (const d of ["display: flex", "display: inline-flex", "flex-direction: column", "flex-wrap: wrap", "flex: 1", "flex-grow: 1", "justify-content: space-between"])
      expect(breaks("feature-flex", FS, `.a { ${d}; }`), d).toBe(true);
  });
  it("allows grid, flex-shrink, flex: none, and flex in src/ui", () => {
    expect(breaks("feature-flex", FS, ".a { display: grid; flex-shrink: 0; flex: none; justify-content: center; }")).toBe(false);
    expect(breaks("feature-flex", US, ".a { display: flex; }")).toBe(false);
  });
  it("ignores comments and markup files", () => {
    expect(breaks("feature-flex", FS, "// display: flex;\n.a { display: grid; }")).toBe(false);
    expect(breaks("feature-flex", "src/features/x/X.tsx", 'const BOX = "display: flex;";')).toBe(false);
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
  it("tiny-type: font sizes come only from the type roles", () => {
    expect(breaks("tiny-type", US, ".a { font-size: var(--text-meta); } .b { font-size: inherit; } .c { font-size: 1em; }")).toBe(false);
    for (const d of ["font-size: 11px", "font-size: 0.7rem", "font-size: var(--text-xs)", "font-size: calc(var(--text-meta) - 1px)", "font: 12px/1 sans-serif"])
      expect(breaks("tiny-type", US, `.a { ${d}; }`), d).toBe(true);
    expect(breaks("tiny-type", US, "// font-size: 11px;\n.a { color: var(--fg); }")).toBe(false);
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
  const bad = (scss: string) => breaks("unknown-color", FS, scss);
  it("accepts tokens, color-mix of tokens and the special values", () => {
    expect(bad(".a { color: var(--fg-2); background-color: color-mix(in oklab, var(--accent) 10%, transparent); border-color: currentColor; }")).toBe(false);
    expect(bad(".a { box-shadow: inset 2px 0 0 var(--accent); outline-color: transparent; fill: inherit; }")).toBe(false);
  });
  it("flags raw colours anywhere: hex, colour functions and named colours", () => {
    for (const d of ["color: #fff", "background: rgb(1, 2, 3)", "border-color: hsl(0 0% 50%)", "outline-color: oklch(0.5 0.1 120)", "color: red", "border: 1px solid white", "--pane-bg: #123456", "box-shadow: 0 0 0 1px #fff"])
      expect(bad(`.a { ${d}; }`), d).toBe(true);
  });
  it("allows black only as a shadow's or a mask's darkness", () => {
    expect(bad(".a { box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6); mask-image: linear-gradient(to right, #000 80%, transparent); }")).toBe(false);
    expect(bad(".a { background: #000; }")).toBe(true);
  });
  it("flags var() references nothing declares, but not library or locally set ones", () => {
    expect(bad(".a { color: var(--nope); }")).toBe(true);
    expect(bad(".a { max-height: var(--radix-select-content-available-height); width: var(--sidebar-width); }")).toBe(false);
  });
  it("skips url() and non-colour words", () => {
    expect(bad('.a { background-image: url("/red.png"); grid-template-areas: "tan"; }')).toBe(false);
  });
});

describe("off-scale-spacing matcher", () => {
  const bad = (scss: string, file = FS) => breaks("off-scale-spacing", file, scss);
  it("flags lengths off the 4/8/12/16/24/32 scale", () => {
    for (const d of ["padding: 6px", "gap: 0.375rem", "margin-top: 10px", "padding-inline: var(--space-sm) 5px", "column-gap: 1.25rem", "margin: calc(var(--space-sm) + 2px)"])
      expect(bad(`.a { ${d}; }`), d).toBe(true);
  });
  it("accepts the space tokens and their negatives, 0, auto and 1px, with !important", () => {
    expect(bad(".a { padding: 0 var(--space-md); margin: auto; gap: var(--space-xs); margin-block: calc(var(--space-xs) * -1); margin-top: -1px; padding: var(--space-sm) !important; }")).toBe(false);
  });
  it("does not judge non-spacing lengths", () => {
    expect(bad(".a { width: 28px; height: 1.75rem; inset: 2px; border-width: 3px; }")).toBe(false);
  });
  it("allows the title bar's 94px traffic-light inset, only in TitleBar", () => {
    expect(bad(".a { padding-left: 94px; }", "src/ui/TitleBar.scss")).toBe(false);
    expect(bad(".a { padding-left: 78px; }", "src/ui/TitleBar.scss")).toBe(true);
    expect(bad(".a { padding-left: 94px; }")).toBe(true);
  });
  it("allows the inline subnet's -2px target bleed, only in InterfaceNudge", () => {
    expect(bad(".a { margin-block: -0.125rem; }", "src/features/network/InterfaceNudge.scss")).toBe(false);
    expect(bad(".a { margin-inline: -0.125rem; }", "src/features/network/InterfaceNudge.scss")).toBe(true);
    expect(bad(".a { margin-block: -0.125rem; }")).toBe(true);
  });
  it("allows only the documented 6px hint gap, only in HintLine", () => {
    expect(bad(".a { gap: 6px; }", "src/ui/HintLine.scss")).toBe(false);
    expect(bad(".a { gap: 5px; }", "src/ui/HintLine.scss")).toBe(true);
  });
});

describe("scan scope", () => {
  it("covers .ts, .tsx and .scss under features and ui, App.tsx, and engines", () => {
    expect(files).toContain("src/App.tsx");
    expect(files).toContain("src/ui/Button.scss");
    expect(files).toContain("src/features/credentials/TestGrid.scss");
    expect(files).toContain("src/features/palette/suggest.ts");
    expect(files).toContain("src/ui/controlStyles.ts");
    expect(files).toContain("src/engines/stuck/engagementStuck.ts");
    expect(files.filter((f) => f.startsWith("src/engines/") && !f.endsWith(".ts"))).toEqual([]);
  });
  it("style rules read only stylesheets, markup rules only markup", () => {
    expect(breaks("tiny-type", U, '<i style={{ fontSize: "11px" }} />')).toBe(false);
    expect(breaks("esc-close", US, ".a { content: '<Kbd>esc</Kbd>'; }")).toBe(false);
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
  it("applies no markup rules to engines", () => {
    for (const r of ["tiny-type", "feature-flex", "hand-hint", "esc-close", "unknown-color", "off-scale-spacing"] as const)
      expect(breaks(r, E, 'const c = ".a { font-size: 9px; display: flex; color: #fff; padding: 6px; }"; <div><Kbd>a</Kbd><Kbd>esc</Kbd></div>'), r).toBe(false);
  });
});
