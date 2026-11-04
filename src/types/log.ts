export type LogKind = "command" | "screenshot" | "http" | "note" | "flag";
export type FlagKind = "local" | "proof";

/** Mirrors the Rust `CommandBlock`. */
export type CommandBlock = { command: string; output: string; shell?: string };

/** Mirrors the Rust `LogContent`; `kind` is the tag and equals the entry's `kind`. */
export type LogContent =
  | { kind: "command"; blocks: CommandBlock[] }
  | { kind: "screenshot"; attachmentId: string; caption: string; fileName: string }
  | { kind: "http"; request: string; response?: string | null }
  | { kind: "note"; text: string }
  | { kind: "flag"; flagKind: FlagKind; value: string; attachmentId?: string | null };

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
