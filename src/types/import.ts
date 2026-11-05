/** Added and already-present counts for one record type. */
export interface ImportCount {
  added: number;
  /** Already stored under the same id (services, usernames and attempts: the same unique key). */
  present: number;
  /** Matched to a row the user already had (a host on its IP, a credential on its key); links point at that row. */
  merged: number;
}

/** Mirrors the Rust `ImportSummary`: what `importApply` added and what was already stored, per record type. */
export interface ImportSummary {
  engagements: ImportCount;
  hosts: ImportCount;
  services: ImportCount;
  logEntries: ImportCount;
  notes: ImportCount;
  checklist: ImportCount;
  tunnels: ImportCount;
  hops: ImportCount;
  findings: ImportCount;
  credentials: ImportCount;
  usernames: ImportCount;
  accessGrants: ImportCount;
  credAttempts: ImportCount;
}

export type ImportRecordType = keyof ImportSummary;
