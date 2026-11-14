import { describe, expect, it } from "vitest";
import { applyKeep } from "../engines/report";

const ten = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");

describe("applyKeep", () => {
  it("keeps ranges and counts the gaps", () => {
    expect(applyKeep(ten, [[0, 1], [6, 7]])).toEqual([
      { kind: "line", n: 0, text: "line0" },
      { kind: "line", n: 1, text: "line1" },
      { kind: "omitted", count: 4 },
      { kind: "line", n: 6, text: "line6" },
      { kind: "line", n: 7, text: "line7" },
      { kind: "omitted", count: 2 },
    ]);
  });
  it("null keeps every line", () => {
    const r = applyKeep(ten, null);
    expect(r).toHaveLength(10);
    expect(r.every((i) => i.kind === "line")).toBe(true);
  });
  it("merges overlapping and adjacent ranges, clamps, and marks a leading gap", () => {
    const r = applyKeep(ten, [[3, 5], [4, 6], [7, 99]]);
    expect(r[0]).toEqual({ kind: "omitted", count: 3 });
    expect(r.filter((i) => i.kind === "line")).toHaveLength(7);
    expect(r).toHaveLength(8);
  });
});
