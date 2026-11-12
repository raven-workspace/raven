import { describe, expect, it } from "vitest";
import { buildSectionDraft, introductionParts, sectionNumbers, subsectionNumbers } from "../engines/report";
import type { ReportData, ReportNode } from "../engines/report";
import type { SectionKind } from "../types/report";
import type { Settings } from "../types/settings";

const settings = (reportMethodology = "", reportIntroduction = "") => ({ reportMethodology, reportIntroduction }) as Settings;
const data = {} as ReportData;
const hints = (doc: ReportNode) => (doc.content ?? []).filter((n) => n.type === "slot").map((n) => n.attrs?.hint);
const headings = (doc: ReportNode) =>
  (doc.content ?? []).filter((n) => n.type === "heading").map((n) => n.content?.[0].text);
const kinds = (doc: ReportNode) => (doc.content ?? []).map((n) => (n.type === "generated" ? `G:${n.attrs?.kind}` : n.type));

describe("buildSectionDraft", () => {
  it("lays section 1 out as Introduction, Objective and Requirements, empty slots without a Settings default", () => {
    const doc = buildSectionDraft("introduction", data, settings());
    expect(headings(doc)).toEqual(["Introduction", "Objective", "Requirements"]);
    expect(kinds(doc)).toEqual(["heading", "slot", "heading", "slot", "heading", "slot"]);
  });

  it("fills section 1 from the Settings default, split on its part lines, bullets as a list", () => {
    const text = [
      "The exam report contains all efforts",
      "that were conducted.",
      "1.2 Objective",
      "Perform an internal penetration test.",
      "Requirements",
      "The report includes:",
      "· Overall High-Level Summary",
      "· Each finding with",
      "  screenshots",
    ].join("\n");
    const doc = buildSectionDraft("introduction", data, settings("", text));
    expect(kinds(doc)).toEqual(["heading", "paragraph", "heading", "paragraph", "heading", "paragraph", "list", "list"]);
    expect(doc.content?.[1].content?.[0].text).toBe("The exam report contains all efforts that were conducted.");
    expect(doc.content?.[3].content?.[0].text).toBe("Perform an internal penetration test.");
    expect(doc.content?.[6]).toEqual({
      type: "list",
      attrs: { kind: "bullet" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Overall High-Level Summary" }] }],
    });
    expect(doc.content?.[7].content?.[0].content?.[0].text).toBe("Each finding with screenshots");
  });

  it("keeps a bullet wrapped over two lines of a PDF paste as one item (the sample's 1.3)", () => {
    const text = [
      "Requirements",
      "The student will be required to fill out this penetration testing report fully and to include",
      "the following sections:",
      "· Overall High-Level Summary and Recommendations (non-technical)",
      "· Each finding with included screenshots, walkthrough, sample code, and proof.txt if",
      "applicable.",
      "· Any additional items that were not included",
    ].join("\n");
    const doc = buildSectionDraft("introduction", data, settings("", text));
    const items = (doc.content ?? []).filter((n) => n.type === "list").map((n) => n.content?.[0].content?.[0].text);
    expect(items).toEqual([
      "Overall High-Level Summary and Recommendations (non-technical)",
      "Each finding with included screenshots, walkthrough, sample code, and proof.txt if applicable.",
      "Any additional items that were not included",
    ]);
  });

  it("reads text before any part line as the introduction", () => {
    expect(introductionParts("Just one paragraph.")).toEqual({ Introduction: "Just one paragraph.", Objective: "", Requirements: "" });
  });

  it("lays out the summary: four prose slots, then 2.1 Recommendations, no generated tables", () => {
    const doc = buildSectionDraft("summary", data, settings());
    expect(hints(doc)).toEqual(["What the engagement was", "What the targets did well", "Vulnerabilities and trends", "Wrap-up", "Recommendations"]);
    expect(headings(doc)).toEqual(["Recommendations"]);
    expect(doc.content?.some((n) => n.type === "generated")).toBe(false);
  });

  it("lays Methodologies out as the sample's five stages with their generated facts", () => {
    const filled = buildSectionDraft("methodology", data, settings("We followed a widely adopted approach."));
    expect(headings(filled)).toEqual(["Information Gathering", "Service Enumeration", "Penetration", "Maintaining Access", "House Cleaning"]);
    expect(kinds(filled)).toEqual([
      "paragraph",
      "heading", "slot", "G:scope",
      "heading", "slot",
      "heading", "slot", "G:msf",
      "heading", "slot",
      "heading", "slot", "G:cleanup",
    ]);
    expect(kinds(buildSectionDraft("methodology", data, settings()))[0]).toBe("heading");
  });

  it("builds the single-slot sections", () => {
    expect(hints(buildSectionDraft("considerations", data, settings()))[0]).toMatch(/^Anything that affected testing/);
    expect(buildSectionDraft("engagement-tested", data, settings()).content?.[0].attrs).toMatchObject({ kind: "tested", hostId: null });
    expect(kinds(buildSectionDraft("further", data, settings()))).toEqual(["slot"]);
    expect(kinds(buildSectionDraft("references", data, settings()))).toContain("G:references");
  });
});

describe("sectionNumbers", () => {
  const order: [string, SectionKind][] = [
    ["i", "introduction"],
    ["s", "summary"],
    ["c", "considerations"],
    ["m", "methodology"],
    ["t1", "target"],
    ["t2", "target"],
    ["ad", "ad"],
    ["et", "engagement-tested"],
    ["f", "further"],
    ["r", "references"],
  ];
  it("numbers the pages as OffSec's sample does, from the outline order", () => {
    const n = sectionNumbers(order.map(([id, kind]) => ({ id, kind })));
    const title = (t: { number: string | null; text: string } | null) => (t ? `${t.number ?? "-"} ${t.text}` : null);
    expect(Object.fromEntries([...n].map(([id, v]) => [id, [v.number, title(v.title)]]))).toEqual({
      i: ["1", "1 OffSec Certified Professional Exam Report"],
      s: ["2", "2 High-Level Summary"],
      c: [null, "- Testing Considerations"],
      m: ["3", "3 Methodologies"],
      t1: ["4.1", "4 Independent Challenges"],
      t2: ["4.2", null],
      ad: ["5", "5 Active Directory Set"],
      et: ["6", "6 Also tested"],
      f: [null, "- Further Information"],
      r: [null, "- References"],
    });
  });
  it("closes the numbers up when there are no standalone targets", () => {
    const n = sectionNumbers(order.filter(([, k]) => k !== "target").map(([id, kind]) => ({ id, kind })));
    expect(n.get("ad")).toEqual({ number: "4", title: { number: "4", text: "Active Directory Set" } });
  });
});

describe("subsectionNumbers", () => {
  const h = (text: string): ReportNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
  it("numbers the drafted sub-sections in page order and leaves the owner's own headings alone", () => {
    const doc: ReportNode = { type: "doc", content: [h("Information Gathering"), { type: "paragraph" }, h("Extra notes"), h("Penetration")] };
    expect([...subsectionNumbers("methodology", "3", doc)]).toEqual([[0, "3.1"], [3, "3.2"]]);
    expect([...subsectionNumbers("summary", "2", { type: "doc", content: [h("Recommendations")] })]).toEqual([[0, "2.1"]]);
    expect(subsectionNumbers("further", "7", doc).size).toBe(0);
  });
});
