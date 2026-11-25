import { buildDraft, type CaptureDraft, type DraftInput } from "../../engines/capture";
import { api } from "../../lib/api";
import { CHECKLIST_FAILED, ChecklistSyncError, syncChecklist } from "../checklist/sync";
import { lockMetasploit, MsfLockError } from "../checklist/ticks";
import type { Host } from "../../types/host";
import type { ExtractionSummary, Filed, LogContent, LogEntry, LogKind, NewAttachment, OutputTick } from "../../types/log";
import type { ResolvedInterpretation } from "../../engines/interpret/resolve";
import { identityOf, interpretEntry, outputTicks, proveEntry, summarize, type IdentityProved, type Ticked } from "./extraction";
import { newHostScans } from "./resolve";
import { RavenError } from "../../types/errors";


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
  /** Credentials the pasted note is made of (`user:pass` lines), added on save; each linked to its host when one is. */
  credentials?: CapturedCredential[];
}

/** A credential read from a capture paste, placed on the host the capture is linked to (null: none). */
export interface CapturedCredential {
  username: string;
  domain: string | null;
  secret: string;
  type: "password" | "hash";
  /** Windows local notation (`.\user`): local to its host. */
  local?: boolean;
  hostId: string | null;
}

/**
 * The pasted credentials as interpretation results, so they are filed, deduped, summarised and undone like any other.
 * Scoped as the Credentials form does (domain), so they dedupe against what was added there; `.\user` is local to
 * its host.
 */
export function pastedCredentials(list: CapturedCredential[]): ResolvedInterpretation["credentials"] {
  return list.map((c) => ({
    username: c.username,
    domain: c.domain,
    type: c.type,
    secret: c.type === "hash" ? c.secret.toLowerCase() : c.secret,
    hashType: c.type === "hash" ? "NTLM" : null,
    scope: c.local ? ("local" as const) : ("domain" as const),
    source: "paste",
    hostId: c.hostId,
  }));
}

export const IDENTITY_FAILED = "Saved the entry, but the host's identity didn't update. Paste the output again to retry.";
export const EXTRACTION_FAILED = "Saved the entry, but Raven couldn't file what it found. Paste the output again to retry.";

/** The entry was saved, but a follow-up step (reading the identity, filing, checklist, Metasploit lock) failed. */
export class PartialSaveError extends Error {
  readonly entry: LogEntry;
  /** What made the (first) follow-up step fail. */
  readonly reason: unknown;
  /** What made each failed follow-up step fail, in order; `reason` is the first. */
  readonly reasons: unknown[];
  /** The summary of the extraction this save stored despite the failure (it can be undone); null when none was. */
  readonly summary: ExtractionSummary | null;
  constructor(entry: LogEntry, cause: unknown, message?: string, reasons?: unknown[], summary: ExtractionSummary | null = null) {
    const detail = RavenError.from(cause).message;
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

/** What the store filed for the entry, and how it is summarised. */
interface Filing {
  filed: Filed;
  summary: ExtractionSummary;
  ticks: OutputTick[];
}

/**
 * Saves a capture: creates the hosts a scan of new IPs proves, then the entry. Then the store files what the output
 * proved (the nmap scans, the identity, and what the interpreters found: `proveEntry`) with its extraction, all or
 * nothing; then the checklist ticks, board and Metasploit lock run, and last the extraction gets its summary and
 * output ticks, stamped after the board sync, which Undo compares against.
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
  let identity: IdentityProved | null = null;
  try {
    identity = await identityOf(entry, hosts);
  } catch (e) {
    failures.push({ reason: e, message: IDENTITY_FAILED, also: "The host's identity didn't update either: paste the output again to retry." });
  }

  let filing: Filing | null = null;
  try {
    const r = interpretEntry(entry, hosts, draftInput?.domain ?? "", draftInput?.scope ?? []);
    if (edits.credentials?.length) {
      r.parsers.push("paste");
      r.credentials.push(...pastedCredentials(edits.credentials));
    }
    const linked = scans.filter((s) => hostIds.includes(s.hostId));
    const proved = await proveEntry(engagementId, entry, r, { hosts, createdHostIds, scans: linked, identity });
    if (proved) {
      const filed = await api.extractionFile(engagementId, entry.id, proved.proofs);
      // Filed and undoable: from here a failure costs only the summary's tick lines.
      const names = new Map(hosts.map((h) => [h.id, h.name || h.ip || ""]));
      for (const h of proved.proofs.newHosts) if (filed.hostIds[h.key]) names.set(filed.hostIds[h.key]!, h.ip);
      let ticked: Ticked = { ticks: [], lines: [], dcNames: new Set() };
      try {
        ticked = await outputTicks(engagementId, r, (p) => proved.hostOf(p, filed));
      } catch (e) {
        failures.push({ reason: e, message: EXTRACTION_FAILED, also: extractionAlso });
      }
      const hostName = (id: string | null | undefined) => names.get(id ?? "") ?? "";
      const summary = summarize({ r, plan: proved.plan, filed, identityHostId: identity?.hostId ?? null, hostName, ticked });
      filing = { filed, summary, ticks: ticked.ticks };
    }
  } catch (e) {
    failures.push({ reason: e, message: EXTRACTION_FAILED, also: extractionAlso });
  }

  // The checklist sync, then the exam-sim Metasploit lock, which runs even when the sync failed. The caller's
  // `logEntry saved` covers what they write.
  const followUp = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (e) {
      const checklistAlso = "The checklist didn't update either: use Tick from log on the Engagement checklist.";
      if (e instanceof ChecklistSyncError || e instanceof MsfLockError) {
        failures.push({ reason: e.reason, message: e.message, also: e.message !== CHECKLIST_FAILED ? e.message : checklistAlso });
      } else {
        failures.push({ reason: e, message: new PartialSaveError(entry, e).message, also: checklistAlso });
      }
    }
  };
  await followUp(() => syncChecklist({ engagementId, change: { entity: "logEntry", id: entry.id, change: "saved", entry, outputTicks: filing?.ticks ?? [] } }));
  await followUp(() => lockMetasploit(engagementId, entry));

  // R7/R8: the summary and output ticks, after the board sync.
  if (filing) {
    try {
      await api.extractionFinish(entry.id, filing.summary, filing.ticks);
    } catch (e) {
      failures.push({ reason: e, message: EXTRACTION_FAILED, also: extractionAlso });
    }
  }

  const summary = filing?.summary ?? null;
  if (failures.length) {
    const [first, ...rest] = failures;
    const message = rest.reduce((acc, f) => `${acc}${acc.endsWith(".") ? "" : "."} ${f.also}`, first!.message);
    throw new PartialSaveError(entry, first!.reason, message, failures.map((f) => f.reason), summary);
  }
  return { entry, summary };
}
