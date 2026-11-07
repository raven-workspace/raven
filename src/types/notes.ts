/** Mirrors the Rust `Note`. `ownerId` is the host id, or the engagement id for the engagement note. `updatedAt` 0 = never saved. */
export interface Note {
  ownerId: string;
  engagementId: string;
  hostId: string | null;
  body: string;
  /** Private notes never go into a client report or export. */
  private: boolean;
  updatedAt: number;
}

/** Mirrors the Rust `RuledOut`. */
export interface RuledOut {
  id: string;
  engagementId: string;
  hostId: string | null;
  text: string;
  reason: string;
  private: boolean;
  /** Set when a dead-end verdict created the item; undoing the verdict removes it. */
  sourceKind: "service" | "vector" | null;
  sourceId: string | null;
  createdAt: number;
}

/** Mirrors the Rust `RuledOutInput`. */
export interface RuledOutInput {
  engagementId: string;
  hostId?: string | null;
  text: string;
  reason: string;
  private?: boolean;
}
