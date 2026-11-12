import type { SectionKind } from "../../types/report";
import type { Settings } from "../../types/settings";
import { FIXED_LETTERS } from "./appendix";
import { generated, slot } from "./draft";
import type { ReportData, ReportNode } from "./types";

const CONSIDERATIONS_HINT = "Anything that affected testing: positive, neutral or negative (VPN drops, machine reverts, time)";

const STAGES = [
  "Information gathering",
  "Service enumeration",
  "Penetration",
  "Post-exploitation and maintaining access",
  "House cleaning",
];

const heading = (text: string): ReportNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (content: ReportNode[]): ReportNode => ({ type: "doc", content });

/** The methodology text split into paragraphs on blank lines; none when blank. */
const methodologyParagraphs = (text: string): ReportNode[] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(paragraph);

/** The starting document of a front-matter or appendix section (§5.4); `target`, `ad` and `details` have none here. */
export function buildSectionDraft(kind: SectionKind, _data: ReportData, settings: Settings): ReportNode {
  switch (kind) {
    case "summary":
      return doc([
        generated("engagement-details", null),
        slot("What the engagement was"),
        slot("What the targets did well"),
        slot("Vulnerabilities and trends"),
        slot("Wrap-up"),
        generated("exploited-systems", null),
        heading("Recommendations"),
        slot("Recommendations"),
      ]);
    case "considerations":
      return doc([slot(CONSIDERATIONS_HINT)]);
    case "methodology": {
      const text = methodologyParagraphs(settings.reportMethodology ?? "");
      return doc([
        ...text,
        ...STAGES.flatMap((stage) => [heading(stage), slot(`How ${stage.toLowerCase()} was done`)]),
        generated("severity-legend", null),
      ]);
    }
    case "engagement-tested":
      return doc([generated("tested", null)]);
    case "appendix-proof":
      return doc([generated("proof-table", null), slot("Notes on the proof files")]);
    case "appendix-tools":
      return doc([generated("tools", null), slot("Notes on the tools used")]);
    case "appendix-msf":
      return doc([generated("msf", null), slot("Notes on the Metasploit use")]);
    case "appendix-cleanup":
      return doc([generated("cleanup", null), slot("Notes on the clean-up")]);
    case "further":
      return doc([slot("Further information")]);
    case "references":
      return doc([slot("Anything else to cite"), generated("references", null)]);
    default:
      return doc([]);
  }
}


/** The names of the report-level pages, as the outline lists them. */
export const SECTION_NAMES: Partial<Record<SectionKind, string>> = {
  details: "Report details",
  summary: "High-level summary",
  considerations: "Testing considerations",
  methodology: "Methodology",
  "engagement-tested": "Tested, not exploited",
  "appendix-proof": "Proof table",
  "appendix-tools": "Tools and payloads",
  "appendix-msf": "Metasploit usage",
  "appendix-cleanup": "House cleaning",
  further: "Further information",
  references: "References",
};

/**
 * The title printed at the top of a report-level page, from its kind (never stored, so every saved page has it):
 * "High-level summary", "Appendix A: Proof table". Targets and the AD set carry their own title; Report details is a form.
 */
export function pageTitle(kind: SectionKind): string | null {
  if (kind === "details") return null;
  const name = SECTION_NAMES[kind];
  if (!name) return null;
  const letter = FIXED_LETTERS[kind];
  return letter ? `Appendix ${letter}: ${name}` : name;
}
