import { describe, expect, it, vi } from "vitest";
import { applyKeep, lineDiff } from "../engines/report";

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

describe("lineDiff", () => {
  it("marks a changed line as del + add and keeps n", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([
      { op: "same", text: "a", n: 0 },
      { op: "del", text: "b", n: null },
      { op: "add", text: "B", n: 1 },
      { op: "same", text: "c", n: 2 },
    ]);
  });
  it("handles inserts, deletes and an empty original", () => {
    expect(lineDiff("", "x\ny").map((d) => [d.op, d.n])).toEqual([["add", 0], ["add", 1]]);
    expect(lineDiff("a\nb\nc\nd", "b\nd\ne").map((d) => `${d.op}:${d.text}:${d.n}`)).toEqual([
      "del:a:null", "same:b:0", "del:c:null", "same:d:1", "add:e:2",
    ]);
  });
  it("diffs fully different files (every edit used) without reading outside its trace", () => {
    // At d = N + M the trace row once started at index -1, which slice() reads from the end: right only by luck.
    const slice = vi.spyOn(Int32Array.prototype, "slice");
    const d = lineDiff("a\nb\nc", "x\ny\nz");
    const starts = slice.mock.calls.map(([begin]) => begin ?? 0);
    slice.mockRestore();
    expect(starts.every((b) => b >= 0)).toBe(true);
    expect(d.map((x) => `${x.op}:${x.text}:${x.n}`)).toEqual(["del:a:null", "del:b:null", "del:c:null", "add:x:0", "add:y:1", "add:z:2"]);
  });
  it("marks a single changed line in a one-line file", () => {
    expect(lineDiff("a", "b").map((x) => `${x.op}:${x.text}:${x.n}`)).toEqual(["del:a:null", "add:b:0"]);
    expect(lineDiff("keep\nold\nkeep2", "keep\nnew\nkeep2").map((x) => `${x.op}:${x.text}:${x.n}`)).toEqual([
      "same:keep:0", "del:old:null", "add:new:1", "same:keep2:2",
    ]);
  });
  it("reconstructs the modified file from same+add lines", () => {
    const a = Array.from({ length: 200 }, (_, i) => `l${i}`);
    const b = a.filter((_, i) => i % 7 !== 0).concat(["tail"]);
    b.splice(50, 0, "inserted");
    const d = lineDiff(a.join("\n"), b.join("\n"));
    expect(d.filter((x) => x.op !== "del").map((x) => x.text)).toEqual(b);
    expect(d.filter((x) => x.op !== "add").map((x) => x.text)).toEqual(a);
    d.filter((x) => x.op !== "del").forEach((x, i) => expect(x.n).toBe(i));
  });
  it("diffs 5,000 x 5,000 lines in under a second", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const b = a.slice();
    for (let i = 0; i < 5000; i += 50) b[i] = `changed ${i}`;
    const t = performance.now();
    const d = lineDiff(a.join("\n"), b.join("\n"));
    expect(performance.now() - t).toBeLessThan(1000);
    expect(d.filter((x) => x.op === "add")).toHaveLength(100);
  });
});
