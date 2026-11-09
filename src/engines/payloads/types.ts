import type { PasteContext } from "./context";

export type ListenerId =
  | "penelope" | "rlwrap-nc" | "socat-tty" | "ncat-ssl" | "multi-handler" | "connect-nc" | "connect-socat" | "connect-penelope";
export type ToolId = "bash" | "python3" | "perl" | "nc" | "nc-e" | "socat" | "powershell" | "curl" | "wget";

export type GeneratorId = "shell" | "transfer" | "sql" | "msfvenom" | "encode" | "upgrade";

/**
 * One line of the "what each part does" list. A text part's `token` appears in the built text (or its prepare step, or
 * the wrapper a context adds, such as `bash -c`); its {NAME} placeholders are filled like the template. A `decoded`
 * part explains what is inside an encoded blob (the base64 script of `powershell -e`): its token is a label found in the
 * decoded script, not in the text, so the "token appears in the text" rule applies to text parts only.
 */
export interface PayloadPart { token: string; explain: string; decoded?: boolean }

export interface PayloadDef {
  id: string;
  generator: GeneratorId;
  title: string;
  /** "any": the same text runs on both; buildPayload wraps it for opts.os (default linux). */
  os: "linux" | "windows" | "any";
  /** Where it works as pasted (after wrapping). */
  contexts: PasteContext[];
  requires: (ToolId | "php" | "awk" | "busybox" | "served-file")[];
  /** {LHOST} {LPORT} {FILE} ... placeholders. */
  template: string;
  parts: PayloadPart[];
  /** Listeners that catch (or connect to) it; the first is the default; [] = none. */
  listeners: ListenerId[];
  /** Absent = reverse (needs a callback). Only the shell and msfvenom generators set it. */
  shape?: "bind" | "webshell";
  /** An uploaded file, fired by `trigger` (e.g. "http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}?cmd=whoami");
   *  kali: the trigger is Kali commands that write {FILE}. */
  upload?: { trigger: string; kali?: boolean };
  /** The msfvenom -p value; the multi-handler listener sets it. */
  msfPayload?: string;
  /** A Meterpreter payload: the Metasploit lock applies. */
  meterpreter?: boolean;
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
  /** Notes shown only in the given paste context (after `notes`). */
  contextNotes?: Partial<Record<PasteContext, string[]>>;
  /** Where the text is run: "kali" for your own terminal (an upgrade step); absent = the target. msfvenom and upload.kali defs run on Kali regardless. */
  runsOn?: "target" | "kali";
  /** The template is a key to press (Ctrl-Z), not text: it has no Copy, ↵ does not copy it, and ⇥ skips past it. */
  keypress?: boolean;
}

export interface BuiltPayload {
  def: PayloadDef;
  text: string;
  listener: string | null;
  listenerId: ListenerId | null;
  /** "Connect from Kali" for a bind shell's connect listener. */
  listenerHeading: "Listener" | "Connect from Kali";
  /** The filled upload trigger with its own unresolved names; null when the def has no upload. */
  trigger: { text: string; unresolved: string[] } | null;
  parts: PayloadPart[];
  notes: string[];
  /** Placeholder names whose value is blank or missing; they stay visible as {NAME} in the text. */
  unresolved: string[];
  /** What to run on Kali first (make the file, then serve it), filled; null when nothing is served. */
  prepare: string | null;
}
