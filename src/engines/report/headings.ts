import type { SectionKind } from "../../types/report";
import { DRAFTED_SUBSECTIONS } from "./frontMatter";
import { blockSource } from "./page/block";
import type { PageMeta, ReportNode, ReportTarget } from "./types";

/** A heading as the page prints it: its number ("4.1.2", or null for an unnumbered one) and its words. */
export interface HeadingLabel {
  number: string | null;
  text: string;
}

/**
 * The numbers of a plain target page's machine headings (source `facts:<hostId>`), by top-level index. A standalone
 * target's heading is `base` ("4.1"); in the AD set the n-th machine is `${base}.${n}`. Other headings take no number.
 */
export function targetNumbers(doc: ReportNode, target: ReportTarget, base: string): Map<number, string> {
  const out = new Map<number, string>();
  (doc.content ?? []).forEach((n, i) => {
    if (n.type !== "heading" || blockSource(n)?.kind !== "facts") return;
    out.set(i, target.kind === "ad-set" ? `${base}.${out.size + 1}` : base);
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

const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");

/** A numbered page's sub-section numbers ("3.1"…), by top-level index, in page order (OffSec's sample: 1.1, 2.1, 3.5).
 *  Only the sub-sections it is drafted with (`DRAFTED_SUBSECTIONS`) are numbered: a heading the owner adds is theirs and
 *  stays unnumbered. */
export function subsectionNumbers(kind: SectionKind, number: string, doc: ReportNode): Map<number, string> {
  const names = new Set((DRAFTED_SUBSECTIONS[kind] ?? []).map((n) => n.toLowerCase()));
  const out = new Map<number, string>();
  (doc.content ?? []).forEach((n, i) => {
    if (n.type === "heading" && names.has(textOf(n).trim().toLowerCase())) out.set(i, `${number}.${out.size + 1}`);
  });
  return out;
}
