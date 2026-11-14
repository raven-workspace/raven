import { describe, expect, it } from "vitest";
import { buildSectionDraft, introductionParts, msfLine, PLAIN_NODE_TYPES, plainTable, sectionNumbers, sourceBlocks, subsectionNumbers } from "../engines/report";
import type { ReportData, ReportNode } from "../engines/report";
import type { SectionKind } from "../types/report";
import type { Settings } from "../types/settings";

const settings = (reportMethodology = "", reportIntroduction = "") => ({ reportMethodology, reportIntroduction }) as Settings;
const data = {
  engagement: { kind: "exam-sim" },
  hosts: [],
  services: [],
  log: [],
  findings: [],
  attempts: [],
  ruledOut: [],
  grants: [],
  hops: [],
  cleanup: [],
} as unknown as ReportData;
const headings = (doc: ReportNode) =>
  (doc.content ?? []).filter((n) => n.type === "heading").map((n) => n.content?.[0].text);
const cellText = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(cellText).join("");
const hints = (doc: ReportNode) => (doc.content ?? []).filter((n) => n.type === "paragraph" && !n.content).map((n) => n.attrs?.hint);
/** Top-level block types, a sourced one as type@source. */
const kinds = (doc: ReportNode) => (doc.content ?? []).map((n) => (n.attrs?.source ? `${n.type}@${n.attrs.source}` : n.type));

describe("buildSectionDraft", () => {
  it("lays section 1 out as Introduction, Objective and Requirements, hint paragraphs without a Settings default", () => {
    const doc = buildSectionDraft("introduction", data, settings());
    expect(headings(doc)).toEqual(["Introduction", "Objective", "Requirements", "Scope"]);
    expect(kinds(doc)).toEqual(["heading", "paragraph", "heading", "paragraph", "heading", "paragraph", "heading", "paragraph@table:scope-table"]);
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
    expect(kinds(doc)).toEqual(["heading", "paragraph", "heading", "paragraph", "heading", "paragraph", "list", "list", "heading", "paragraph@table:scope-table"]);
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

  it("lays out the summary: four prose slots, the findings table, then 2.1 Recommendations", () => {
    const doc = buildSectionDraft("summary", data, settings());
    expect(hints(doc)).toEqual(["What the engagement was", "What the targets did well", "Vulnerabilities and trends", "Wrap-up", "No findings recorded yet", "Recommendations"]);
    expect(headings(doc)).toEqual(["Recommendations"]);
    expect(kinds(doc)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph", "paragraph@table:findings", "heading", "paragraph"]);
  });

  it("ends the introduction with a Scope subheading and the scope table, numbered 1.4", () => {
    const doc = buildSectionDraft("introduction", data, settings());
    expect(kinds(doc).slice(-2)).toEqual(["heading", "paragraph@table:scope-table"]);
    expect(headings(doc).at(-1)).toBe("Scope");
    expect(subsectionNumbers("introduction", "1", doc).get((doc.content?.length ?? 0) - 2)).toBe("1.4");
  });

  it("lays Methodologies out as the sample's five stages with their generated facts", () => {
    const filled = buildSectionDraft("methodology", data, settings("We followed a widely adopted approach."));
    expect(headings(filled)).toEqual(["Information Gathering", "Service Enumeration", "Penetration", "Maintaining Access", "House Cleaning"]);
    expect(kinds(filled)).toEqual([
      "paragraph",
      "heading", "paragraph",
      "heading", "paragraph",
      "heading", "paragraph", "paragraph@msf",
      "heading", "paragraph",
      "heading", "paragraph", "paragraph@table:cleanup",
    ]);
    expect(kinds(buildSectionDraft("methodology", data, settings()))[0]).toBe("heading");
  });

  it("builds the single-slot sections", () => {
    expect(hints(buildSectionDraft("considerations", data, settings()))[0]).toMatch(/^Anything that affected testing/);
    expect(buildSectionDraft("engagement-tested", data, settings()).content?.[0].attrs).toMatchObject({ source: "table:tested", hint: "Services you tested that led nowhere appear here as you log them" });
    expect(kinds(buildSectionDraft("further", data, settings()))).toEqual(["paragraph"]);
    expect(kinds(buildSectionDraft("references", data, settings()))).toContain("paragraph@table:references");
  });
});

const full = {
  ...data,
  checklist: [],
  findingFiles: [],
  attachments: [],
  hosts: [{ id: "h1", name: "DC01", ip: "10.0.0.5", os: "Windows", private: false }],
  findings: [{ id: "f1", title: "SMB signing", severity: "high", hostIds: ["h1"], serviceIds: [], stepEntryIds: [], refs: [], description: "", remediation: "", private: false }],
} as unknown as ReportData;

describe("plain front matter", () => {
  const PLAIN = new Set([...PLAIN_NODE_TYPES]);
  const types = (n: ReportNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];
  it.each(["introduction", "summary", "considerations", "methodology", "engagement-tested", "further", "references"] as const)(
    "%s is made of plain nodes only",
    (kind) => {
      expect(types(buildSectionDraft(kind, data, settings(), {})).every((t) => PLAIN.has(t))).toBe(true);
    },
  );
  it("an unwritten summary prints nothing: hints and the findings hint only", () => {
    const doc = buildSectionDraft("summary", { ...data, findings: [] }, settings(), {});
    expect(doc.content!.filter((n) => n.type === "paragraph").every((p) => !p.content && typeof p.attrs?.hint === "string")).toBe(true);
    expect(doc.content!.find((n) => n.attrs?.source === "table:findings")).toMatchObject({ type: "paragraph", attrs: { hint: "No findings recorded yet" } });
  });
  it("the summary's findings table is an ordinary table with its source", () => {
    const t = buildSectionDraft("summary", full, settings(), {}).content!.find((n) => n.type === "table")!;
    expect(t.attrs).toMatchObject({ source: "table:findings", gen: expect.any(String) });
    expect(t.content![0].content!.map(cellText)).toEqual(["#", "Host", "Finding", "Severity", "Result"]);
  });
  it("Methodologies' Penetration carries the Metasploit line as plain text", () => {
    const doc = buildSectionDraft("methodology", data, settings(), {});
    expect(doc.content!.find((n) => n.attrs?.source === "msf")).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: expect.stringMatching(/^Metasploit was (used on|not used)/) }],
    });
  });
  it("sourceBlocks refreshes a front-matter table and the Metasploit line", () => {
    expect(sourceBlocks("table:scope-table", full, null, {})).toEqual(plainTable("scope-table", full, {}));
    expect(sourceBlocks("msf", data, null, {})).toHaveLength(1);
  });
  it("a draft's empty findings hint is replaced by the table once findings exist", () => {
    expect(buildSectionDraft("summary", data, settings(), {}).content!.some((n) => n.attrs?.source === "table:findings" && n.type === "paragraph")).toBe(true);
    const refreshed = sourceBlocks("table:findings", full, null, {})!;
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({ type: "table", attrs: { source: "table:findings" } });
  });
  it("hints for empty tested and references say where the content comes from", () => {
    expect(plainTable("tested", data, {})[0].attrs?.hint).toBe("Services you tested that led nowhere appear here as you log them");
    expect(plainTable("references", data, {})[0].attrs?.hint).toBe("References from your findings appear here");
  });
  it("tested, cleanup and references print rows when there are some", () => {
    const rich = {
      ...full,
      attempts: [],
      ruledOut: [{ id: "r1", text: "FTP anonymous", reason: "login refused", private: false, hostId: null, sourceKind: "manual", sourceId: null }],
      cleanup: [{ id: "c1", hostId: "h1", kind: "file", target: "C:\\shell.exe", status: "removed" }],
      findings: [{ ...full.findings[0], refs: ["CVE-2020-0796"] }],
    } as unknown as ReportData;
    const tested = plainTable("tested", rich, {})[0];
    expect(tested).toMatchObject({ type: "table", attrs: { source: "table:tested" } });
    expect(tested.content![1].content!.map(cellText)).toEqual(["FTP anonymous", "login refused"]);
    expect(plainTable("cleanup", rich, {})[0].content![1].content!.map(cellText)).toEqual(["C:\\shell.exe", "DC01", "file", "Removed"]);
    const refs = plainTable("references", rich, {});
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: "paragraph", attrs: { source: "table:references", gen: expect.any(String) } });
    expect(cellText(refs[0])).toBe("CVE-2020-0796");
  });
  it("the Metasploit line names the host and the modules", () => {
    const used = {
      ...full,
      log: [{ id: "m1", private: false, hostIds: ["h1"], content: { kind: "command", blocks: [{ command: "msfconsole -q\nuse exploit/windows/smb/ms17_010_eternalblue", output: "" }] } }],
    } as unknown as ReportData;
    expect(cellText(msfLine(used))).toBe("Metasploit was used on DC01 (10.0.0.5): exploit/windows/smb/ms17_010_eternalblue.");
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
