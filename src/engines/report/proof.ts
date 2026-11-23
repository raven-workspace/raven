import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

export interface ProofFacts {
  showsIp: boolean;
  showsIdentity: boolean;
  showsHostname: boolean;
  /** A read of the flag from its usual folder. */
  usualPath: boolean;
  /** The text shows which folder the flag was read from (an absolute path, a prompt or a `cd`): only then can Raven
   *  say it was read from somewhere else. */
  pathKnown: boolean;
  hasScreenshot: boolean;
}

/** A command that prints the machine's addresses: `ip a`, `ip addr`, `ifconfig`, `ipconfig`. */
export const ADDRESS_COMMAND = /\bip\s+(?:-\S+\s+)*a(?:ddr(?:ess)?)?\b|\bifconfig\b|\bipconfig\b/i;
const WHOAMI = /\bwhoami\b/i;
/** `id` as a command: at a line start or right after a prompt or separator. */
const ID_COMMAND = /(?:^|[;&|$#>]\s*)id(?:\s|$)/m;
const HOSTNAME = /\bhostname\b/i;
const READ_COMMAND = /\b(?:cat|type)\s+(.+)/gi;
/** A `cd` and its argument, cut where the next command starts (`;`, `&&`, `|`). */
const CD_COMMAND = /\bcd\s+(?:\/d\s+)?([^;&|\r\n]+)/gi;
/** `~` alone is the shell user's home: /root for root, /home/<user> for anyone else. */
const USUAL_DIRS = [/^\/root\b/i, /^\/home\/[^/\s]+/i, /^"?C:\\Users\\[^\\]+\\Desktop/i, /^~$/];
/** The folder a prompt shows: bash (`user@host:/dir$`, `user@host:~#`), cmd (`C:\dir>`), PowerShell (`PS C:\dir>`) and Evil-WinRM (`*Evil-WinRM* PS C:\dir>`). */
const PROMPT_DIR = /^\s*(?:\*Evil-WinRM\*\s+)?(?:PS\s+)?(?:[^\s@]+@[^\s:]+:)?(~\S*|\/\S*|[A-Za-z]:\\[^>]*)[>#$]/;
const USUAL_PATHS = [/\/root\//i, /\/home\/[^/\s]+\//i, /C:\\Users\\[^\\]+\\Desktop\\/i];
/** A read whose argument names its folder: `/x/proof.txt`, `C:\x\proof.txt`, `~/local.txt`. */
const ABSOLUTE = /^["']?(?:\/|~\/|[A-Za-z]:\\)/;

const hasIp = (text: string, ip: string) =>
  new RegExp(`(?<![\\d.])${ip.replace(/\./g, "\\.")}(?!\\d|\\.\\d)`).test(text);

/** Where `cd arg` lands from `base`: an absolute or home argument as is, a relative one under `base` (`..` goes up). */
function cdInto(base: string | null, arg: string): string {
  const to = arg.trim().replace(/^["']|["']$/g, "");
  if (base == null || /^(?:\/|~|[A-Za-z]:\\)/.test(to)) return to;
  const win = /^[A-Za-z]:\\/.test(base);
  const sep = win ? "\\" : "/";
  const parts = base.split(/[\\/]/).filter((p, i) => p !== "" || i === 0);
  for (const p of to.split(/[\\/]/)) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(p);
  }
  const joined = parts.join(sep);
  return win || joined.startsWith("/") || joined.startsWith("~") ? joined : `/${joined}`;
}

/**
 * Whether the text reads a file from a folder it shows (a prompt or a `cd`), and whether that folder is a usual one.
 * A `cd` on the read's line moves from the prompt's folder (`PS C:\Users\bob> cd Desktop; type proof.txt`).
 */
function readsFromDir(text: string): { known: boolean; usual: boolean } {
  let dir: string | null = null;
  let known = false;
  for (const line of text.split(/\r?\n/)) {
    const prompt = PROMPT_DIR.exec(line)?.[1];
    let at: string | null = prompt ?? dir;
    for (const m of line.matchAll(CD_COMMAND)) {
      at = cdInto(at, m[1]);
      dir = at;
    }
    if (at != null && /\b(?:cat|type)\s+\S/i.test(line)) {
      if (USUAL_DIRS.some((re) => re.test(at))) return { known: true, usual: true };
      known = true;
    }
  }
  return { known, usual: false };
}

/** What a proof's text shows, read from all of it. Raven can't read a screenshot, only text. */
export function textFacts(text: string, host: Host): Omit<ProofFacts, "hasScreenshot"> {
  const reads = [...text.matchAll(READ_COMMAND)].map((m) => m[1].trim());
  const dir = readsFromDir(text);
  const usualRead = reads.some((arg) => USUAL_PATHS.some((re) => re.test(arg)));
  return {
    showsIp: host.ip != null && host.ip !== "" && ADDRESS_COMMAND.test(text) && hasIp(text, host.ip),
    showsIdentity: WHOAMI.test(text) || ID_COMMAND.test(text),
    showsHostname: HOSTNAME.test(text),
    usualPath: usualRead || dir.usual,
    pathKnown: usualRead || dir.known || reads.some((arg) => ABSOLUTE.test(arg)),
  };
}

const flagOf = (e: LogEntry) => (e.content.kind === "flag" ? e.content : null);

/** A command entry's text as one terminal: each block's command line, then its output. */
const terminalText = (e: LogEntry) =>
  e.content.kind === "command" ? e.content.blocks.map((b) => `${b.command ?? ""}\n${b.output ?? ""}`).join("\n") : "";

/** What a flag's proof shows: the flag's own paste and screenshot, with its companions' (`proofCompanions`, in
 *  `placement.ts`). */
export function proofFacts(entry: LogEntry, host: Host, companions: LogEntry[] = []): ProofFacts {
  const flag = flagOf(entry);
  const text = [flag?.proof ?? "", ...companions.map(terminalText)].filter((t) => t.trim() !== "").join("\n");
  return {
    ...textFacts(text, host),
    hasScreenshot: Boolean(flag?.attachmentId) || companions.some((e) => e.content.kind === "screenshot"),
  };
}
