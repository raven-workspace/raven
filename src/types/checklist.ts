export type ChecklistStatus = "todo" | "in_progress" | "done" | "na";

export interface Evidence {
  entryId: string;
  commandId?: string | null;
}

/** Mirrors the Rust `ChecklistItem`. `ownerId` is a host id, or the engagement id for engagement goals. */
export interface ChecklistItem {
  ownerId: string;
  goalId: string;
  status: ChecklistStatus;
  notes: string | null;
  completedAt: number | null;
  auto: boolean;
  autoFrom: "na" | "in_progress" | null;
  /** Set by hand (a status button): the domain admin cover never changes it. */
  statusManual?: boolean;
  evidence: Evidence[];
  updatedAt: number;
}

/** Mirrors the Rust `ChecklistItemInput` (the item without `updatedAt`). */
export type ChecklistItemInput = Omit<ChecklistItem, "updatedAt" | "notes" | "completedAt" | "auto" | "autoFrom" | "evidence" | "statusManual"> &
  Partial<Pick<ChecklistItem, "notes" | "completedAt" | "auto" | "autoFrom" | "evidence" | "statusManual">>;

/** The engine's per-goal shape (the old `itemsState[goalId]`). */
export interface ItemState {
  status: ChecklistStatus;
  notes?: string;
  completedAt?: number;
  auto?: boolean;
  autoFrom?: "na" | "in_progress";
  statusManual?: boolean;
  evidence?: Evidence[];
}

export type ChecklistState = Record<string, ItemState>;

/** Mirrors the Rust `EntryTick`: one goal a log entry achieves on one owner, by the command (or `out:<parser>`). */
export interface EntryTick {
  ownerId: string;
  goalId: string;
  commandId?: string | null;
}

/** Mirrors the Rust `EntryTicks`: every tick one log entry gives now (none once it is deleted), and the completion
 *  time a goal it newly ticks gets. */
export interface EntryTicks {
  entryId: string;
  at: number;
  ticks: EntryTick[];
}
