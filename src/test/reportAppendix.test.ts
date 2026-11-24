import { describe, expect, it } from "vitest";
import { entriesOnPage, joinPages, numberAppendices, sectionNumbers, suggestMoves, withBlockAppended, withoutAppended } from "../engines/report";
import type { ReportData } from "../engines/report";
import type { ReportNode } from "../engines/report";

const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });

describe("appendix pages and free pages (+ Page)", () => {
  const page = (id: string, placement: "appendix" | "body", position: number) => ({
    id,
    kind: "page" as const,
    position,
    meta: { title: `Page ${id}`, placement },
  });
  it("letters appendix pages from A, by position; targets and body pages take none", () => {
    const idx = numberAppendices([
      { id: "t1", kind: "target" },
      // Listed out of position order: letters follow position.
      page("p3", "appendix", 9),
      page("p2", "appendix", 7),
      page("b1", "body", 8),
    ]);
    expect(idx.pages).toEqual([
      { sectionId: "p2", letter: "A" },
      { sectionId: "p3", letter: "B" },
    ]);
  });
  it("a lone appendix page is Appendix A", () => {
    expect(numberAppendices([page("p1", "appendix", 0)]).pages).toEqual([{ sectionId: "p1", letter: "A" }]);
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

describe("Move to appendix", () => {
  const para = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const output: ReportNode = { type: "codeBlock", attrs: { language: "", source: "entry:l1:0:output", also: ["f1"] }, content: [{ type: "text", text: "uid=0" }] };
  const shot: ReportNode = { type: "figure", attrs: { attachmentId: "a", entryId: "s1", source: "entry:s1" } };

  it("puts the block at the end of the page, attrs and all", () => {
    expect(withBlockAppended(doc(para("Full output")), output)).toEqual(doc(para("Full output"), output));
  });
  it("puts it in place of a new page's one empty paragraph", () => {
    expect(withBlockAppended(doc({ type: "paragraph" }), shot)).toEqual(doc(shot));
    expect(withBlockAppended(doc(), shot)).toEqual(doc(shot));
    // A paragraph with words is the owner's: it stays.
    expect(withBlockAppended(doc(para("x")), shot)).toEqual(doc(para("x"), shot));
  });
  it("undo takes the last block equal to the moved one off, whatever order its keys were saved in", () => {
    const resaved: ReportNode = { content: [{ text: "uid=0", type: "text" }], attrs: { also: ["f1"], source: "entry:l1:0:output", language: "" }, type: "codeBlock" };
    expect(withoutAppended(doc(output, para("x"), resaved), output)).toEqual(doc(output, para("x")));
    expect(withoutAppended(doc(shot), shot)).toEqual(doc({ type: "paragraph" }));
  });
  it("undo finds nothing once the owner changed the moved block", () => {
    expect(withoutAppended(doc({ ...output, content: [{ type: "text", text: "edited" }] }), output)).toBeNull();
  });
  it("an entry on an appendix page is in the report", () => {
    const data = { log: [{ id: "l1", private: false }, { id: "f1", private: false }, { id: "s1", private: false }], attempts: [] } as unknown as ReportData;
    expect(entriesOnPage(joinPages([doc(para("x")), doc(output), doc(shot)]), data)).toEqual(new Set(["l1", "f1", "s1"]));
  });
});
