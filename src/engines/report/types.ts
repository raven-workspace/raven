import type { AccessGrant, Credential, Username } from "../../types/credentials";
import type { CleanupItem } from "../../types/cleanup";
import type { ChecklistItem } from "../../types/checklist";
import type { Engagement } from "../../types/engagement";
import type { FailedAttempt, Finding, FindingFile } from "../../types/findings";
import type { Host } from "../../types/host";
import type { FlagKind, LogEntry } from "../../types/log";
import type { Hop } from "../../types/network";
import type { Note, RuledOut } from "../../types/notes";
import type { Service } from "../../types/service";

export type { FlagKind };

/** Everything the report engine reads, loaded for one engagement. */
export interface ReportData {
  engagement: Engagement;
  hosts: Host[];
  services: Service[];
  log: LogEntry[];
  checklist: ChecklistItem[];
  findings: Finding[];
  findingFiles: FindingFile[];
  attempts: FailedAttempt[];
  ruledOut: RuledOut[];
  grants: AccessGrant[];
  usernames: Username[];
  hops: Hop[];
  cleanup: CleanupItem[];
  notes: Note[];
  credentials: Credential[];
}

/** Stored in `reports.meta`. Dates are ISO yyyy-mm-dd. */
export interface ReportMeta {
  /** Labs only. */
  includedHostIds?: string[];
  /** Per host id. */
  expectedFlags?: Record<string, FlagKind[]>;
  examEndAt?: number;
  examDate?: string;
  reportDate?: string;
}

export type CoverageResult = "exploited" | "tested" | "untested";
export interface CoverageOverride {
  result: CoverageResult;
  note?: string;
}

/** Stored in `report_sections.meta`. */
export interface SectionMeta {
  removedEntryIds?: string[];
  coverage?: Record<string, CoverageOverride>;
  method?: string;
}

export type TargetKind = "standalone" | "ad-set";
export interface ReportTarget {
  key: string;
  kind: TargetKind;
  hostIds: string[];
}

export type ReportNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ReportNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};
