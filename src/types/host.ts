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
}

/** Mirrors the Rust `HostInput` (create and full update). */
export interface HostInput {
  name: string;
  ip?: string | null;
  os?: HostOs | null;
  access?: HostAccess;
}
