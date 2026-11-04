export interface Settings {
  autoLockMinutes: number;
  backupRetention: number;
  /** Machine labels offered as "ran on" in the capture panel. */
  machines: string[];
}

export type SettingsPatch = Partial<Settings>;
