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
  evidence: Evidence[];
  updatedAt: number;
}

/** Mirrors the Rust `ChecklistItemInput` (the item without `updatedAt`). */
export type ChecklistItemInput = Omit<ChecklistItem, "updatedAt" | "notes" | "completedAt" | "auto" | "autoFrom" | "evidence"> &
  Partial<Pick<ChecklistItem, "notes" | "completedAt" | "auto" | "autoFrom" | "evidence">>;

/** The engine's per-goal shape (the old `itemsState[goalId]`). */
export interface ItemState {
  status: ChecklistStatus;
  notes?: string;
  completedAt?: number;
  auto?: boolean;
  autoFrom?: "na" | "in_progress";
  evidence?: Evidence[];
}

export type ChecklistState = Record<string, ItemState>;
