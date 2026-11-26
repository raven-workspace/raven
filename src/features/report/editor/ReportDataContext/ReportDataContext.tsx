import type { Node as PMNode } from "prosekit/pm/model";
import { createContext, useContext } from "react";
import type { ReportData, ReportMeta, ReportNode, ReportTarget } from "../../../../engines/report/index";

/** What the section gives the page: the live rows the editor's chrome (slash menu, block handle, find bar) reads. */
export interface ReportDataValue {
  data: ReportData;
  /** The owner removed an evidence block: the section remembers the entry so "Add new evidence" won't re-add it. */
  onRemoveEvidence(entryId: string): void;
  /** Report-wide inputs for the report-level tables; defaults stand in when absent. */
  reportMeta?: ReportMeta;
  /** A screenshot's image loaded: its natural width, for the legibility check (view state, never stored). */
  onImageWidth?(entryId: string, width: number): void;
  /** The target the page is about: the slash menu's evidence and a pasted image's machine come from it. Absent on
   *  report-level pages. */
  target?: ReportTarget;
  /** Move to appendix (§10.4): the report's appendix pages a block can move to, in letter order, each labelled
   *  "Appendix C – <title>". Absent on an appendix page, which offers no move. */
  appendices?: { sectionId: string; label: string }[];
  /** Moves a block to the end of an appendix page, or of a new one when `appendixId` is null. */
  onMoveToAppendix?(block: { node: PMNode; pos: number }, appendixId: string | null): void;
  /** The report's appendix pages other than this one, as stored: an entry on one is in the report, so this page
   *  doesn't offer it again. */
  otherPages?: ReportNode[];
}

export const ReportDataContext = createContext<ReportDataValue | null>(null);

export function usePageContext(): ReportDataValue {
  const value = useContext(ReportDataContext);
  if (!value) throw new Error("ReportDataContext is missing");
  return value;
}
