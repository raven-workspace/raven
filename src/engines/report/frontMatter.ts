import type { SectionKind } from "../../types/report";
import type { Settings } from "../../types/settings";
import { doc, heading, listItem, para, text as textNode } from "./nodes";
import { hintPara, msfLine, plainTable, type PlainTableKind } from "./plainTables";
import type { ReportData, ReportMeta, ReportNode } from "./types";

const CONSIDERATIONS_HINT = "Anything that affected testing: positive, neutral or negative (VPN drops, machine reverts, time)";

/** Drafted sub-section headings a guide note is tied to (`guides.ts`). */
export const INTRODUCTION = "Introduction";
export const SCOPE = "Scope";
export const RECOMMENDATIONS = "Recommendations";
export const HOUSE_CLEANING = "House Cleaning";

/** Section 1's parts, in the sample's order, with the hint each empty part shows. */
const INTRO_PARTS: [string, string][] = [
  [INTRODUCTION, "What this report contains and how it will be graded"],
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
  [HOUSE_CLEANING, "cleanup"],
];

/** The sub-section headings each report-level page is drafted with, in page order: the ones `subsectionNumbers` numbers
 *  and the guide notes look for, so renaming one here renames it there too. */
export const DRAFTED_SUBSECTIONS: Partial<Record<SectionKind, string[]>> = {
  introduction: [...INTRO_PARTS.map(([name]) => name), SCOPE],
  summary: [RECOMMENDATIONS],
  methodology: STAGES.map(([stage]) => stage),
};

const BULLET = /^\s*[-*•·]\s+/;

/**
 * Text as page blocks: paragraphs split on blank lines, with a run of hard-wrapped lines (a paste from a PDF) joined
 * into one paragraph, and lines starting with a bullet (-, *, •, ·) as a bulleted list. None when blank.
 */
function settingsBlocks(text: string): ReportNode[] {
  const out: ReportNode[] = [];
  let lines: string[] = [];
  let items: string[] = [];
  const flushPara = () => {
    if (lines.length > 0) out.push(para([textNode(lines.join(" "))]));
    lines = [];
  };
  const flushList = () => {
    if (items.length > 0) {
      for (const t of items) out.push(listItem("bullet", [para([textNode(t)])]));
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
    } else if (items.length > 0 && lines.length === 0) {
      // A wrapped bullet (a paste from a PDF) continues on the next line; a blank line ends the list.
      items[items.length - 1] += ` ${line}`;
    } else {
      flushList();
      lines.push(line);
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
          const blocks = settingsBlocks(parts[name]);
          return [heading(2, name), ...(blocks.length > 0 ? blocks : [hintPara(hint)])];
        }),
        heading(2, SCOPE),
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
        heading(2, RECOMMENDATIONS),
        hintPara("Recommendations"),
      ]);
    case "considerations":
      return doc([hintPara(CONSIDERATIONS_HINT)]);
    case "methodology":
      return doc([
        ...settingsBlocks(settings.reportMethodology ?? ""),
        ...STAGES.flatMap(([stage, fact]) => [
          heading(2, stage),
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
