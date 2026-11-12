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

/** The owner's own purpose or URL for a row of the Tools appendix. */
export interface ToolOverride {
  purpose?: string;
  url?: string;
}

/** Stored in `report_sections.meta`. */
export interface SectionMeta {
  removedEntryIds?: string[];
  coverage?: Record<string, CoverageOverride>;
  method?: string;
  /** The Tools appendix's per-row edits, by the tool name the row prints. */
  tools?: Record<string, ToolOverride>;
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

/* Node vocabulary: the contract the editor schema implements. */

/** A sub-section heading of a target. `tested` and `proof` close every target. */
export type Phase = "foothold" | "privesc" | "lateral" | "domain" | "proof" | "tested";

export type GeneratedKind =
  | "facts"
  | "services"
  | "vulns"
  | "tested"
  | "proof-table-host"
  | "engagement-details"
  | "exploited-systems"
  | "severity-legend"
  | "ad-overview"
  | "attack-chain"
  | "proof-table"
  | "tools"
  | "msf"
  | "cleanup"
  | "references";

/** Where a block's content sits: in the flow, moved to an appendix, or trimmed inline with the full copy there. */
export type AppendixPlacement = "inline" | "moved" | "split";

/** A prose slot; an empty one shows its hint and never exports. */
export interface SlotAttrs {
  hint: string;
}

export interface PhaseAttrs {
  phase: Phase;
  hostId: string;
}

export interface EvidenceAttrs {
  entryId: string;
  /** Index into a command entry's `content.blocks`; null = the whole entry. */
  block: number | null;
  /** Inclusive line ranges kept inline; null = every line. */
  keep: [number, number][] | null;
  emphasis: number[];
  appendix: AppendixPlacement;
}

export interface GeneratedAttrs {
  kind: GeneratedKind;
  hostId: string | null;
  appendix: Exclude<AppendixPlacement, "split">;
}

export interface VulnAttrs {
  findingId: string;
}

export interface ExploitAttrs {
  fileId: string;
  markedLines: number[];
  appendix: Exclude<AppendixPlacement, "split">;
}
