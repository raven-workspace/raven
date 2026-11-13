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

/** The draft layout a section's page is built with. A target or report-level page saved with any other layout (or
 *  none) is rebuilt from scratch the first time it opens (2: OffSec's sample report structure; 3: one finding per
 *  heading; 4: numbered steps with evidence chips; 5: every placed block the page's own editable copy, §10.8; 6: every
 *  page one plain document, §11). An owner page (+ Page) is never rebuilt; one holding old nodes opens flattened
 *  (`flattenToPlain`), its original kept in `previousDoc`.
 *
 *  GUARD: bumping this rebuilds every stored page on its next open. The page written before is kept byte for byte in the
 *  section meta (`previousDoc`), the save queue is flushed first so no queued write of the old page lands after the
 *  rebuild, and the page offers the old one back ("Restore your previous page", flattened to the plain schema). A bump
 *  must keep that path working (reportSection.test.tsx: "a layout-5 page rebuilds as the plain draft and keeps the old
 *  page byte for byte"). */
export const DRAFT_LAYOUT = 6;

/** Stored in `report_sections.meta`. */
export interface SectionMeta {
  /** What the owner took off the page, so Add new evidence won't bring it back: entry ids, and `tested:<hostId>` for a
   *  machine's whole Also tested list (`testedKey`). */
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
  /** `previousDoc` holds the page as stored before it was converted to the plain schema as it opened (not rebuilt). */
  flattened?: boolean;
  /** Every stored page Raven replaced (a layout rebuild, the open-time conversion, a Restore swap), byte for byte, with
   *  the meta it had (without `originals`). Append-only: entries are never removed or rewritten. */
  originals?: ArchivedPage[];
}

/** A stored page as it was before Raven replaced it (`SectionMeta.originals`). */
export interface ArchivedPage {
  doc: ReportNode;
  layout: number | null;
  meta: Record<string, unknown>;
  at: number;
  why: "rebuild" | "flatten" | "restore";
}

/** Section meta keys that describe the page's own state (layout and rebuild bookkeeping), not the owner's choices: a
 *  rebuild sets them afresh and carries every other key forward. */
const PAGE_STATE_KEYS = ["layout", "previousDoc", "previousLayout", "previousAt", "restored", "flattened", "originals"];

/** `meta.originals` with `doc` appended, archived with the meta it was stored under (without `originals`). A doc the
 *  archive already holds byte for byte is not added again, so swapping back and forth doesn't grow it. */
export function archivePage(meta: SectionMeta, doc: ReportNode, why: ArchivedPage["why"], at = Date.now()): ArchivedPage[] {
  const { originals = [], ...rest } = meta;
  const raw = JSON.stringify(doc);
  if (originals.some((o) => JSON.stringify(o.doc) === raw)) return originals;
  return [...originals, { doc, layout: meta.layout ?? null, meta: rest as Record<string, unknown>, at, why }];
}

/** The owner's own keys of a section meta (coverage, removed entries, a page's title…): what a rebuild carries forward. */
export function ownerMeta(meta: SectionMeta): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !PAGE_STATE_KEYS.includes(k)));
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
  /** The page's own copy of the entry's text (§10.8), edited on the page; null for a screenshot or a note. Absent on a
   *  block whose entry is private or gone (never copied). `keep` and `emphasis` index the copy's lines. */
  copy?: EvidenceCopy | null;
  /** The copy holds only the first `COPY_LIMIT` characters of a field: Refresh restores from the log. */
  truncated?: boolean;
}

/** A command block's copy (an HTTP entry: the request as `command`, the response as `output`). */
export interface CommandCopy {
  command: string | null;
  output: string;
}
/** A flag's copy: its value and proof text. */
export interface FlagCopy {
  value: string;
  proof: string | null;
}
export type EvidenceCopy = CommandCopy | FlagCopy;

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
  /** The page's own copy of the finding file's content (§10.8); absent when the file is gone. */
  copy?: { content: string };
  truncated?: boolean;
}

/** A finding as the page's own editable copy (§10.8): labelled paragraphs (Vulnerability Explanation, Fix, Severity,
 *  Affected), lists and code blocks. `edited` turns true on the owner's first change inside it. */
export interface FindingCopyAttrs {
  findingId: string;
  edited: boolean;
}

/** The generated kinds the page holds as its own copy (a `table-block`); the rest stay `generated` atoms. */
export type CopiedKind = "result" | "ports" | "tested" | "attack-path" | "findings" | "scope-table" | "cleanup" | "references";
export const COPIED_KINDS: readonly CopiedKind[] = ["result", "ports", "tested", "attack-path", "findings", "scope-table", "cleanup", "references"];

/** A generated table (or the Result line) as the page's own editable copy: a `table` or `paragraph`s. */
export interface TableBlockAttrs {
  kind: CopiedKind;
  hostId: string | null;
  appendix: Exclude<AppendixPlacement, "split">;
  edited: boolean;
}
