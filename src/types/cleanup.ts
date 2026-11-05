export type CleanupKind = "file" | "account" | "service" | "other";
export type CleanupStatus = "open" | "removed" | "dismissed";

export interface CleanupItem {
  id: string;
  engagementId: string;
  hostId: string | null;
  kind: CleanupKind;
  target: string;
  notes: string | null;
  sourceEntryId: string | null;
  /** Set when the item came from a suggestion; dismissed rows exist only to hide one. */
  suggestionKey: string | null;
  status: CleanupStatus;
  removedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CleanupInput {
  hostId?: string | null;
  kind: CleanupKind;
  target: string;
  notes?: string | null;
  sourceEntryId?: string | null;
  /** Used on create only; update ignores it. */
  suggestionKey?: string | null;
}
