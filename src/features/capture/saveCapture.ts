import type { CaptureDraft } from "../../engines/capture";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import type { LogContent, LogEntry, LogKind, NewAttachment } from "../../types/log";

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
  constructor(entry: LogEntry, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Saved, but services didn't update: ${detail}`);
    this.name = "PartialSaveError";
    this.entry = entry;
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
}

/**
 * Saves a capture: creates hosts for `addIps`, then the entry, then applies the nmap scan
 * (services, and the OS when the host has none). A failure after the entry exists throws
 * `PartialSaveError` carrying the saved entry.
 */
export async function saveCapture({ engagementId, draft, edits, addIps, image, hosts }: SaveCaptureArgs): Promise<LogEntry> {
  const hostIds = [...edits.hostIds];
  for (const ip of addIps) {
    // A retry after a partial failure finds the host already made.
    const existing = hosts.find((h) => h.ip === ip);
    const id = existing ? existing.id : (await api.hostCreate(engagementId, { name: ip, ip })).id;
    if (!hostIds.includes(id)) hostIds.push(id);
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

  const scan = draft.scan;
  if (scan && hostIds.includes(scan.hostId)) {
    try {
      await api.servicesUpsertScan(scan.hostId, scan.ports);
      const h = hosts.find((x) => x.id === scan.hostId);
      if (h && !h.os && scan.os) {
        await api.hostUpdate(h.id, { name: h.name, ip: h.ip, os: scan.os, access: h.access });
      }
    } catch (e) {
      throw new PartialSaveError(entry, e);
    }
  }
  return entry;
}
