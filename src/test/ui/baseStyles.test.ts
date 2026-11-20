import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const base = readFileSync("src/styles/base.scss", "utf8");
const mixins = readFileSync("src/styles/abstracts/_mixins.scss", "utf8");

describe("base styles", () => {
  it("code elements and the code type role are mono with ligatures off", () => {
    const rule = /code,\s*kbd,\s*samp,\s*pre\s*\{([^}]*font-variant-ligatures[^}]*)\}/.exec(base)?.[1] ?? "";
    expect(rule).toMatch(/font-variant-ligatures:\s*none/);
    expect(rule).toMatch(/"liga" 0, "calt" 0/);
    const mono = /@mixin mono \{([^}]*)\}/.exec(mixins)?.[1] ?? "";
    expect(mono).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(mono).toMatch(/font-variant-ligatures:\s*none/);
    expect(mixins).toMatch(/@if \$role == code \{\s*@include mono;/);
  });

  it("keeps the reset components are written against: border-box, no margins, borders 0 solid", () => {
    expect(base).toMatch(/\*,\s*::after,\s*::before,\s*::backdrop,\s*::file-selector-button \{\s*box-sizing: border-box;\s*margin: 0;\s*padding: 0;\s*border: 0 solid;/);
    expect(base).toMatch(/ol,\s*ul,\s*menu \{\s*list-style: none;/);
  });
});
