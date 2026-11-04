import { describe, expect, it } from "vitest";
import { closeThread, openThreads, toggleThreadPrefix } from "../../../engines/notes/threads";

describe("openThreads", () => {
  it('finds "? " lines and skips fenced code', () => {
    const body = ["intro", "? why is 8080 open", "  ? indented one", "?no space", "```", "? inside fence", "```", "~~~", "? tilde fence", "~~~", "? after"].join("\n");
    expect(openThreads(body)).toEqual([
      { line: 1, text: "why is 8080 open" },
      { line: 2, text: "indented one" },
      { line: 10, text: "after" },
    ]);
  });
  it("is empty for an empty body", () => {
    expect(openThreads("")).toEqual([]);
  });
});

describe("toggleThreadPrefix", () => {
  it("adds and removes", () => {
    expect(toggleThreadPrefix("a\nb\nc", 1)).toBe("a\n? b\nc");
    expect(toggleThreadPrefix("a\n? b\nc", 1)).toBe("a\nb\nc");
    expect(toggleThreadPrefix("  x", 0)).toBe("  ? x");
    expect(toggleThreadPrefix("  ? x", 0)).toBe("  x");
  });
  it("ignores a line out of range", () => {
    expect(toggleThreadPrefix("a", 5)).toBe("a");
  });
});

describe("closeThread", () => {
  it("marks ✓ or ✗", () => {
    expect(closeThread("a\n? b\nc", 1, "panned")).toBe("a\n✓ b\nc");
    expect(closeThread("a\n  ? b\nc", 1, "dead")).toBe("a\n  ✗ b\nc");
  });
  it("leaves a line that is not a thread alone", () => {
    expect(closeThread("a\nb", 1, "dead")).toBe("a\nb");
  });
});
