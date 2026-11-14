import type { SectionKind } from "../../types/report";
import type { Settings } from "../../types/settings";
import { hintPara, msfLine, plainTable, type PlainTableKind } from "./plainTables";
import type { ReportData, ReportMeta, ReportNode } from "./types";

const CONSIDERATIONS_HINT = "Anything that affected testing: positive, neutral or negative (VPN drops, machine reverts, time)";

/** Section 1's parts, in the sample's order, with the hint each empty part shows. */
const INTRO_PARTS: [string, string][] = [
  ["Introduction", "What this report contains and how it will be graded"],
  ["Objective", "The objective of the assessment"],
  ["Requirements", "What the report is required to include"],
];

/** Methodologies' stages in the sample's order, each with the generated fact it carries, if any: the Metasploit line
 *  stays live, the clean-up list is the page's own table. */
const STAGES: [string, "msf" | "cleanup" | null][] = [
  ["Information Gathering", null],
  ["Service Enumeration", null],
  ["Penetration", "msf"],
  ["Maintaining Access", null],
  ["House Cleaning", "cleanup"],
];

const heading = (text: string): ReportNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (content: ReportNode[]): ReportNode => ({ type: "doc", content });

const BULLET = /^\s*[-*•·]\s+/;

/**
 * Text as page blocks: paragraphs split on blank lines, with a run of hard-wrapped lines (a paste from a PDF) joined
 * into one paragraph, and lines starting with a bullet (-, *, •, ·) as a bulleted list. None when blank.
 */
function textBlocks(text: string): ReportNode[] {
  const out: ReportNode[] = [];
  let para: string[] = [];
  let items: string[] = [];
  const flushPara = () => {
    if (para.length > 0) out.push(paragraph(para.join(" ")));
    para = [];
  };
  const flushList = () => {
    if (items.length > 0) {
      for (const t of items) out.push({ type: "list", attrs: { kind: "bullet" }, content: [paragraph(t)] });
    }
    items = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
    } else if (BULLET.test(raw)) {
      flushPara();
      items.push(line.replace(BULLET, ""));
    } else if (items.length > 0 && para.length === 0) {
      // A wrapped bullet (a paste from a PDF) continues on the next line; a blank line ends the list.
      items[items.length - 1] += ` ${line}`;
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

/** A line naming one of section 1's parts, numbered or not ("1.2 Objective"). */
const PART_LINE = /^\s*(?:\d+(?:\.\d+)*\.?\s+)?(introduction|objective|requirements)\s*:?\s*$/i;

/**
 * The Settings text split into section 1's parts: a line reading Introduction, Objective or Requirements starts that
 * part; text before any such line is the introduction.
 */
export function introductionParts(text: string): Record<string, string> {
  const parts: Record<string, string[]> = { Introduction: [], Objective: [], Requirements: [] };
  let current = "Introduction";
  for (const line of text.split(/\r?\n/)) {
    const m = PART_LINE.exec(line);
    if (m) current = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    else parts[current].push(line);
  }
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.join("\n").trim()]));
}

/** The starting document of a report-level section (§5.5); `target`, `ad` and `details` have none here. Generated
 *  tables are the page's own copies (§10.8), built from `data` with the report's targets (`meta`). */
export function buildSectionDraft(kind: SectionKind, data: ReportData, settings: Settings, meta: ReportMeta = {}): ReportNode {
  const copy = (k: PlainTableKind) => plainTable(k, data, meta);
  switch (kind) {
    case "introduction": {
      const parts = introductionParts(settings.reportIntroduction ?? "");
      return doc([
        ...INTRO_PARTS.flatMap(([name, hint]) => {
          const blocks = textBlocks(parts[name]);
          return [heading(name), ...(blocks.length > 0 ? blocks : [hintPara(hint)])];
        }),
        heading("Scope"),
        ...copy("scope-table"),
      ]);
    }
    case "summary":
      return doc([
        hintPara("What the engagement was"),
        hintPara("What the targets did well"),
        hintPara("Vulnerabilities and trends"),
        hintPara("Wrap-up"),
        ...copy("findings"),
        heading("Recommendations"),
        hintPara("Recommendations"),
      ]);
    case "considerations":
      return doc([hintPara(CONSIDERATIONS_HINT)]);
    case "methodology":
      return doc([
        ...textBlocks(settings.reportMethodology ?? ""),
        ...STAGES.flatMap(([stage, fact]) => [
          heading(stage),
          hintPara(`How ${stage.toLowerCase()} was done`),
          ...(fact === "msf" ? [msfLine(data)] : fact === "cleanup" ? copy("cleanup") : []),
        ]),
      ]);
    case "engagement-tested":
      return doc(copy("tested"));
    case "further":
      return doc([hintPara("Further information")]);
    case "references":
      return doc([hintPara("Anything else to cite"), ...copy("references")]);
    default:
      return doc([]);
  }
}

/** The names of the report-level pages, as the outline lists them. */
export const SECTION_NAMES: Partial<Record<SectionKind, string>> = {
  details: "Report details",
  introduction: "Exam report",
  summary: "High-level summary",
  considerations: "Testing considerations",
  methodology: "Methodologies",
  "engagement-tested": "Also tested",
  further: "Further information",
  references: "References",
};
