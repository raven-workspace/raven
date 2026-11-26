import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDING, type RuleId } from "./conventionsPending";
import { PLACEHOLDER_GRAMMAR, ROOT, breaks, engineFiles, files, importsLibraryStore, placeholderRegexes, sourceFiles } from "./conventionsRules";

const RULES: RuleId[] = [
  "tiny-type",
  "feature-flex",
  "joined-strings",
  "hand-hint",
  "esc-close",
  "unknown-color",
  "off-scale-spacing",
];
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("conventions", () => {
  for (const rule of RULES) {
    it(`${rule}: files not in PENDING follow it`, () => {
      const bad = files.filter(
        (f) => !PENDING[rule].includes(f) && breaks(rule, f, read(f)),
      );
      expect(bad).toEqual([]);
    });
    it(`${rule}: every PENDING entry still breaks it`, () => {
      const fixed = PENDING[rule].filter(
        (f) => !files.includes(f) || !breaks(rule, f, read(f)),
      );
      expect(fixed).toEqual([]);
    });
  }

  it("placeholder grammar: no placeholder regex is defined outside the template module (RAV-48)", () => {
    const bad = sourceFiles
      .filter((f) => f !== PLACEHOLDER_GRAMMAR)
      .flatMap((f) => placeholderRegexes(read(f)).map((line) => `${f}: ${line}`));
    expect(bad).toEqual([]);
    expect(placeholderRegexes(read(PLACEHOLDER_GRAMMAR)).length).toBeGreaterThan(0);
  });

  it("library as an input: no engine imports the library store (RAV-49)", () => {
    expect(engineFiles.length).toBeGreaterThan(0);
    expect(engineFiles.filter((f) => importsLibraryStore(f, read(f)))).toEqual([]);
  });

  it("PENDING is empty", () => {
    expect(Object.entries(PENDING).filter(([, list]) => list.length > 0)).toEqual([]);
  });

  it("no feature imports another feature's query keys", () => {
    // A query key is an exported `…Key`/`…_KEY` const whose value is a key array (or a function returning one).
    const featureOf = (f: string) => /^src\/features\/([^/]+)\//.exec(f)?.[1];
    const code = files.filter((f) => /\.tsx?$/.test(f) && featureOf(f));
    const keysOf = new Map<string, Set<string>>();
    for (const f of code) {
      for (const m of read(f).matchAll(/export const (\w+(?:Key|_KEY))\s*=\s*(?:\([^)]*\)\s*=>\s*)?\[/g)) {
        const feature = featureOf(f)!;
        keysOf.set(feature, (keysOf.get(feature) ?? new Set()).add(m[1]));
      }
    }
    const bad: string[] = [];
    for (const f of code) {
      const own = featureOf(f)!;
      for (const m of read(f).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
        const target = featureOf(relative(ROOT, join(ROOT, dirname(f), m[2])) + "/");
        if (!target || target === own) continue;
        const names = m[1].split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
        for (const n of names) if (keysOf.get(target)?.has(n)) bad.push(`${f}: ${n} from ${target}`);
      }
    }
    // Report a write with `storeChanged` and register a feature's own keys with `registerReads` instead.
    expect(bad).toEqual([]);
  });

  it("type tokens exist", () => {
    const css = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
    const sizes = {
      title: 20,
      heading: 15,
      body: 14,
      code: 13,
      meta: 13,
      label: 12,
    };
    for (const [name, px] of Object.entries(sizes)) {
      expect(css).toMatch(new RegExp(`--text-${name}:\\s*${px}px`));
      expect(css).toMatch(new RegExp(`--text-${name}--line-height:`));
    }
  });
});
