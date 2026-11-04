export type EngagementKind = "exam-sim" | "lab" | "client";
export type EngagementStatus = "active" | "archived";

/** Mirrors the Rust `Engagement`. Timestamps are Unix milliseconds. */
export interface Engagement {
  id: string;
  name: string;
  kind: EngagementKind;
  client: string | null;
  subLabel: string | null;
  scopeCidrs: string[];
  domain: string | null;
  startsAt: number | null;
  endsAt: number | null;
  timeboxStart: number | null;
  timeboxMinutes: number | null;
  status: EngagementStatus;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number | null;
  lastRanOn: string | null;
}

/** Mirrors the Rust `EngagementInput` (create and full update). */
export interface EngagementInput {
  name: string;
  kind: EngagementKind;
  client?: string | null;
  subLabel?: string | null;
  scopeCidrs?: string[];
  domain?: string | null;
  startsAt?: number | null;
  endsAt?: number | null;
  timeboxStart?: number | null;
  timeboxMinutes?: number | null;
}
