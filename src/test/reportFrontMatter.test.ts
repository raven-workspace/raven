import { describe, expect, it } from "vitest";
import { buildSectionDraft } from "../engines/report";
import type { ReportData, ReportNode } from "../engines/report";
import type { Settings } from "../types/settings";

const settings = (reportMethodology = "") => ({ reportMethodology }) as Settings;
const data = {} as ReportData;
const hints = (doc: ReportNode) => (doc.content ?? []).filter((n) => n.type === "slot").map((n) => n.attrs?.hint);
const headings = (doc: ReportNode) =>
  (doc.content ?? []).filter((n) => n.type === "heading").map((n) => n.content?.[0].text);

describe("buildSectionDraft", () => {
  it("lays out the summary", () => {
    const doc = buildSectionDraft("summary", data, settings());
    expect(hints(doc)).toEqual([
      "What the engagement was",
      "What the targets did well",
      "Vulnerabilities and trends",
      "Wrap-up",
      "Recommendations",
    ]);
    expect(doc.content?.[0].attrs?.kind).toBe("engagement-details");
    expect(headings(doc)).toEqual(["Recommendations"]);
    expect(doc.content?.some((n) => n.attrs?.kind === "exploited-systems")).toBe(true);
  });

  it("uses the Settings methodology text when set, else empty slots", () => {
    const filled = buildSectionDraft("methodology", data, settings("We followed PTES."));
    expect(headings(filled)).toEqual([
      "Information gathering",
      "Service enumeration",
      "Penetration",
      "Post-exploitation and maintaining access",
      "House cleaning",
    ]);
    expect(filled.content?.filter((n) => n.type === "paragraph")).toHaveLength(5);
    expect(hints(filled)).toEqual([]);
    expect(filled.content?.at(-1)?.attrs?.kind).toBe("severity-legend");
    expect(hints(buildSectionDraft("methodology", data, settings()))).toHaveLength(5);
  });

  it("builds the single-slot and appendix sections", () => {
    expect(hints(buildSectionDraft("considerations", data, settings()))[0]).toMatch(/^Anything that affected testing/);
    expect(buildSectionDraft("engagement-tested", data, settings()).content?.[0].attrs).toMatchObject({
      kind: "tested",
      hostId: null,
    });
    const kinds = (k: Parameters<typeof buildSectionDraft>[0]) =>
      buildSectionDraft(k, data, settings()).content?.map((n) => n.attrs?.kind ?? n.type);
    expect(kinds("appendix-proof")).toEqual(["proof-table", "slot"]);
    expect(kinds("appendix-tools")).toEqual(["tools", "slot"]);
    expect(kinds("appendix-msf")).toEqual(["msf", "slot"]);
    expect(kinds("appendix-cleanup")).toEqual(["cleanup", "slot"]);
    expect(kinds("further")).toEqual(["slot"]);
    expect(kinds("references")).toContain("references");
  });
});
