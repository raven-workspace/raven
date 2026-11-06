/** One file read from the Field-Manual vault by `field_manual_scan`. */
export interface VaultFile {
  /** Relative to the vault, `/`-separated. */
  relPath: string;
  mtimeMs: number;
  text: string;
}
