import type { Credential, CredAttempt, CredAttemptInput, CredentialInput, TriedPair, TriedPairInput, UsernameInput } from "./credentials";
import type { HostIdentity, PrivescVector } from "./hostFacts";
import type { ScanPort, Service } from "./service";

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
  /** Stored tried pairs this save promoted into credentials it created, as they were, with the attempts it made from
   *  them. Undo puts them back. The store always sends it; a record written by hand may leave it out. */
  promotedTriedPairs?: { credentialId: string; triedPairs: TriedPair[]; attempts: CredAttempt[] }[];
}

/** A planned attempt (mirrors the Rust `PlannedAttempt`): no `credId` on a pending credential's own attempts, and a
 *  `usernameKey` for a username the same plan adds. */
export type PlannedAttemptProof = Omit<CredAttemptInput, "credId" | "logEntryId" | "at"> & { credId?: string; usernameKey?: string };

/** Mirrors the Rust `IntakeProof`: a credential intake plan, with the operator's choice on each pending credential. */
export interface IntakeProof {
  usernames: { key: string; input: UsernameInput }[];
  attempts: PlannedAttemptProof[];
  credentials: {
    input: CredentialInput;
    accepted: boolean;
    attempts: PlannedAttemptProof[];
    fromUsername: { usernameId?: string | null; usernameKey?: string; secretCredIds: string[]; hostId?: string | null } | null;
    ifDeclined: PlannedAttemptProof[];
  }[];
  hashes: CredentialInput[];
  links: { credId: string; fromSecretId: string }[];
  reprovedCredentialIds: string[];
  reprovedUsernameIds: string[];
}

/**
 * Mirrors the Rust `ExtractionProofs`: what one saved entry's output proved, for the store to file. A host id anywhere
 * in it may be the `key` of one of `newHosts`: the store puts that host's id in its place.
 */
export interface ExtractionProofs {
  /** Hosts the save made before the entry, for a scan of an IP that wasn't one yet. */
  createdHostIds: string[];
  newHosts: { key: string; ip: string }[];
  scans: { hostId: string; ports: ScanPort[]; os: string | null }[];
  /** Who the user is on the host, merged with what was stored. */
  identity: { hostId: string; username: string; privileges: string[]; groups: string[] } | null;
  /** Dumped and pasted credentials. */
  credentials: CredentialInput[];
  /** A cracked secret and the hashes it cracks: stored ones by id, and ones in `credentials` by index. */
  cracks: { plaintext: string; credentialIds: string[]; proofCredentials: number[] }[];
  usernames: UsernameInput[];
  intake: IntakeProof | null;
  /** Failed pairs whose secret is no credential. */
  triedPairs: TriedPairInput[];
  vectors: { hostId: string; title: string }[];
}

/** Mirrors the Rust `Filed`: what the store filed, for the summary. */
export interface Filed {
  /** The stored extraction; its summary is empty until `extractionFinish`. */
  extraction: Extraction;
  /** Each new host's id, by its key. */
  hostIds: Record<string, string>;
  scans: { hostId: string; services: number; osSet: boolean }[];
  identityChanged: boolean;
  /** Attempts the save added or whose result it changed. */
  attempts: CredAttempt[];
  /** Every credential the save created or changed, or that one of `attempts` is on. */
  credentials: Credential[];
  triedPairsAdded: number;
  cracked: { hashId: string; plaintext: string }[];
  /** The vectors it created. */
  vectors: PrivescVector[];
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
