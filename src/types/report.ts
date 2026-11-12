/** A ProseMirror JSON document. Evidence is referenced by id, never copied in. */
export type ReportDoc = Record<string, unknown>;

export type SectionKind =
  | "details"
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
  | "references";

export interface Report {
  id: string;
  engagementId: string;
  candidateName: string;
  email: string;
  osid: string;
  title: string;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  exportedAt: number | null;
}

export interface ReportPatch {
  candidateName?: string;
  email?: string;
  osid?: string;
  title?: string;
  meta?: Record<string, unknown>;
}

export interface ReportSection {
  id: string;
  reportId: string;
  kind: SectionKind;
  /** A host id for `target`, "ad-set" for `ad`, otherwise null. */
  targetKey: string | null;
  position: number;
  doc: ReportDoc | null;
  meta: Record<string, unknown>;
  draftBuiltAt: number | null;
  updatedAt: number;
}

export interface SectionInput {
  kind: SectionKind;
  targetKey: string | null;
  position: number;
  doc: ReportDoc | null;
  meta: Record<string, unknown>;
  draftBuiltAt: number | null;
}
