import { identityBlocksOf, isIdentityBlockFor, mergeIdentity, usableIdentity, vectorsFromIdentity, type IdentityFields } from "../../engines/facts";
import { buildDraft, type CaptureDraft, type DraftInput } from "../../engines/capture";
import { api } from "../../lib/api";
import { afterEntrySaved, CHECKLIST_FAILED, FollowUpError } from "../checklist/ticks";
import type { Host } from "../../types/host";
import type { HostIdentity } from "../../types/hostFacts";
import type { ExtractionSummary, LogContent, LogEntry, LogKind, NewAttachment } from "../../types/log";
import type { Service } from "../../types/service";
import { applyInterpretation, ExtractionError, interpretEntry, type Applied, type FiledBySave } from "./applyInterpretation";
import { newHostScans } from "./resolve";

const OPEN_STATES = new Set(["open", "open|filtered"]);

/** The user-edited final fields of a capture; the draft supplies `scan` and `unknownScopeIps`. */
export interface CaptureEdits {
  kind: LogKind;
  title: string;
  titleEdited: boolean;
  hostIds: string[];
  ranOn: string;
  observations: string;
  returnedNothing: boolean;
  private: boolean;
  content: LogContent;
  payloadId?: string;
  payloadValues?: Record<string, string>;
}

export const IDENTITY_FAILED = "Saved the entry, but the host's identity didn't update. Paste the output again to retry.";
export const EXTRACTION_FAILED = "Saved the entry, but Raven couldn't file what it found. Paste the output again to retry.";

/**
 * Records who the user is on the host from its whoami/id output, merged by kind into what is stored (`whoami /priv`
 * changes only the privileges, and so on). Returns the host, the identity before (for Undo), whether it changed, and
 * the privesc vectors the output points to; null when the entry holds no identity output for one host.
 */
async function recordIdentity(entry: LogEntry, hosts: Host[]): Promise<FiledBySave["identity"]> {
  const host = hosts.find((h) => h.id === entry.hostIds[0]);
  if (!host) return null;
  const parsedBlocks = identityBlocksOf(entry).flatMap((block) => {
    const parsed = isIdentityBlockFor(entry, host, block) ? usableIdentity(block) : null;
    return parsed ? [{ parsed, command: block.command }] : [];
  });
  if (parsedBlocks.length === 0) return null;
  const before: HostIdentity | null = (await api.hostIdentityGet(host.id)) ?? null;
  let stored: IdentityFields | null = before;
  const vectors: string[] = [];
  for (const { parsed, command } of parsedBlocks) {
    stored = mergeIdentity(stored, parsed, command);
    for (const title of vectorsFromIdentity(parsed)) if (!vectors.includes(title)) vectors.push(title);
  }
  const fields = (i: IdentityFields | null) =>
    i && JSON.stringify([i.username ?? "unknown", i.privileges, i.groups]);
  const changed = fields(before) !== fields(stored);
  if (changed && stored) {
    await api.hostIdentitySet({ hostId: host.id, username: stored.username ?? "unknown", privileges: stored.privileges, groups: stored.groups, entryId: entry.id });
  }
  return { hostId: host.id, before, changed, vectors };
}

/** The entry was saved, but a follow-up step (services, OS, identity, extraction, checklist, Metasploit lock) failed. */
export class PartialSaveError extends Error {
  readonly entry: LogEntry;
  /** What made the (first) follow-up step fail. */
  readonly reason: unknown;
  /** What made each failed follow-up step fail, in order; `reason` is the first. */
  readonly reasons: unknown[];
  /** The summary of the extraction this save stored despite the failure (it can be undone); null when none was. */
  readonly summary: ExtractionSummary | null;
  constructor(entry: LogEntry, cause: unknown, message?: string, reasons?: unknown[], summary: ExtractionSummary | null = null) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(message ?? `Saved, but services didn't update: ${detail}`);
    this.name = "PartialSaveError";
    this.entry = entry;
    this.reason = cause;
    this.reasons = reasons ?? [cause];
    this.summary = summary;
  }
}

export interface SaveCaptureArgs {
  engagementId: string;
  draft: CaptureDraft;
  edits: CaptureEdits;
  image: NewAttachment | null;
  hosts: Host[];
  /** What `draft` was built from. With it, a scan of an IP that isn't a host yet makes that host. */
  draftInput?: DraftInput;
  /** Called for each host created before the entry, so a retry after a failure reuses it. */
  onHostCreated?: (host: Host) => void;
}

export interface SaveCaptureResult {
  entry: LogEntry;
  /** What the save filed from the output; null when nothing in it was parsed (no extraction is stored). */
  summary: ExtractionSummary | null;
}

type Scan = NonNullable<CaptureDraft["scan"]>;

/** Upserts a scan's open ports as services and fills the OS of a host that has none; returns what changed. */
async function applyScan(scan: Scan, hosts: Host[]): Promise<FiledBySave["scans"][number]> {
  const { hostId } = scan;
  // Closed and filtered ports are not services.
  const open = scan.ports.filter((p) => OPEN_STATES.has(p.state.toLowerCase()));
  const was: Service[] = (await api.servicesList(hostId)) ?? [];
  const now: Service[] = (await api.servicesUpsertScan(hostId, open)) ?? [];
  const wasById = new Map(was.map((s) => [s.id, s]));
  const filed: FiledBySave["scans"][number] = {
    hostId,
    createdServiceIds: now.filter((s) => !wasById.has(s.id)).map((s) => s.id),
    servicesBefore: now.flatMap((s) => {
      const old = wasById.get(s.id);
      return old && JSON.stringify(old) !== JSON.stringify(s) ? [old] : [];
    }),
    hostOsBefore: null,
  };
  const h = hosts.find((x) => x.id === hostId);
  if (h && !h.os && scan.os) {
    await api.hostUpdate(h.id, { name: h.name, ip: h.ip, os: scan.os, access: h.access });
    filed.hostOsBefore = { hostId: h.id, os: null };
  }
  return filed;
}

/**
 * Saves a capture: creates the hosts a scan of new IPs proves, then the entry, then applies the nmap scans (services,
 * and the OS when the host has none) and the identity, then files what the output proved (`applyInterpretation`),
 * then the checklist ticks, board and Metasploit lock, and last stores the extraction (its time must follow the
 * board sync, which Undo compares against).
 * A failure after the entry exists throws `PartialSaveError` carrying the saved entry.
 */
export async function saveCapture(args: SaveCaptureArgs): Promise<SaveCaptureResult> {
  const { engagementId, draft, edits, image, draftInput, onHostCreated } = args;
  const hostIds = [...edits.hostIds];
  const hosts = [...args.hosts];
  const createdHostIds: string[] = [];

  // First scan of a new box: an open port proves the host; the draft re-runs for it now that it exists.
  const scans: Scan[] = draft.scan ? [draft.scan] : [];
  const newIps = edits.kind === "command" && draftInput ? newHostScans(draft, draftInput).map((n) => n.ip) : [];
  for (const ip of newIps) {
    // A retry after a failure finds the host already made.
    let h = hosts.find((x) => x.ip === ip);
    if (!h) {
      h = await api.hostCreate(engagementId, { name: ip, ip });
      hosts.push(h);
      createdHostIds.push(h.id);
      onHostCreated?.(h);
    }
    if (!hostIds.includes(h.id)) hostIds.push(h.id);
    const ref = { id: h.id, name: h.name, ip: h.ip, column: h.boardColumn };
    const others = draftInput!.hosts.filter((x) => x.id !== h.id);
    const scan = buildDraft({ ...draftInput!, kind: "command", hosts: [...others, ref] }).scan;
    if (scan?.hostId === h.id) scans.push(scan);
  }

  const entry = await api.logCreate(engagementId, {
    title: edits.title.trim(),
    titleEdited: edits.titleEdited,
    ranOn: edits.ranOn.trim() === "" ? null : edits.ranOn.trim(),
    hostIds,
    observations: edits.observations.trim() === "" ? null : edits.observations.trim(),
    returnedNothing: edits.returnedNothing,
    private: edits.private,
    content: edits.content,
    ...(edits.payloadId ? { payloadId: edits.payloadId, payloadValues: edits.payloadValues ?? null } : {}),
    attachment: image,
  });

  // Each follow-up step runs even when an earlier one failed; the first failure is reported first.
  const failures: { reason: unknown; message: string; also: string }[] = [];
  const extractionAlso = "Raven couldn't file what it found either: paste the output again to retry.";
  const filedScans: FiledBySave["scans"] = [];
  for (const scan of scans) {
    if (!hostIds.includes(scan.hostId)) continue;
    try {
      filedScans.push(await applyScan(scan, hosts));
    } catch (e) {
      const message = new PartialSaveError(entry, e).message;
      failures.push({ reason: e, message, also: message });
    }
  }
  let identity: FiledBySave["identity"] = null;
  try {
    identity = await recordIdentity(entry, hosts);
  } catch (e) {
    failures.push({ reason: e, message: IDENTITY_FAILED, also: "The host's identity didn't update either: paste the output again to retry." });
  }

  let applied: Applied | null = null;
  try {
    const resolved = interpretEntry(entry, hosts, draftInput?.domain ?? "", draftInput?.scope ?? []);
    applied = await applyInterpretation(engagementId, entry, resolved, { hosts, createdHostIds, scans: filedScans, identity });
  } catch (e) {
    if (e instanceof ExtractionError) applied = e.applied;
    failures.push({ reason: e instanceof ExtractionError ? e.reason : e, message: EXTRACTION_FAILED, also: extractionAlso });
  }

  try {
    await afterEntrySaved(engagementId, entry, entry.id, applied?.outputTicks ?? []);
  } catch (e) {
    const checklistAlso = "The checklist didn't update either: use Tick from log on the Engagement checklist.";
    if (e instanceof FollowUpError) {
      failures.push({ reason: e.reason, message: e.message, also: e.message !== CHECKLIST_FAILED ? e.message : checklistAlso });
    } else {
      failures.push({ reason: e, message: new PartialSaveError(entry, e).message, also: checklistAlso });
    }
  }

  // R7/R8: stored once, on create, after the board sync.
  const summary = applied?.summary ?? null;
  let stored = false;
  if (applied && summary) {
    try {
      await api.extractionSave(entry.id, engagementId, summary, applied.record);
      stored = true;
    } catch (e) {
      failures.push({ reason: e, message: EXTRACTION_FAILED, also: extractionAlso });
    }
  }

  if (failures.length) {
    const [first, ...rest] = failures;
    const message = rest.reduce((acc, f) => `${acc}${acc.endsWith(".") ? "" : "."} ${f.also}`, first!.message);
    throw new PartialSaveError(entry, first!.reason, message, failures.map((f) => f.reason), stored ? summary : null);
  }
  return { entry, summary };
}
