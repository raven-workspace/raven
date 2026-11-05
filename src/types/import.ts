/** Added and already-present counts for one record type. */
export interface ImportCount {
  added: number;
  present: number;
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
