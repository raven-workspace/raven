export type BoardColumn = "enumerate" | "foothold" | "privesc" | "loot" | "done";
export type HostOs = "windows" | "linux" | "other";
export type HostAccess = "none" | "user" | "root";

/** Mirrors the Rust `Host`. Timestamps are Unix milliseconds. */
export interface Host {
  id: string;
  engagementId: string;
  name: string;
  ip: string | null;
  os: HostOs | null;
  boardColumn: BoardColumn;
  boardManual: boolean;
  access: HostAccess;
  createdAt: number;
  updatedAt: number;
  dualHomed: boolean;
  /** The column the checklist last derived; a hand placement holds until it changes. */
  boardDerived: BoardColumn | null;
  /** When the user last reviewed this host's access grants; null = never. */
  accessReviewedAt: number | null;
  /** Exam-sim AD set as stored: null = automatic, true/false = set by hand. */
  adSet: boolean | null;
  /** Whether the host counts as part of the AD set (`adSet`, else open 88 and 389). */
  adSetEffective: boolean;
}

/** Mirrors the Rust `HostInput` (create and full update). */
export interface HostInput {
  name: string;
  ip?: string | null;
  os?: HostOs | null;
  access?: HostAccess;
  /** Absent keeps the current value. */
  dualHomed?: boolean;
  /** Absent keeps the current value; null resets to automatic. */
  adSet?: boolean | null;
}
