import { createContext, useContext } from "react";
import type { Node as PMNode } from "prosekit/pm/model";
import type { AppendixIndex, HeadingLabel, PageHeadings, ReportData, ReportMeta, ReportNode, ReportTarget, SectionMeta } from "../../../engines/report";

/** What the section gives the page: the live rows node views render from. */
export interface ReportDataValue {
  data: ReportData;
  appendix: AppendixIndex;
  sectionMeta: SectionMeta;
  /** The owner removed an evidence block: the section remembers the entry so "Add new evidence" won't re-add it. */
  onRemoveEvidence(entryId: string): void;
  /** Report-wide inputs for the report-level tables; defaults stand in when absent. */
  reportMeta?: ReportMeta;
  /** Figures in the sections before this one, so "Figure N" counts across the document. Default 0. */
  figureOffset?: number;
  /** A screenshot's image loaded: its natural width, for the legibility check (view state, never stored). */
  onImageWidth?(entryId: string, width: number): void;
  /** Blocks may move to an appendix: only on target and AD pages, the only ones with appendix pages (spec §5.6). Default false. */
  canMove?: boolean;
  /** A target page's numbered headings ("4.1.2 Initial Access – …"), computed from its live document; absent elsewhere. */
  headingsOf?(doc: ReportNode): PageHeadings;
  /** The target the page is about: the slash menu's evidence and a pasted image's machine come from it. Absent on
   *  report-level pages. */
  target?: ReportTarget;
}

export const ReportDataContext = createContext<ReportDataValue | null>(null);

export function useReportData(): ReportDataValue {
  const value = useContext(ReportDataContext);
  if (!value) throw new Error("ReportDataContext is missing");
  return value;
}

/** Derived from the live document on every change, so positions never go stale in node views ProseMirror reuses. */
export interface PageLayout {
  sectionId: string;
  /** "Figure N" for a screenshot-bearing evidence node, numbered in document order. */
  figureOf(node: PMNode): number | null;
  /** The node's index path from the doc root ("0.2.1"), the appendix key's second half. */
  pathOf(node: PMNode): string | null;
  /** The owner has focused or clicked into the page; until then a selection is only ProseMirror's default, so blocks show no tools. */
  touched: boolean;
  /** A numbered heading of a target page by its key (`facts:<hostId>`, `phase:<hostId>:<phase>`, `attack-chain`). */
  heading(key: string): HeadingLabel | null;
}

export const PageLayoutContext = createContext<PageLayout>({ sectionId: "", figureOf: () => null, pathOf: () => null, touched: false, heading: () => null });

export const usePageLayout = () => useContext(PageLayoutContext);

/** The appendix entry a moved node points at, as "E.2, title"; null when it isn't numbered (yet). */
export function useAppendixRef(node: PMNode): string | null {
  const { appendix } = useReportData();
  const { sectionId, pathOf } = usePageLayout();
  const path = pathOf(node);
  if (path === null) return null;
  const key = `${sectionId}:${path}`;
  const ref = appendix.refFor(key);
  if (!ref) return null;
  const title = appendix.entries.find((e) => e.key === key)?.title;
  return title ? `${ref}, ${title}` : ref;
}
