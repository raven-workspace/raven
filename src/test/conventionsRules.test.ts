import { describe, expect, it } from "vitest";
import { breaks } from "./conventionsRules";

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
  it("joined-strings catches escaped separators", () => {
    for (const j of ["\\u00B7", "\\u2014", "\\u2192", "&middot;", "&mdash;", "&rarr;"])
      expect(breaks("joined-strings", U, `const s = \`a ${j} b\`;`)).toBe(true);
  });
});
