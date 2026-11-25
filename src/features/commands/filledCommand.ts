import { fillForms, nextFreePort, type FillInput } from "../../engines/checklist";
import { canonicalToken, findPlaceholders } from "../../engines/checklist/template";
import type { LibraryCommand, RunFrom } from "../../engines/library/types";
import { MASK } from "../credentials/MaskedSecret/MaskedSecret";

/**
 * A filled command: a command with its placeholders filled for the host in view, filled once and used three ways.
 * Shown masked, copied with its secrets in, typed (and logged) as you would type it at the shell.
 */
export interface FilledCommand {
  id: string;
  title: string;
  /** What is shown: secret tokens masked. */
  shown: string;
  /** What Copy puts on the clipboard: the real values, credential values shell-escaped when it runs from Kali. */
  copied: string;
  /** What you type at the shell, and what a log entry records: the real values, neither masked nor escaped. */
  typed: string;
  unresolved: string[];
  /** The copied text carries a secret: it is copied as one, so a lock wipes it from the clipboard. */
  secret: boolean;
  /** Where it runs: "attacker" logs it as run on your own machine, "target" on the host in view. */
  runFrom: RunFrom;
  /** Exam sim, no host locked yet: this command would spend the one Metasploit host (lists mark it). */
  msfMarker?: boolean;
  viaTunnel?: { viaHostId: string; viaHostName: string; down: boolean };
  /** The DC in this command was picked by host name only. */
  dcByName?: boolean;
  /** Field-manual commands: the Arsenal card they came from. */
  cardId?: string;
  /** Uses {FILE} or {SCRIPT}: the step shows the Toolkit picker for this host. */
  fileToken?: { hostId: string; os: "windows" | "linux" | null; token: "FILE" | "SCRIPT" };
  /** Uses {PORT} and the host has several matching open ports: the step shows a port chip. */
  portToken?: { key: string; choices: number[]; picked: number };
  /** Its {LPORT} is already held by a logged listener: warn and name the next free port. */
  portClash?: { port: number; suggested: number };
  /** The raw unresolved tokens as they appear in `shown`, to mark. */
  tokens?: string[];
}

/** One library command filled for the host in view, in one fill. `msfMarker`: a list marks it as taking the lock. */
export function fillLibraryCommand(c: LibraryCommand, input: FillInput, msfMarker = false): FilledCommand {
  // Copied: shell-escaped where the command runs in the Kali shell (see FillOptions.shellSafe).
  const f = fillForms(c.template, input, { secretMask: MASK, shellSafe: c.runFrom === "attacker", commandOs: c.os });
  const out: FilledCommand = {
    id: c.id, title: c.title, shown: f.shown, copied: f.copied, typed: f.typed, unresolved: f.unresolved, secret: f.secret,
    runFrom: c.runFrom, tokens: f.marks,
  };
  if (msfMarker) out.msfMarker = true;
  if (c.cardId) out.cardId = c.cardId;
  const names = findPlaceholders(c.template).map((p) => canonicalToken(p.raw));
  const fileTok = names.find((n): n is "FILE" | "SCRIPT" => n === "FILE" || n === "SCRIPT");
  if (fileTok) out.fileToken = { hostId: input.host.id, os: input.host.os === "windows" || input.host.os === "linux" ? input.host.os : null, token: fileTok };
  if (f.dcByName) out.dcByName = true;
  if (f.viaTunnel) out.viaTunnel = { viaHostId: f.viaTunnel.tunnel.viaHostId, viaHostName: f.viaTunnel.viaHostName, down: f.viaTunnel.down };
  // A reverse shell back to {LPORT} clashes with a listener already in the log: name the next free port.
  if (input.listenerPorts?.size && names.includes("LPORT")) {
    const port = Number(input.listenerPort.trim());
    if (Number.isInteger(port) && input.listenerPorts.has(port)) {
      out.portClash = { port, suggested: nextFreePort(port, input.listenerPorts) };
    }
  }
  return out;
}

/**
 * A command whose text is already final (Payloads' generated payloads, a Manual block copied as written, a nudge):
 * shown, copied and typed alike, with no secret in it.
 */
export function commandText({ id, title, text, unresolved = [], runFrom = "target" }: {
  id: string; title: string; text: string; unresolved?: string[]; runFrom?: RunFrom;
}): FilledCommand {
  return { id, title, shown: text, copied: text, typed: text, unresolved, secret: false, runFrom };
}

/** Several filled commands as one, a line each (Transfer's target half), run where the first one runs. */
export function joinCommands(id: string, title: string, parts: FilledCommand[]): FilledCommand {
  const join = (k: "shown" | "copied" | "typed") => parts.map((p) => p[k]).join("\n");
  return {
    id, title, shown: join("shown"), copied: join("copied"), typed: join("typed"),
    unresolved: [...new Set(parts.flatMap((p) => p.unresolved))], secret: parts.some((p) => p.secret), runFrom: parts[0]?.runFrom ?? "target",
  };
}
