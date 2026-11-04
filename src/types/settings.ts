export interface Settings {
  autoLockMinutes: number;
  backupRetention: number;
  /** Machine labels offered as "ran on" in the capture panel. */
  machines: string[];
  /** Blank or a single IPv4 address. */
  attackerIp: string;
  /** Blank or 1-65535. */
  listenerPort: string;
}

export type SettingsPatch = Partial<Settings>;
