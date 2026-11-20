import type { FlagKind } from "./log";

/** A ProseMirror JSON node; a stored page is its `doc` node. Evidence is referenced by id, never copied in. */
export type ReportNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ReportNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

/** Stored in `reports.meta`. Dates are ISO yyyy-mm-dd. */
export interface ReportMeta {
  /** Labs only. */
  includedHostIds?: string[];
  /** Per host id. */
  expectedFlags?: Record<string, FlagKind[]>;
  examEndAt?: number;
  examDate?: string;
  reportDate?: string;
  /** Report-level check ids the owner dismissed from To do (a false positive): not counted, listed as dismissed. */
  dismissedChecks?: string[];
}

/** `appendix-*` kinds are no longer created (layout 2 has no generated appendices); old rows stay hidden. */
export type SectionKind =
  | "details"
  | "introduction"
  | "summary"
  | "considerations"
  | "methodology"
  | "target"
  | "ad"
  | "engagement-tested"
  | "appendix-proof"
  | "appendix-tools"
  | "appendix-msf"
  | "appendix-cleanup"
  | "further"
  | "references"
  /** An owner-written page (+ Page): an appendix page or a free page, keyed by a fresh id. */
  | "page";

export interface Report {
  id: string;
  engagementId: string;
  candidateName: string;
  email: string;
  osid: string;
  title: string;
  meta: ReportMeta;
  createdAt: number;
  updatedAt: number;
  exportedAt: number | null;
}

export interface ReportPatch {
  candidateName?: string;
  email?: string;
  osid?: string;
  title?: string;
  meta?: ReportMeta;
}

export interface ReportSection {
  id: string;
  reportId: string;
  kind: SectionKind;
  /** A host id for `target`, "ad-set" for `ad`, a fresh id for `page`, otherwise null. */
  targetKey: string | null;
  position: number;
  doc: ReportNode | null;
  meta: Record<string, unknown>;
  draftBuiltAt: number | null;
  updatedAt: number;
}

export interface SectionInput {
  kind: SectionKind;
  targetKey: string | null;
  position: number;
  doc: ReportNode | null;
  meta: Record<string, unknown>;
  draftBuiltAt: number | null;
}
