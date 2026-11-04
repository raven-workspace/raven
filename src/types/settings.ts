export interface Settings {
  autoLockMinutes: number;
  backupRetention: number;
}

export type SettingsPatch = Partial<Settings>;
