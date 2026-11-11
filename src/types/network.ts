export type TunnelKind = "ligolo" | "chisel" | "ssh" | "socks" | "other";
export type TunnelStatus = "up" | "down";

/** Mirrors the Rust `Tunnel`. Timestamps are Unix milliseconds. */
export interface Tunnel {
  id: string;
  engagementId: string;
  kind: TunnelKind;
  viaHostId: string;
  subnets: string[];
  callbackIp: string;
  status: TunnelStatus;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `TunnelInput` (create and full update). */
export interface TunnelInput {
  kind: TunnelKind;
  viaHostId: string;
  subnets?: string[];
  /** Blank or a single IPv4 address. */
  callbackIp?: string;
  status: TunnelStatus;
  notes?: string | null;
}

/** Mirrors the Rust `Hop`. `fromHostId` null = initial access. */
export interface Hop {
  id: string;
  engagementId: string;
  fromHostId: string | null;
  toHostId: string;
  via: string;
  logEntryId: string | null;
  at: number;
  updatedAt: number;
}

/** Mirrors the Rust `HopInput` (create and full update). `at` defaults to now on create. */
export interface HopInput {
  fromHostId?: string | null;
  toHostId: string;
  via: string;
  logEntryId?: string | null;
  at?: number;
}

/** Mirrors the Rust `InterfaceDismissal`: a subnet suggestion the user waved away for one host. */
export interface InterfaceDismissal {
  engagementId: string;
  hostId: string;
  subnet: string;
  createdAt: number;
}
