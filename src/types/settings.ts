export interface Settings {
  autoLockMinutes: number;
  backupRetention: number;
  /** Machine labels offered as "ran on" in the capture panel. */
  machines: string[];
  /** Blank or a single IPv4 address. */
  attackerIp: string;
  /** Blank or 1-65535. */
  listenerPort: string;
  /** Fills {KALI_USER}. */
  kaliUser: string;
  windowsToolsDir: string;
  linuxToolsDir: string;
  /** The Field-Manual vault Raven reads its library from. */
  fieldManualPath: string;
  /** Whether an NVD API key is stored. The key itself never leaves Rust. */
  nvdKeySet: boolean;
  /** Report cover defaults, copied into each new report. Blank allowed. */
  reportName: string;
  reportEmail: string;
  reportOsid: string;
  /** Default methodology text for new reports. */
  reportMethodology: string;
}

export type SettingsPatch = Partial<Omit<Settings, "nvdKeySet">> & {
  /** Sets the NVD API key; an empty string clears it. */
  nvdApiKey?: string;
};
