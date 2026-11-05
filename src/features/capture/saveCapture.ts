import { buildDraft, type CaptureDraft, type DraftInput } from "../../engines/capture";
import { api } from "../../lib/api";
import { afterEntrySaved, CHECKLIST_FAILED, FollowUpError } from "../checklist/ticks";
import { applyIntake } from "../credentials/applyIntake";
import type { Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { LogContent, LogEntry, LogKind, NewAttachment } from "../../types/log";
import { intakePlanFor, isAccepted, provisionalHostId, realIntakeKey } from "./resolve";

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
}

export const INTAKE_FAILED = "Saved the entry, but the credentials didn't update. Paste the output again to retry.";

/** The entry was saved, but a follow-up step (services, OS, credentials, checklist, Metasploit lock) failed. */
export class PartialSaveError extends Error {
  readonly entry: LogEntry;
  /** What made the (first) follow-up step fail. */
  readonly reason: unknown;
  /** What made each failed follow-up step fail, in order; `reason` is the first. */
  readonly reasons: unknown[];
  constructor(entry: LogEntry, cause: unknown, message?: string, reasons?: unknown[]) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(message ?? `Saved, but services didn't update: ${detail}`);
    this.name = "PartialSaveError";
    this.entry = entry;
    this.reason = cause;
    this.reasons = reasons ?? [cause];
  }
}

export interface SaveCaptureArgs {
  engagementId: string;
  draft: CaptureDraft;
  edits: CaptureEdits;
  /** Unknown in-scope IPs the user chose to add as hosts. */
  addIps: string[];
  image: NewAttachment | null;
  hosts: Host[];
  /** What `draft` was built from. With it, a command's scan can land on a host created here. */
  draftInput?: DraftInput;
  /** Called for each host created, so a retry after a failure reuses it. */
  onHostCreated?: (host: Host) => void;
  /**
   * For a command entry: the engagement's credentials and usernames the nxc intake plans against, and the
   * operator's accept toggles. Absent skips the intake.
   */
  intake?: {
    credentials: Credential[];
    usernames: Username[];
    toggles: Record<string, boolean>;
    /**
     * Keys of the pending credentials the preview offered. Only these can be created (T8-R3). A preview planned
     * with provisional hosts for `addIps` (`new:<ip>`) uses those ids; they are mapped to the created hosts here.
     */
    previewKeys: string[];
  };
}

/**
 * Saves a capture: creates hosts for `addIps`, then the entry, then applies the nmap scan
 * (services, and the OS when the host has none), then the nxc credential intake, then the checklist ticks, board and
 * Metasploit lock.
 * A failure after the entry exists throws `PartialSaveError` carrying the saved entry.
 */
export async function saveCapture(args: SaveCaptureArgs): Promise<LogEntry> {
  const { engagementId, draft, edits, addIps, image, draftInput, onHostCreated } = args;
  const hostIds = [...edits.hostIds];
  const hosts = [...args.hosts];
  const added: Host[] = [];
  // Provisional preview id (`new:<ip>`) → the host it became.
  const createdIds = new Map<string, string>();
  for (const ip of addIps) {
    // A retry after a failure finds the host already made.
    let h = hosts.find((x) => x.ip === ip);
    if (!h) {
      h = await api.hostCreate(engagementId, { name: ip, ip });
      hosts.push(h);
      onHostCreated?.(h);
    }
    added.push(h);
    createdIds.set(provisionalHostId(ip), h.id);
    if (!hostIds.includes(h.id)) hostIds.push(h.id);
  }

  // First scan of a new box: re-run the draft now that its host exists.
  let scan = draft.scan;
  if (!scan && edits.kind === "command" && draftInput && added.length) {
    const known = new Set(draftInput.hosts.map((h) => h.id));
    const refs = added.filter((h) => !known.has(h.id)).map((h) => ({ id: h.id, name: h.name, ip: h.ip, column: h.boardColumn }));
    scan = buildDraft({ ...draftInput, kind: "command", hosts: [...draftInput.hosts, ...refs] }).scan;
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
    attachment: image,
  });

  // Each follow-up step runs even when an earlier one failed; the first failure is reported first.
  const failures: { reason: unknown; message: string; also: string }[] = [];
  if (scan && hostIds.includes(scan.hostId)) {
    const { hostId } = scan;
    try {
      // Closed and filtered ports are not services.
      const open = scan.ports.filter((p) => OPEN_STATES.has(p.state.toLowerCase()));
      await api.servicesUpsertScan(hostId, open);
      const h = hosts.find((x) => x.id === hostId);
      if (h && !h.os && scan.os) {
        await api.hostUpdate(h.id, { name: h.name, ip: h.ip, os: scan.os, access: h.access });
      }
    } catch (e) {
      const message = new PartialSaveError(entry, e).message;
      failures.push({ reason: e, message, also: message });
    }
  }
  if (args.intake) {
    // Planned against the hosts as saved, so an IP added here counts as known.
    const plan = intakePlanFor(edits, { engagementId, hosts, ...args.intake });
    if (plan) {
      // Only what the preview offered is ever created (T8-R3). The preview planned IPs added here as provisional
      // hosts (F-R2): their keys and toggles are mapped to the created hosts.
      const offered = new Set(args.intake.previewKeys.map((k) => realIntakeKey(k, createdIds)));
      const toggles = Object.fromEntries(Object.entries(args.intake.toggles).map(([k, on]) => [realIntakeKey(k, createdIds), on]));
      const acceptKeys = plan.newCredentials.filter((p) => offered.has(p.key) && isAccepted(p, toggles)).map((p) => p.key);
      try {
        await applyIntake(engagementId, plan, { logEntryId: entry.id, at: entry.at, acceptKeys });
      } catch (e) {
        failures.push({ reason: e, message: INTAKE_FAILED, also: "The credentials didn't update either: paste the output again to retry." });
      }
    }
  }
  try {
    await afterEntrySaved(engagementId, entry, entry.id);
  } catch (e) {
    const checklistAlso = "The checklist didn't update either: use Tick from log on the Engagement checklist.";
    if (e instanceof FollowUpError) {
      failures.push({ reason: e.reason, message: e.message, also: e.message !== CHECKLIST_FAILED ? e.message : checklistAlso });
    } else {
      failures.push({ reason: e, message: new PartialSaveError(entry, e).message, also: checklistAlso });
    }
  }
  if (failures.length) {
    const [first, ...rest] = failures;
    const message = rest.reduce((acc, f) => `${acc}${acc.endsWith(".") ? "" : "."} ${f.also}`, first!.message);
    throw new PartialSaveError(entry, first!.reason, message, failures.map((f) => f.reason));
  }
  return entry;
}
