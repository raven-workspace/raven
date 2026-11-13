import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/features/report/page.css", "utf8");

describe("report block rhythm", () => {
  it("consecutive blocks on the page and inside a numbered step are 12px apart", () => {
    expect(css).toMatch(/\.report-page \.ProseMirror \{[^}]*row-gap: 12px/);
    expect(css).toMatch(/\.report-page \.list-content \{[^}]*display: grid;[^}]*row-gap: 12px/);
  });

  it("list items keep the block gap instead of collapsing it", () => {
    expect(css).toMatch(/\.report-page \.ProseMirror > \.prosemirror-flat-list \+ \.prosemirror-flat-list \{[^}]*margin-top: 0/);
    expect(css).not.toMatch(/margin-top: -\d/);
  });

  it("the warning over a copy whose entry went private or was deleted is at least 13px", () => {
    expect(css).toMatch(/\.report-page \[data-source-gone\]::before \{[^}]*font-size: 13px/);
  });
});
