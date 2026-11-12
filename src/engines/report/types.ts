import type { AccessGrant, CredAttempt, Credential, Username } from "../../types/credentials";
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
  /** Results of trying credentials on hosts (nxc, hydra): a valid or admin one ties the credential to that host. */
  credAttempts: CredAttempt[];
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
 *  scratch the first time it opens (2: OffSec's sample report structure; 3: one finding per heading, Additional
 *  findings, flags with their companions; 4: numbered steps with evidence chips, short draft, ports/result tables).
 *
 *  GUARD: bumping this rebuilds every stored page of every report on its next open. The page written before is kept in
 *  the section meta (`previousDoc`) and the page offers it back ("Restore your previous page"); a bump must keep that
 *  path working (reportSection.test.tsx: "a page rebuilt for a new layout offers the previous one back"). */
export const DRAFT_LAYOUT = 4;

/** Stored in `report_sections.meta`. */
export interface SectionMeta {
  removedEntryIds?: string[];
  coverage?: Record<string, CoverageOverride>;
  /** The draft layout the page was built with (`DRAFT_LAYOUT`). */
  layout?: number;
  /** The page as it was before a rebuild for a new layout, kept so the owner can restore it; after a restore, the
   *  rebuilt page (swapping again brings it back). */
  previousDoc?: ReportNode | null;
  /** The layout the owner's earlier page was written under (null: none recorded). */
  previousLayout?: number | null;
  /** When the page was rebuilt. */
  previousAt?: number | null;
  /** The owner restored the earlier page: `previousDoc` holds the rebuilt one. */
  restored?: boolean;
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
 *  phase (Initial Access, Lateral Movement or Domain Compromise), Privilege Escalation, Post-Exploitation; then Raven's
 *  own: Additional findings (findings that enabled no phase) and Also tested. */
export type Phase = "enum" | "foothold" | "privesc" | "lateral" | "domain" | "post" | "additional" | "tested";

/**
 * Blocks rendered from live data. `facts` is a machine's numbered heading ("Target #1 – 10.0.0.5"); `result` the
 * "Result:" line under it; `ports` its port table (Port, Service, Version, Notes); `tested` the slim Also tested lines;
 * `attack-path` the AD set's opening table (`hostId` null); `findings` the High-Level Summary's findings table;
 * `scope-table` the 1.4 Scope table; `msf`, `cleanup` the Methodologies facts. `port-scan`, `attack-chain` and `scope`
 * are older layouts' blocks: still rendered so old pages open, never drafted.
 */
export type GeneratedKind =
  | "facts"
  | "result"
  | "ports"
  | "tested"
  | "attack-path"
  | "findings"
  | "scope-table"
  | "port-scan"
  | "attack-chain"
  | "scope"
  | "msf"
  | "cleanup"
  | "references";

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
  /** A finding's own heading: a second finding that enabled the phase ("Initial Access – <title>", numbered), or one
   *  under Additional findings ("<title>"). Null (or absent) = the phase's heading. */
  findingId?: string | null;
}

export interface EvidenceAttrs {
  entryId: string;
  /** Index into a command entry's `content.blocks`; null = the whole entry. */
  block: number | null;
  /** Inclusive line ranges kept inline; null = every line. */
  keep: [number, number][] | null;
  emphasis: number[];
  appendix: AppendixPlacement;
  /** A screenshot's caption as written on the page, over the log's; null (or absent) = the log's caption. The log is
   *  never changed. */
  caption?: string | null;
  /** A screenshot's width in CSS px at the page's 760px measure, set by resizing it; null (or absent) = full width. */
  width?: number | null;
}

export interface GeneratedAttrs {
  kind: GeneratedKind;
  hostId: string | null;
  appendix: Exclude<AppendixPlacement, "split">;
}

/** One numbered step of a `steps` list (Steps to reproduce): the owner's sentence, then its evidence. */
export interface StepAttrs {
  /** The entry the step was drafted from; null for a step the owner added. */
  entryId: string | null;
}

/** A machine's port table; `notes` is the owner's Notes column. */
export interface PortsAttrs extends GeneratedAttrs {
  /** Service id → owner text. */
  notes: Record<string, string>;
}

/** Stored in `report_sections.meta` of an owner-written page (kind `page`). */
export interface PageMeta {
  title: string;
  placement: "appendix" | "body";
}

export interface VulnAttrs {
  findingId: string;
}

export interface ExploitAttrs {
  fileId: string;
  markedLines: number[];
  appendix: Exclude<AppendixPlacement, "split">;
}
