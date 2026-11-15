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
  /** The host holding the Metasploit lock, if any. */
  msfHostId: string | null;
  /** Exam sims: time the timebox has spent paused, not counting a pause still running. */
  timeboxPausedMs: number;
  /** Exam sims: when the running pause began; null while the timebox runs. */
  timeboxPausedAt: number | null;
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
