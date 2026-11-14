import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { provingEntries } from "./prove";
import type { ReportData } from "./types";

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

const IP_COMMAND = /\b(?:ipconfig|ifconfig)\b|\bip\s+(?:-\S+\s+)*a(?:ddr(?:ess)?)?\b/i;
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
    showsIp: host.ip != null && host.ip !== "" && IP_COMMAND.test(text) && hasIp(text, host.ip),
    showsIdentity: WHOAMI.test(text) || ID_COMMAND.test(text),
    showsHostname: HOSTNAME.test(text),
    usualPath: usualRead || dir.usual,
    pathKnown: usualRead || dir.known || reads.some((arg) => ABSOLUTE.test(arg)),
  };
}

/** The 15 minutes either side of a flag in which a screenshot is taken to show it. */
export const COMPANION_WINDOW_MS = 15 * 60_000;
const NAMES_FLAG = /\bflags?\b/i;
const namesKind = (text: string, kind: "local" | "proof") => new RegExp(`\\b${kind}(?:\\.txt)?\\b`, "i").test(text);

const flagOf = (e: LogEntry) => (e.content.kind === "flag" ? e.content : null);
const shotText = (e: LogEntry) => `${e.content.kind === "screenshot" ? e.content.caption : ""}\n${e.title}`;

/**
 * The entries that show a flag's proof alongside the flag entry itself, as real captures make them: the flag is often
 * logged as just its value, the proof as a separate command (`cat proof.txt; whoami; ip a`) or screenshot. On the same
 * host, not private:
 *  - commands whose output (or command) holds the flag's value;
 *  - screenshots that name this flag (`proof`, `proof.txt`; or `flag` when this flag is the nearest one), or that were
 *    taken within 15 minutes of it, name no other flag, and are nearer to it than to any other step of the host. A
 *    screenshot that proves something itself (a finding's step, an access grant) is that step's, never a companion.
 * In time order, commands before screenshots.
 */
export function proofCompanions(data: ReportData, hostId: string, flagEntry: LogEntry): LogEntry[] {
  const flag = flagOf(flagEntry);
  if (!flag) return [];
  const value = flag.value.trim().toLowerCase();
  const onHost = data.log.filter((e) => e.id !== flagEntry.id && !e.private && e.hostIds.includes(hostId));
  const commands =
    value.length >= 8
      ? onHost.filter(
          (e) =>
            e.content.kind === "command" &&
            e.content.blocks.some((b) => `${b.command ?? ""}\n${b.output ?? ""}`.toLowerCase().includes(value)),
        )
      : [];
  const proving = provingEntries(data, hostId);
  const flags = onHost.filter((e) => flagOf(e) !== null);
  // The host's steps a screenshot could belong to: its proving entries (notes aside) and its flags.
  const steps = onHost.filter((e) => e.kind !== "screenshot" && e.kind !== "note" && (proving.has(e.id) || flagOf(e) !== null));
  const nearest = (shot: LogEntry, among: LogEntry[]) => {
    const gap = (e: LogEntry) => Math.abs(e.at - shot.at);
    const mine = gap(flagEntry);
    return among.every((e) => gap(e) > mine);
  };
  const other = flag.flagKind === "local" ? "proof" : "local";
  const shots = onHost.filter((e) => {
    if (e.content.kind !== "screenshot" || proving.has(e.id)) return false;
    const text = shotText(e);
    if (namesKind(text, flag.flagKind)) return nearest(e, flags.filter((f) => flagOf(f)?.flagKind === flag.flagKind));
    if (namesKind(text, other)) return false;
    if (NAMES_FLAG.test(text)) return nearest(e, flags);
    return Math.abs(e.at - flagEntry.at) <= COMPANION_WINDOW_MS && nearest(e, steps);
  });
  const byTime = (a: LogEntry, b: LogEntry) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  return [...commands.sort(byTime), ...shots.sort(byTime)];
}

/** A command entry's text as one terminal: each block's command line, then its output. */
const terminalText = (e: LogEntry) =>
  e.content.kind === "command" ? e.content.blocks.map((b) => `${b.command ?? ""}\n${b.output ?? ""}`).join("\n") : "";

/** What a flag's proof shows: the flag's own paste and screenshot, with its companions' (`proofCompanions`). */
export function proofFacts(entry: LogEntry, host: Host, companions: LogEntry[] = []): ProofFacts {
  const flag = flagOf(entry);
  const text = [flag?.proof ?? "", ...companions.map(terminalText)].filter((t) => t.trim() !== "").join("\n");
  return {
    ...textFacts(text, host),
    hasScreenshot: Boolean(flag?.attachmentId) || companions.some((e) => e.content.kind === "screenshot"),
  };
}
