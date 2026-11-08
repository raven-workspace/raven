import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDING, type RuleId } from "./conventionsPending";
import { ROOT, breaks, files } from "./conventionsRules";

const RULES: RuleId[] = [
  "tiny-type",
  "feature-flex",
  "joined-strings",
  "hand-hint",
  "esc-close",
  "unknown-color",
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
