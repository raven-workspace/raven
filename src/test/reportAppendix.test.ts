import { describe, expect, it } from "vitest";
import { numberAppendices, suggestMoves } from "../engines/report";
import type { ReportData, ReportNode } from "../engines/report";

const ev = (appendix: string, entryId = "e1", extra = {}): ReportNode => ({ type: "evidence", attrs: { entryId, block: 0, keep: null, emphasis: [], appendix, ...extra } });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const title = (n: ReportNode) => String(n.attrs?.entryId);

describe("numberAppendices", () => {
  const sections = (second: ReportNode) => [
    { id: "s0", kind: "methodology" as const, targetKey: null, doc: doc({ type: "generated", attrs: { kind: "cleanup", hostId: null, appendix: "moved" } }) },
    { id: "t1", kind: "target" as const, targetKey: "h1", doc: doc(ev("inline"), ev("inline")) },
    { id: "t2", kind: "target" as const, targetKey: "h2", doc: second },
  ];
  it("letters only moved-out content, from A, and numbers nodes in document order", () => {
    const idx = numberAppendices(sections(doc(ev("moved", "a"), { type: "phase", content: [ev("split", "b")] })), title);
    expect(idx.entries.map((e) => [e.key, e.letter, e.n, e.sectionId])).toEqual([
      ["t2:0", "A", 1, "t2"],
      ["t2:1.0", "A", 2, "t2"],
    ]);
    expect(idx.refFor("t2:0")).toBe("A.1");
    expect(idx.refFor("t2:1.0")).toBe("A.2");
    expect(idx.refFor("s0:0")).toBeNull();
    expect(idx.refFor("nope")).toBeNull();
  });
  it("renumbers when a node moves earlier", () => {
    const before = numberAppendices(sections(doc(ev("inline", "a"), ev("moved", "b"))), title);
    expect(before.refFor("t2:1")).toBe("A.1");
    const after = numberAppendices(sections(doc(ev("moved", "a"), ev("moved", "b"))), title);
    expect(after.refFor("t2:1")).toBe("A.2");
  });
  it("gives each target with moved content the next letter, in report order", () => {
    const idx = numberAppendices(
      [
        { id: "t1", kind: "target", targetKey: "h1", doc: doc(ev("moved", "a")) },
        { id: "ad", kind: "ad", targetKey: "ad-set", doc: doc(ev("moved", "b")) },
      ],
      title,
    );
    expect([idx.refFor("t1:0"), idx.refFor("ad:0")]).toEqual(["A.1", "B.1"]);
  });
});

describe("suggestMoves", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `o${i}`).join("\n");
  const data = {
    hosts: [{ id: "h1" }],
    services: [],
    attempts: [],
    ruledOut: [],
    log: [
      { id: "long", kind: "command", private: false, hostIds: ["h1"], content: { kind: "command", blocks: [{ command: "nmap x", output: lines(100) }] } },
      { id: "short", kind: "command", private: false, hostIds: ["h1"], content: { kind: "command", blocks: [{ command: "id", output: lines(10) }] } },
    ],
    findingFiles: [
      { id: "f1", content: lines(80), modified: true },
      { id: "f2", content: lines(5), modified: true },
      { id: "f3", content: lines(80), modified: false },
    ],
  } as unknown as ReportData;

  it("flags long kept output, long exploits, and not short ones or already-moved nodes", () => {
    const d = doc(
      ev("inline", "long"),
      ev("inline", "long", { keep: [[0, 39]] }),
      ev("inline", "short"),
      ev("moved", "long"),
      { type: "exploit", attrs: { fileId: "f1", markedLines: [], appendix: "inline" } },
      { type: "exploit", attrs: { fileId: "f2", markedLines: [], appendix: "inline" } },
    );
    expect(suggestMoves(d, data).map((s) => s.key)).toEqual(["0", "4"]);
  });

  it("finds long output inside a step and returns its nested path key", () => {
    const d = doc({ type: "phase", attrs: { phase: "foothold", hostId: "h1" } }, { type: "steps", content: [{ type: "step", attrs: { entryId: "long" }, content: [{ type: "slot", attrs: { hint: "h" } }, ev("inline", "long"), ev("inline", "short")] }] });
    expect(suggestMoves(d, data).map((s) => s.key)).toEqual(["1.0.1"]);
  });

  it("never flags an unmodified exploit: the page shows it as its URL, never its code", () => {
    const d = doc({ type: "exploit", attrs: { fileId: "f3", markedLines: [], appendix: "inline" } });
    expect(suggestMoves(d, data)).toEqual([]);
  });
});
