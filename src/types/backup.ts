/** Mirrors the Rust `BackupInfo`. `createdAt` is Unix milliseconds. */
export interface BackupInfo {
  file: string;
  reason: string;
  createdAt: number;
  sizeBytes: number;
}
