import type { SectionKind } from "../../types/report";
import type { PageMeta, Phase, ReportData, ReportNode, ReportTarget } from "./types";

/** A heading as the page prints it: its number ("4.1.2", or null for an unnumbered one) and its words. */
export interface HeadingLabel {
  number: string | null;
  text: string;
}

/** Phase headings in OffSec's sample wording. */
export const PHASE_TITLES: Record<Phase, string> = {
  enum: "Service Enumeration",
  foothold: "Initial Access",
  privesc: "Privilege Escalation",
  lateral: "Lateral Movement",
  domain: "Domain Compromise",
  tested: "Also tested",
  post: "Post-Exploitation",
  additional: "Additional findings",
};

/** Phases a vulnerability opens, so the heading names it: "Initial Access – SMB share to WordPress RCE". */
const TITLED = new Set<Phase>(["foothold", "privesc", "lateral", "domain"]);

/** The numbers of a target page's headings, keyed `facts:<hostId>`, `phase:<hostId>:<phase>` (with
 *  `:<findingId>` for a finding's own heading) and `attack-chain`. */
export type PageHeadings = Map<string, HeadingLabel>;

/** A phase heading's key; a finding's own heading (`findingId`) has one of its own. */
export const phaseKey = (hostId: string, phase: Phase, findingId?: string | null) =>
  findingId ? `phase:${hostId}:${phase}:${findingId}` : `phase:${hostId}:${phase}`;
export const machineKey = (hostId: string) => `facts:${hostId}`;
export const CHAIN_KEY = "attack-chain";

/**
 * Numbers a target page's headings from its document, never stored: a standalone target is `base` ("4.2", printed
 * "Target #2 – <IP>"), its sub-sections `base.1`, `base.2` in page order; in the AD set (`base` "5") each machine is
 * `5.N <name> – <IP>`, its sub-sections `5.N.1`…, and the attack chain the next machine number. Also tested and a finding's
 * own heading under Additional findings take no number. A titled phase names the first vulnerability under it.
 */
export function targetHeadings(doc: ReportNode, data: ReportData, target: ReportTarget, base: string, ordinal: number): PageHeadings {
  const out: PageHeadings = new Map();
  const content = doc.content ?? [];
  const sub = new Map<string, number>();
  let machines = 0;
  const hostLabel = (hostId: string): HeadingLabel => {
    const host = data.hosts.find((h) => h.id === hostId);
    const ip = host?.ip || host?.name || "Host";
    if (target.kind === "standalone") return { number: base, text: `Target #${ordinal} – ${ip}` };
    machines++;
    return { number: `${base}.${machines}`, text: host?.ip ? `${host.name} – ${host.ip}` : (host?.name ?? "Host") };
  };
  content.forEach((n, i) => {
    const attrs = n.attrs ?? {};
    if (n.type === "generated" && attrs.kind === "facts" && typeof attrs.hostId === "string") {
      if (!out.has(machineKey(attrs.hostId))) out.set(machineKey(attrs.hostId), hostLabel(attrs.hostId));
      return;
    }
    if (n.type === "generated" && attrs.kind === "attack-chain") {
      out.set(CHAIN_KEY, { number: target.kind === "ad-set" ? `${base}.${machines + 1}` : null, text: "Attack Chain" });
      return;
    }
    if (n.type !== "phase" || typeof attrs.hostId !== "string") return;
    const hostId = attrs.hostId;
    const phase = attrs.phase as Phase;
    const findingId = typeof attrs.findingId === "string" && attrs.findingId !== "" ? attrs.findingId : null;
    const key = phaseKey(hostId, phase, findingId);
    if (out.has(key)) return;
    let text = PHASE_TITLES[phase] ?? String(phase);
    if (findingId) {
      // A finding's own heading: under Additional findings its title alone, unnumbered; a further finding that enabled
      // the phase, the phase named after it and numbered like the phase.
      const title = data.findings.find((f) => f.id === findingId)?.title.trim() || "Finding";
      if (phase === "additional") {
        out.set(key, { number: null, text: title });
        return;
      }
      text = `${text} – ${title}`;
    } else if (TITLED.has(phase)) {
      // The first vulnerability before the region ends (the next heading or the next machine).
      const isFinding = (m: ReportNode) => m.type === "vuln" || m.type === "finding";
      const vuln = content
        .slice(i + 1)
        .find((m) => isFinding(m) || m.type === "phase" || ((m.type === "generated" || m.type === "table-block") && m.attrs?.kind !== "tested"));
      const finding = vuln && isFinding(vuln) ? data.findings.find((f) => f.id === vuln.attrs?.findingId) : undefined;
      if (finding?.title.trim()) text = `${text} – ${finding.title.trim()}`;
    }
    if (phase === "tested") {
      out.set(key, { number: null, text });
      return;
    }
    const machine = out.get(machineKey(hostId))?.number ?? base;
    const k = (sub.get(hostId) ?? 0) + 1;
    sub.set(hostId, k);
    out.set(key, { number: `${machine}.${k}`, text });
  });
  return out;
}

/** A report-level page's number and title, from the outline order. */
export interface SectionNumber {
  /** "1", "4.2"; null for an unnumbered page (Testing considerations, the closing pages). */
  number: string | null;
  /** The title printed at the top of the page ("3", "Methodologies"), or null when the page has none (a target after
   *  the first). */
  title: HeadingLabel | null;
}

/** The sample's chapter titles. */
const CHAPTERS: Partial<Record<SectionKind, string>> = {
  introduction: "OffSec Certified Professional Exam Report",
  summary: "High-Level Summary",
  methodology: "Methodologies",
  ad: "Active Directory Set",
  "engagement-tested": "Also tested",
};
const UNNUMBERED: Partial<Record<SectionKind, string>> = {
  considerations: "Testing Considerations",
  further: "Further Information",
  references: "References",
};

/**
 * Numbers the report's pages in outline order, as OffSec's sample does: 1 the exam report, 2 the summary, 3
 * Methodologies, then the standalone targets as one chapter (Independent Challenges, each target `4.N`, the chapter
 * title on the first), the AD set and engagement-level Also tested as chapters of their own. A free page (+ Page) is a
 * chapter of its own under its title; an appendix page takes no number (its letter comes from `numberAppendices`).
 */
export function sectionNumbers(sections: { id: string; kind: SectionKind; meta?: unknown }[]): Map<string, SectionNumber> {
  const out = new Map<string, SectionNumber>();
  let chapter = 0;
  let targetsChapter = 0;
  let targets = 0;
  for (const s of sections) {
    if (s.kind === "target") {
      if (targetsChapter === 0) targetsChapter = ++chapter;
      targets++;
      out.set(s.id, {
        number: `${targetsChapter}.${targets}`,
        title: targets === 1 ? { number: `${targetsChapter}`, text: "Independent Challenges" } : null,
      });
      continue;
    }
    if (s.kind === "page") {
      const meta = (s.meta ?? {}) as Partial<PageMeta>;
      if (meta.placement === "body") {
        chapter++;
        out.set(s.id, { number: `${chapter}`, title: { number: `${chapter}`, text: meta.title?.trim() || "Untitled page" } });
      } else out.set(s.id, { number: null, title: null });
      continue;
    }
    const name = CHAPTERS[s.kind];
    if (name) {
      chapter++;
      out.set(s.id, { number: `${chapter}`, title: { number: `${chapter}`, text: name } });
      continue;
    }
    const text = UNNUMBERED[s.kind];
    out.set(s.id, { number: null, title: text ? { number: null, text } : null });
  }
  return out;
}

/** The sub-sections a report-level page is drafted with, as the sample names them. Only these are numbered: a heading
 *  the owner adds is theirs and stays unnumbered. */
const SUBSECTIONS: Partial<Record<SectionKind, string[]>> = {
  introduction: ["Introduction", "Objective", "Requirements", "Scope"],
  summary: ["Recommendations"],
  methodology: ["Information Gathering", "Service Enumeration", "Penetration", "Maintaining Access", "House Cleaning"],
};

const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");

/** A numbered page's sub-section numbers ("3.1"…), by top-level index, in page order (OffSec's sample: 1.1, 2.1, 3.5). */
export function subsectionNumbers(kind: SectionKind, number: string, doc: ReportNode): Map<number, string> {
  const names = new Set((SUBSECTIONS[kind] ?? []).map((n) => n.toLowerCase()));
  const out = new Map<number, string>();
  (doc.content ?? []).forEach((n, i) => {
    if (n.type === "heading" && names.has(textOf(n).trim().toLowerCase())) out.set(i, `${number}.${out.size + 1}`);
  });
  return out;
}
