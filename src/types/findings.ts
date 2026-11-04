export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "draft" | "confirmed" | "reported";
export type ReasonKind = "control" | "precondition" | "access" | "operator";

/** Mirrors the Rust `Finding`. Timestamps are Unix milliseconds. `lessons` is always private. */
export interface Finding {
  id: string;
  engagementId: string;
  title: string;
  severity: Severity | null;
  cvssVector: string | null;
  cvssScore: number | null;
  status: FindingStatus;
  description: string;
  impact: string;
  remediation: string;
  exploitNotes: string;
  /** Always private: exclude from any export or report. */
  lessons: string;
  refs: string[];
  hostIds: string[];
  serviceIds: string[];
  /** Log entry ids in reproduction order. */
  stepEntryIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `FindingInput`. Link sets are replaced in full on update; steps are renumbered. */
export interface FindingInput {
  title: string;
  severity?: Severity | null;
  cvssVector?: string | null;
  cvssScore?: number | null;
  /** Absent means draft. */
  status?: FindingStatus;
  description?: string;
  impact?: string;
  remediation?: string;
  exploitNotes?: string;
  lessons?: string;
  refs?: string[];
  hostIds?: string[];
  serviceIds?: string[];
  stepEntryIds?: string[];
}

/** Content is limited to 1 MiB. */
export interface FindingFile {
  id: string;
  findingId: string;
  name: string;
  language: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface FindingFileInput {
  name: string;
  language?: string | null;
  content: string;
}

/** Mirrors the Rust `FailedAttempt`. */
export interface FailedAttempt {
  id: string;
  engagementId: string;
  hostId: string | null;
  findingId: string | null;
  title: string;
  reasonKind: ReasonKind | null;
  reason: string;
  /** Set by the server: true iff reasonKind is "operator". */
  private: boolean;
  logEntryId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** `private` is derived by the server from `reasonKind`; any client value is ignored. */
export interface FailedAttemptInput {
  hostId?: string | null;
  findingId?: string | null;
  title: string;
  reasonKind?: ReasonKind | null;
  reason: string;
  logEntryId?: string | null;
}
