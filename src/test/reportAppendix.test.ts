import { describe, expect, it } from "vitest";
import { numberAppendices, sectionNumbers, suggestMoves } from "../engines/report";
import type { ReportNode } from "../engines/report";

const ev = (appendix: string, entryId = "e1", extra = {}): ReportNode => ({ type: "evidence", attrs: { entryId, block: 0, keep: null, emphasis: [], appendix, ...extra } });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const title = (n: ReportNode) => String(n.attrs?.entryId);

describe("numberAppendices", () => {
  it("gives a target no appendix entries, whatever its page holds", () => {
    const idx = numberAppendices(
      [
        { id: "t1", kind: "target", targetKey: "h1", doc: doc(ev("moved", "a")) },
        { id: "ad", kind: "ad", targetKey: "ad-set", doc: doc(ev("split", "b")) },
      ],
      title,
    );
    expect(idx.entries).toEqual([]);
    expect(idx.refFor("t1:0")).toBeNull();
    expect(idx.pages).toEqual([]);
  });
});

describe("appendix pages and free pages (+ Page)", () => {
  const page = (id: string, placement: "appendix" | "body", position: number, d: ReportNode = doc()) => ({
    id,
    kind: "page" as const,
    targetKey: `k-${id}`,
    position,
    doc: d,
    meta: { title: `Page ${id}`, placement },
  });
  it("letters appendix pages from A, by position, and numbers none of their content", () => {
    const idx = numberAppendices(
      [
        { id: "t1", kind: "target", targetKey: "h1", doc: doc() },
        // Listed out of position order: letters follow position.
        page("p3", "appendix", 9),
        page("p2", "appendix", 7, doc(ev("moved", "x"))),
        page("b1", "body", 8),
      ],
      title,
    );
    expect(idx.pages).toEqual([
      { sectionId: "p2", letter: "A" },
      { sectionId: "p3", letter: "B" },
    ]);
    expect(idx.entries).toEqual([]);
    expect(idx.refFor("p2:0")).toBeNull();
  });
  it("with no target appendices an appendix page is Appendix A", () => {
    expect(numberAppendices([page("p1", "appendix", 0)], title).pages).toEqual([{ sectionId: "p1", letter: "A" }]);
  });
  it("numbers a free page as a body section after the targets; an appendix page takes no number", () => {
    const n = sectionNumbers([
      { id: "i", kind: "introduction" },
      { id: "s", kind: "summary" },
      { id: "m", kind: "methodology" },
      { id: "t1", kind: "target" },
      { id: "ad", kind: "ad" },
      { id: "b1", kind: "page", meta: { title: "Port knocking", placement: "body" } },
      { id: "et", kind: "engagement-tested" },
      { id: "a1", kind: "page", meta: { title: "Users", placement: "appendix" } },
    ]);
    expect(n.get("b1")).toEqual({ number: "6", title: { number: "6", text: "Port knocking" } });
    expect(n.get("et")?.number).toBe("7");
    expect(n.get("a1")).toEqual({ number: null, title: null });
  });
});

describe("suggestMoves", () => {
  const code = (n: number): ReportNode => ({ type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text: Array.from({ length: n }, (_, i) => `o${i}`).join("\n") }] });

  it("suggests a code block over 60 lines, with its line count", () => {
    expect(suggestMoves(doc(code(61)))).toEqual([{ key: "0", reason: "61 lines" }]);
  });

  it("suggests nothing for a block of exactly 60 lines", () => {
    expect(suggestMoves(doc(code(60)))).toEqual([]);
  });

  it("finds a long block at any depth and names its index path", () => {
    const step: ReportNode = { type: "list", attrs: { kind: "ordered" }, content: [{ type: "paragraph" }, code(10), code(90)] };
    expect(suggestMoves(doc({ type: "paragraph" }, step))).toEqual([{ key: "1.2", reason: "90 lines" }]);
  });
});
