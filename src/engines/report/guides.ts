import type { SectionKind } from "../../types/report";
import { sourceOf } from "./stamp";
import type { PageMeta, ReportNode } from "./types";

/**
 * Guide notes (spec §10.5): fixed text written into Raven, shown above a part of the report in the editor and never
 * in the PDF. Each says what the part is for, where Raven filled it from, and one tip, in the spirit of the mock
 * report's "From your notes" callouts. They never offer wording for the report and are never generated (§3).
 */
export type GuideId =
  | "introduction"
  | "scope"
  | "summary"
  | "findings-table"
  | "recommendations"
  | "considerations"
  | "methodology"
  | "house-cleaning"
  | "ports"
  | "result"
  | "vuln"
  | "steps"
  | "exploit"
  | "post"
  | "additional"
  | "tested"
  | "attack-path"
  | "appendix"
  | "page";

/** The id stored in Settings (`reportGuidesHidden`) that hides every guide note. */
export const ALL_GUIDES = "*";

export const GUIDES: Record<GuideId, { title: string; body: string }> = {
  introduction: {
    title: "Introduction",
    body: "What the report covers and what it must include. Raven copied it from Settings, Report details. Write it there once and every new report starts with it.",
  },
  scope: {
    title: "Scope",
    body: "Every host in scope, with the IP it had while you tested it. Raven builds the table from your hosts. After a lab revert, check the IPs are the ones you tested against.",
  },
  summary: {
    title: "High-level summary",
    body: "The short version for a reader who reads nothing else: what you got, and the root causes that repeat. Look for the same cause on more than one host.",
  },
  "findings-table": {
    title: "Findings table",
    body: "Your findings from every host, sorted by severity. Raven fills it from Findings. A credential that let you move is a finding too.",
  },
  recommendations: {
    title: "Recommendations",
    body: "One fix per root cause, not one per finding. The Remediation lines on your findings are the place to start.",
  },
  considerations: {
    title: "Testing considerations",
    body: "Anything that affected testing, good or bad: VPN drops, machine reverts, time lost. A line or two is enough.",
  },
  methodology: {
    title: "Methodologies",
    body: "How you worked, written once for every host. Raven starts it from your default methodology in Settings. Commands you ran the same way on each host belong here.",
  },
  "house-cleaning": {
    title: "House cleaning",
    body: "Every file or change you left on a target, so it can be removed. Raven lists your cleanup items. Log each upload as you make it: notes usually miss this part.",
  },
  ports: {
    title: "Service enumeration",
    body: "Keep the ports that mattered and say why in Notes. The scan itself is in the log column if you want to show it.",
  },
  result: {
    title: "Result",
    body: "What you got on this machine, with its flags, in one line. Raven fills it from your access and flags. A grader checks it against your proof screenshots.",
  },
  vuln: {
    title: "Vulnerability explanation",
    body: "Explain why the flaw works in neutral, third-person voice: what the software does wrong and what that lets anyone do.",
  },
  steps: {
    title: "Steps to reproduce",
    body: "One step per command, in order, with its output, so a reader can replay it. Raven drafted the steps from your log. A step with nothing under it is a gap a grader can't follow.",
  },
  exploit: {
    title: "Exploit code",
    body: "List every change you made to a public exploit and why. The diff marks the lines; you explain them.",
  },
  post: {
    title: "Post-exploitation",
    body: "What you did after full control: loot, credentials, the next network. Name only the credentials you went on to use.",
  },
  additional: {
    title: "Additional findings",
    body: "Flaws you found that didn't move you forward. Each still needs a severity and a remediation.",
  },
  tested: {
    title: "Also tested",
    body: "What you tried that didn't work. It shows a reader the coverage. Operator mistakes stay private.",
  },
  "attack-path": {
    title: "Attack path",
    body: "The chain through the domain, one row per hop. Raven builds it from your hops and access. The set is graded as a chain, so check no hop is missing.",
  },
  appendix: {
    title: "Appendix",
    body: "Long output moved out of the pages, numbered and linked back to where it was. Move a block here when it's too long to read inline.",
  },
  page: {
    title: "Your page",
    body: "A page for anything the report needs that has no other place. Raven puts nothing here.",
  },
};

/** Sub-section headings that carry a guide, by the page they're drafted on (frontMatter.ts names them). */
const HEADING_GUIDES: Partial<Record<SectionKind, Record<string, GuideId>>> = {
  introduction: { introduction: "introduction", scope: "scope" },
  summary: { recommendations: "recommendations" },
  methodology: { "house cleaning": "house-cleaning" },
};

const GENERATED_GUIDES: Record<string, GuideId> = {
  ports: "ports",
  result: "result",
  findings: "findings-table",
  "attack-path": "attack-path",
};

const PHASE_GUIDES: Record<string, GuideId> = { post: "post", additional: "additional", tested: "tested" };

const textOf = (node: ReportNode): string => node.text ?? (node.content ?? []).map(textOf).join("");

/** The guide shown above a block, or null. */
export function guideFor(node: ReportNode, sectionKind: SectionKind): GuideId | null {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case "phase":
      // A finding's own heading under a phase takes none: the phase's heading has it.
      return attrs.findingId ? null : (PHASE_GUIDES[String(attrs.phase)] ?? null);
    case "vuln":
      return "vuln";
    case "steps":
      return "steps";
    case "exploit":
      return "exploit";
    case "generated":
      // On a machine, Also tested's heading carries the guide; the report-level page has only the table.
      if (attrs.kind === "tested") return sectionKind === "engagement-tested" ? "tested" : null;
      return GENERATED_GUIDES[String(attrs.kind)] ?? null;
    case "heading":
      return HEADING_GUIDES[sectionKind]?.[textOf(node).trim().toLowerCase()] ?? null;
    default:
      return null;
  }
}

/** The guide shown at the top of a whole page, or null. */
export function sectionGuide(kind: SectionKind, placement?: PageMeta["placement"]): GuideId | null {
  switch (kind) {
    case "summary":
    case "considerations":
    case "methodology":
      return kind;
    case "page":
      return placement === "appendix" ? "appendix" : "page";
    default:
      return null;
  }
}

/** The guide a block's `source` carries, or null. */
function sourceGuide(source: string, kind: SectionKind): GuideId | null {
  const [head, , part] = source.split(":");
  switch (head) {
    case "ports":
    case "result":
      return head;
    case "phase-steps":
      return "steps";
    case "finding":
      return part === "explanation" ? "vuln" : null;
    case "file":
      return "exploit";
    case "attack-path":
      return source === head ? "attack-path" : null;
    case "table":
      switch (source) {
        case "table:findings":
          return "findings-table";
        case "table:scope-table":
          return "scope";
        case "table:tested":
          return kind === "engagement-tested" ? "tested" : null;
        case "table:cleanup":
          return "house-cleaning";
        default:
          return null;
      }
    default:
      return null;
  }
}

/** The guides a plain page shows, in page order without repeats: the page's own first, then one per block that carries one. */
export function guidesOf(doc: ReportNode, kind: SectionKind, placement?: PageMeta["placement"]): GuideId[] {
  const out: GuideId[] = [];
  const add = (id: GuideId | null | undefined) => {
    if (id && !out.includes(id)) out.push(id);
  };
  add(sectionGuide(kind, placement));
  const walk = (node: ReportNode) => {
    const source = sourceOf(node);
    if (source) {
      const phase = /^phase:[^:]+:(post|additional|tested)$/.exec(source)?.[1];
      add(phase ? PHASE_GUIDES[phase] : sourceGuide(source, kind));
    }
    if (node.type === "heading") add(HEADING_GUIDES[kind]?.[textOf(node).trim().toLowerCase()]);
    node.content?.forEach(walk);
  };
  doc.content?.forEach(walk);
  return out;
}

/** Whether Settings hides this guide. */
export const guideHidden = (hidden: readonly string[], id: GuideId) => hidden.includes(ALL_GUIDES) || hidden.includes(id);
