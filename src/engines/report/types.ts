import type { AccessGrant, CredAttempt, Credential, Username } from "../../types/credentials";
import type { CleanupItem } from "../../types/cleanup";
import type { ChecklistItem } from "../../types/checklist";
import type { Engagement } from "../../types/engagement";
import type { FailedAttempt, Finding, FindingFile } from "../../types/findings";
import type { Host } from "../../types/host";
import type { FlagKind, LogEntry } from "../../types/log";
import type { Hop } from "../../types/network";
import type { Note, RuledOut } from "../../types/notes";
import type { ReportMeta, ReportNode } from "../../types/report";
import type { Service } from "../../types/service";

export type { FlagKind, ReportMeta, ReportNode };

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
  /** Check ids the owner dismissed from this page's To do (a false positive): not counted, listed as dismissed. Owner
   *  meta: kept across rebuilds. */
  dismissedChecks?: string[];
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

/** A stored page as it was before Raven replaced it (`SectionMeta.originals`). Its `meta` holds the page it kept in
 *  `previousDoc` as `previousDocRef` (the index of the archive entry whose `doc` is that page, byte for byte) when the
 *  archive holds it already; `archivedMeta` gives it back whole. */
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

/**
 * `meta.originals` with `doc` appended, archived with the meta it was stored under (without `originals`). A doc the
 * archive already holds byte for byte is not added again, so swapping back and forth doesn't grow it; and a
 * `previousDoc` in that meta the archive holds (or that is `doc` itself) is stored as `previousDocRef`, its index, so
 * each swap adds at most the one page swapped out. Entries already there are never removed or rewritten.
 */
export function archivePage(meta: SectionMeta, doc: ReportNode, why: ArchivedPage["why"], at = Date.now()): ArchivedPage[] {
  const { originals = [], ...rest } = meta;
  const raw = JSON.stringify(doc);
  const raws = originals.map((o) => JSON.stringify(o.doc));
  if (raws.includes(raw)) return originals;
  const kept: Record<string, unknown> = { ...rest };
  if (rest.previousDoc) {
    const prev = JSON.stringify(rest.previousDoc);
    const ref = prev === raw ? originals.length : raws.indexOf(prev);
    if (ref !== -1) {
      delete kept.previousDoc;
      kept.previousDocRef = ref;
    }
  }
  return [...originals, { doc, layout: meta.layout ?? null, meta: kept, at, why }];
}

/** An archive entry's meta as it was stored: a `previousDocRef` resolved back to the `previousDoc` it names. */
export function archivedMeta(originals: ArchivedPage[], index: number): Record<string, unknown> {
  const { previousDocRef, ...meta } = originals[index]?.meta ?? {};
  if (typeof previousDocRef !== "number") return { ...meta };
  return { ...meta, previousDoc: originals[previousDocRef]?.doc ?? null };
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

/** A sub-section heading of a machine, in OffSec's sample order: Service Enumeration (standalone only), the entry
 *  phase (Initial Access, Lateral Movement or Domain Compromise), Privilege Escalation, Post-Exploitation; then Raven's
 *  own: Additional findings (findings that enabled no phase) and Also tested. */
export type Phase = "enum" | "foothold" | "privesc" | "lateral" | "domain" | "post" | "additional" | "tested";

/** Stored in `report_sections.meta` of an owner-written page (kind `page`). */
export interface PageMeta {
  title: string;
  placement: "appendix" | "body";
}
