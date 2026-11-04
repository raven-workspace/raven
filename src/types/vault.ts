import type { BackupInfo } from "./backup";

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
}

export interface UnlockResult {
  migratedFrom: number;
  migratedTo: number;
  /** The daily backup taken on this unlock, if one was due and succeeded. */
  dailyBackup: BackupInfo | null;
  /** Set when the daily backup was due but failed; the unlock still succeeded. */
  dailyBackupError: string | null;
}
