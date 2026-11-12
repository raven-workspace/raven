import { createContext, useContext } from "react";
import type { Node as PMNode } from "prosekit/pm/model";
import type { AppendixIndex, ReportData, ReportMeta, SectionMeta } from "../../../engines/report";

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
  /** Each target section's meta by target key (exploited-systems methods). */
  targetMeta?: Record<string, SectionMeta>;
  /** A screenshot's image loaded: its natural width, for the legibility check (view state, never stored). */
  onImageWidth?(entryId: string, width: number): void;
  /** Edits the open section's meta (the Tools appendix's own purposes and URLs); absent where the page is read-only. */
  onSectionMeta?(patch: Partial<SectionMeta>): void;
  /** Blocks may move to an appendix: only on target and AD pages, the only ones with appendix pages (spec §5.6). Default false. */
  canMove?: boolean;
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
}

export const PageLayoutContext = createContext<PageLayout>({ sectionId: "", figureOf: () => null, pathOf: () => null, touched: false });

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
