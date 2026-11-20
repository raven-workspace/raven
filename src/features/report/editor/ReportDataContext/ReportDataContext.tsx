import { createContext, useContext } from "react";
import type { ReportData, ReportMeta, ReportTarget } from "../../../../engines/report/index";

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
}

export const ReportDataContext = createContext<ReportDataValue | null>(null);

export function usePageContext(): ReportDataValue {
  const value = useContext(ReportDataContext);
  if (!value) throw new Error("ReportDataContext is missing");
  return value;
}
