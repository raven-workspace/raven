import type { PasteContext } from "./context";

export type GeneratorId = "shell" | "transfer" | "sql" | "msfvenom" | "encode" | "upgrade";

/** One line of the "what each part does" list. `token` is the text as it appears in the output. */
export interface PayloadPart { token: string; explain: string }

export interface PayloadDef {
  id: string;
  generator: GeneratorId;
  title: string;
  os: "linux" | "windows";
  /** Where it works as pasted (after wrapping). */
  contexts: PasteContext[];
  requires: ("nc" | "nc-e" | "python3" | "powershell" | "bash" | "php" | "served-file")[];
  /** {LHOST} {LPORT} {FILE} ... placeholders. */
  template: string;
  parts: PayloadPart[];
  listener: "penelope" | "none";
  /** A file or script with LHOST inside (stale warning). */
  bakesIp?: boolean;
  /** The ( ... ) & variant. */
  background?: boolean;
  /** Command to serve a hosted script, e.g. "python3 -m http.server {SERVE_PORT}". */
  serve?: string;
  /** Kali-side lines that make the served file, run before `serve` (placeholders filled like the template). */
  prepare?: string;
  /** The filled template is a PowerShell script: build UTF-16LE base64 and run it with `powershell -e`. */
  encodePowerShell?: boolean;
  /** Values used when the caller supplies none (not counted as unresolved). */
  defaults?: Record<string, string>;
  /** Def-specific notes and traps shown with the payload. */
  notes?: string[];
}

export interface BuiltPayload {
  def: PayloadDef;
  text: string;
  listener: string | null;
  parts: PayloadPart[];
  notes: string[];
  /** Placeholder names whose value is blank or missing; they stay visible as {NAME} in the text. */
  unresolved: string[];
  /** What to run on Kali first (make the file, then serve it), filled; null when nothing is served. */
  prepare: string | null;
}
