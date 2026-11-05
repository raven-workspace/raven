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
}

/** Mirrors the Rust `HostInput` (create and full update). */
export interface HostInput {
  name: string;
  ip?: string | null;
  os?: HostOs | null;
  access?: HostAccess;
  /** Absent keeps the current value. */
  dualHomed?: boolean;
}
