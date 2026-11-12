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

/** The draft layout a section's page is built with. A page saved with an older or missing layout is rebuilt from
 *  scratch the first time it opens (2: OffSec's sample report structure). */
export const DRAFT_LAYOUT = 2;

/** Stored in `report_sections.meta`. */
export interface SectionMeta {
  removedEntryIds?: string[];
  coverage?: Record<string, CoverageOverride>;
  /** The draft layout the page was built with (`DRAFT_LAYOUT`). */
  layout?: number;
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

/** A sub-section heading of a machine, in OffSec's sample order: Service Enumeration (standalone only), the entry
 *  phase (Initial Access, Lateral Movement or Domain Compromise), Privilege Escalation, Also tested, Post-Exploitation. */
export type Phase = "enum" | "foothold" | "privesc" | "lateral" | "domain" | "tested" | "post";

/**
 * Blocks rendered from live data. `facts` is a machine's numbered heading ("Target #1 – 10.0.0.5"); `port-scan` the
 * Port Scan Results table (one host, or the whole AD set when `hostId` is null); `tested` the slim Also tested lines;
 * `scope`, `msf` and `cleanup` the Methodologies facts.
 */
export type GeneratedKind = "facts" | "port-scan" | "tested" | "attack-chain" | "scope" | "msf" | "cleanup" | "references";

/** Where a block's content sits: in the flow, moved to an appendix, or trimmed inline with the full copy there. */
export type AppendixPlacement = "inline" | "moved" | "split";

/** A prose slot; an empty one shows its hint and never exports. `label` is a bold lead-in printed before the text
 *  ("Steps to reproduce the attack:"). */
export interface SlotAttrs {
  hint: string;
  label?: string;
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
