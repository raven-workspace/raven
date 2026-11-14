import type { Credential, CredAttempt } from "./credentials";
import type { HostIdentity } from "./hostFacts";
import type { Service } from "./service";

export type LogKind = "command" | "screenshot" | "http" | "note" | "flag";
export type FlagKind = "local" | "proof";

/** Mirrors the Rust `CommandBlock`. */
/** `root`: pasted at a bare `#` prompt (a root shell whose prompt names no user). */
export type CommandBlock = { command: string; output: string; shell?: string; root?: true };

/** Mirrors the Rust `LogContent`; `kind` is the tag and equals the entry's `kind`. */
export type LogContent =
  | { kind: "command"; blocks: CommandBlock[] }
  | { kind: "screenshot"; attachmentId: string; caption: string; fileName: string }
  | { kind: "http"; request: string; response?: string | null }
  | { kind: "note"; text: string }
  | { kind: "flag"; flagKind: FlagKind; value: string; attachmentId?: string | null; proof?: string | null };

/** Mirrors the Rust `LogEntry`. Timestamps are Unix milliseconds. */
export interface LogEntry {
  id: string;
  engagementId: string;
  kind: LogKind;
  title: string;
  titleEdited: boolean;
  ranOn: string | null;
  hostIds: string[];
  observations: string | null;
  returnedNothing: boolean;
  private: boolean;
  content: LogContent;
  /** Payloads drawer: the payload this command came from and the LHOST/LPORT it was built with. */
  payloadId?: string | null;
  payloadValues?: Record<string, string> | null;
  at: number;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `NewAttachment`: an image uploaded with a screenshot or flag entry. */
export interface NewAttachment {
  mime: string;
  dataBase64: string;
}

/** Mirrors the Rust `Attachment`. */
export interface Attachment {
  id: string;
  mime: string;
  dataBase64: string;
}

/** Mirrors the Rust `LogEntryInput` (create and full update; `attachment` is ignored on update). */
export interface LogEntryInput {
  title: string;
  titleEdited?: boolean;
  ranOn: string | null;
  hostIds: string[];
  observations: string | null;
  returnedNothing: boolean;
  private: boolean;
  content: LogContent;
  /** Omitted (or null) on update keeps the stored values; "" clears the payload id and its values. */
  payloadId?: string | null;
  payloadValues?: Record<string, string> | null;
  at?: number | null;
  attachment?: NewAttachment | null;
}

/** Mirrors the Rust `Progress`: per-engagement host and flag counts. */
export interface Progress {
  hostsTotal: number;
  hostsRooted: number;
  flagsFound: number;
  flagsTotal: number;
}

/** Mirrors the Rust `ExtractionSummary`: display lines, already worded. `wins` are accent lines, `counts` muted,
 *  `ticks` like "Ticked 'Dump hashes' on DC01". */
export interface ExtractionSummary {
  wins: string[];
  counts: string[];
  ticks: string[];
}

/** A checklist tick an entry's output proved (`parser` names the interpreter). */
export interface OutputTick {
  ownerId: string;
  goalId: string;
  parser: string;
}

/** Mirrors the Rust `ExtractionRecord`: what one Save filed (created ids) and "before" snapshots of the rows it
 *  changed, so Undo can reverse exactly that save. Every list may be empty. */
export interface ExtractionRecord {
  createdHostIds: string[];
  createdServiceIds: string[];
  /** Rows changed by a scan, as they were. */
  servicesBefore: Service[];
  hostOsBefore: { hostId: string; os: string | null }[];
  identityBefore: { hostId: string; identity: HostIdentity | null }[];
  createdCredentialIds: string[];
  /** Rows upgraded (cracked) by this save, as they were. */
  credentialsBefore: Credential[];
  createdUsernameIds: string[];
  createdAttemptIds: string[];
  /** Rows whose result this save changed, as they were. */
  attemptsBefore: CredAttempt[];
  createdTriedPairIds: string[];
  createdVectorIds: string[];
  outputTicks: OutputTick[];
  /** Stored credentials this save proved again (re-dumped, re-cracked): another entry's Undo keeps them. */
  reprovedCredentialIds: string[];
  /** Stored usernames this save listed again: another entry's Undo keeps them. */
  reprovedUsernameIds: string[];
}

/** Mirrors the Rust `Extraction`: one per log entry. Timestamps are Unix milliseconds. */
export interface Extraction {
  logEntryId: string;
  engagementId: string;
  summary: ExtractionSummary;
  record: ExtractionRecord;
  createdAt: number;
  undoneAt: number | null;
}
