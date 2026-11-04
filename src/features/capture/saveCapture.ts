import { buildDraft, type CaptureDraft, type DraftInput } from "../../engines/capture";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import type { LogContent, LogEntry, LogKind, NewAttachment } from "../../types/log";

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

/** The entry was saved, but a follow-up step (services, OS) failed. */
export class PartialSaveError extends Error {
  readonly entry: LogEntry;
  /** What made the follow-up step fail. */
  readonly reason: unknown;
  constructor(entry: LogEntry, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Saved, but services didn't update: ${detail}`);
    this.name = "PartialSaveError";
    this.entry = entry;
    this.reason = cause;
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
}

/**
 * Saves a capture: creates hosts for `addIps`, then the entry, then applies the nmap scan
 * (services, and the OS when the host has none). A failure after the entry exists throws
 * `PartialSaveError` carrying the saved entry.
 */
export async function saveCapture(args: SaveCaptureArgs): Promise<LogEntry> {
  const { engagementId, draft, edits, addIps, image, draftInput, onHostCreated } = args;
  const hostIds = [...edits.hostIds];
  const hosts = [...args.hosts];
  const added: Host[] = [];
  for (const ip of addIps) {
    // A retry after a failure finds the host already made.
    let h = hosts.find((x) => x.ip === ip);
    if (!h) {
      h = await api.hostCreate(engagementId, { name: ip, ip });
      hosts.push(h);
      onHostCreated?.(h);
    }
    added.push(h);
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
      throw new PartialSaveError(entry, e);
    }
  }
  return entry;
}
