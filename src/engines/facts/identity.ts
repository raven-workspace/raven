import { isKaliLabel } from "../attribution";
import { detectPrompt, splitPaste } from "../parse/logPaste";
import type { Host } from "../../types/host";
import type { CommandBlock, LogEntry } from "../../types/log";

export interface ParsedIdentity {
  username?: string;
  privileges: string[];
  groups: string[];
}

const PRIV_VECTORS = [
  "SeImpersonatePrivilege",
  "SeAssignPrimaryTokenPrivilege",
  "SeBackupPrivilege",
  "SeRestorePrivilege",
  "SeDebugPrivilege",
  "SeLoadDriverPrivilege",
  "SeTakeOwnershipPrivilege",
  "SeManageVolumePrivilege",
];
const GROUP_VECTORS = ["sudo", "wheel", "docker", "lxd", "disk", "adm"];

function parsePrivileges(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(Se\w+)\s+.*\b(Enabled|Disabled)\s*$/.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Rows of a `whoami` table: first column of each line after the `====` rule, up to a blank line. */
function tableFirstColumn(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const rule = lines.findIndex((l) => /^={3,}(\s+={3,})*\s*$/.test(l.trim()));
  if (rule < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(rule + 1)) {
    if (!line.trim()) break;
    out.push(line.trim().split(/\s{2,}/)[0]);
  }
  return out;
}

/** Splits `whoami /all` into its titled sections. */
function sections(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = output.split(/^([A-Z][A-Z ]+INFORMATION)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

function parseId(output: string): ParsedIdentity | null {
  const uid = /uid=\d+\(([^)]+)\)/.exec(output);
  if (!uid) return null;
  const groupsPart = /groups=(\S.*)$/m.exec(output)?.[1] ?? "";
  const groups = [...groupsPart.matchAll(/\d+\(([^)]+)\)/g)].map((m) => m[1]);
  return { username: uid[1], privileges: [], groups };
}

/** A target-side prompt left at the front of command text: Evil-WinRM, PowerShell or cmd. */
const LEADING_PROMPT = /^(?:\*Evil-WinRM\* PS [^>]*>|PS [^>]*>|[A-Za-z]:\\[^>]*>)\s*/;

/** The command with any leading target-side prompt removed, whitespace collapsed and lowercased. */
function normalizeCommand(command: string): string {
  return command.trim().replace(LEADING_PROMPT, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The bare command a chain starts with: `whoami & hostname`, `id; cat proof.txt`, `whoami && x` give "whoami"/"id".
 * Anything else (not led by bare whoami/id, or a pipe anywhere) gives null. A non-chain returns the command itself.
 */
function leadingCommand(cmd: string): string | null {
  if (cmd.includes("|")) return null;
  const parts = cmd.split(/\s*(?:;|&&|&)\s*/);
  if (parts.length === 1) return cmd;
  return parts[0] === "whoami" || parts[0] === "id" ? parts[0] : null;
}

/** The first output line of a chained `id`: the one with `uid=`. */
function firstUidLine(output: string): string {
  return output.split(/\r?\n/).find((l) => /uid=\d+\(/.test(l)) ?? "";
}

export function parseIdentity(command: string, output: string): ParsedIdentity | null {
  const full = normalizeCommand(command);
  const cmd = leadingCommand(full);
  // Piped or filtered output is partial: it must never replace stored privileges or groups.
  if (cmd === null) return null;
  if (cmd === "id") return parseId(cmd === full ? output : firstUidLine(output));
  if (cmd === "whoami") {
    const name = output.split(/\r?\n/).find((l) => l.trim())?.trim();
    return name ? { username: name, privileges: [], groups: [] } : null;
  }
  if (cmd === "whoami /priv") return { privileges: parsePrivileges(output), groups: [] };
  if (cmd === "whoami /groups") return { privileges: [], groups: tableFirstColumn(output) };
  if (cmd === "whoami /all") {
    const s = sections(output);
    const username = tableFirstColumn(s["USER INFORMATION"] ?? "")[0];
    return {
      ...(username ? { username } : {}),
      privileges: parsePrivileges(s["PRIVILEGES INFORMATION"] ?? ""),
      groups: tableFirstColumn(s["GROUP INFORMATION"] ?? ""),
    };
  }
  return null;
}

/** Who the user is on a host as far as a merge is concerned; `username` is null when nothing has named the user. */
export interface IdentityFields {
  username: string | null;
  privileges: string[];
  groups: string[];
}

/** Which fields an identity command speaks for. `whoami /priv` says nothing about groups, so it must not clear them. */
export function identityFieldsOf(command: string): { username: boolean; privileges: boolean; groups: boolean } {
  const cmd = leadingCommand(normalizeCommand(command)) ?? normalizeCommand(command);
  if (cmd === "whoami /priv") return { username: false, privileges: true, groups: false };
  if (cmd === "whoami /groups") return { username: false, privileges: false, groups: true };
  if (cmd === "whoami") return { username: true, privileges: false, groups: false };
  // `whoami /all` and `id` speak for everything.
  return { username: true, privileges: true, groups: true };
}

/**
 * Folds one parsed identity command into what is already known: `whoami /priv` replaces only the privileges,
 * `whoami /groups` only the groups, bare `whoami` only the username, `whoami /all` and `id` replace all three (a
 * missing username keeps the stored one). The one merge rule shared by capture and reading an existing log.
 */
export function mergeIdentity(stored: IdentityFields | null, parsed: ParsedIdentity, command: string): IdentityFields {
  const covers = identityFieldsOf(command);
  const base: IdentityFields = stored ?? { username: null, privileges: [], groups: [] };
  return {
    username: covers.username && parsed.username ? parsed.username : base.username,
    privileges: covers.privileges ? [...parsed.privileges] : [...base.privileges],
    groups: covers.groups ? [...parsed.groups] : [...base.groups],
  };
}

export function vectorsFromIdentity(id: { privileges: string[]; groups: string[] }): string[] {
  const privs = PRIV_VECTORS.filter((p) => id.privileges.includes(p)).map((p) => `${p} abuse`);
  const groups = GROUP_VECTORS.filter((g) => id.groups.includes(g)).map((g) => `${g} group`);
  return [...privs, ...groups];
}

/** A parsed username that is really a shell error (or prose), not an account name. */
function looksLikeErrorOutput(username: string): boolean {
  if (/not recognized|ERROR|command not found/.test(username)) return true;
  return /\s/.test(username) && !username.includes("\\");
}

/**
 * What a command block says about who the user is, or null when it says nothing usable: not an identity command,
 * empty, or error output. The one guard shared by capture-time recording and reading an existing log.
 */
export function usableIdentity(block: Pick<CommandBlock, "command" | "output">): ParsedIdentity | null {
  const parsed = parseIdentity(block.command, block.output);
  if (!parsed) return null;
  if (!parsed.username && parsed.privileges.length === 0 && parsed.groups.length === 0) return null;
  if (parsed.username && looksLikeErrorOutput(parsed.username)) return null;
  return parsed;
}

const TARGET_SHELLS = new Set(["evil-winrm", "powershell", "cmd"]);
const WINDOWS_ONLY = new Set(["whoami /priv", "whoami /groups", "whoami /all"]);

/** Blocks of a bare-prompt transcript (`# id`, `$ whoami`), which `splitPaste` leaves whole without a distinctive prompt. */
function splitBarePrompts(text: string): CommandBlock[] {
  const blocks: CommandBlock[] = [];
  let cur: { command: string; out: string[] } | null = null;
  const close = () => {
    if (cur) blocks.push({ command: cur.command, output: cur.out.join("\n").trim(), shell: "sh" });
    cur = null;
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const p = detectPrompt(line);
    if (p) {
      close();
      if (p.command) cur = { command: p.command, out: [] };
    } else if (cur) cur.out.push(line);
  }
  close();
  return blocks;
}

/** A flag entry's proof read as a terminal transcript: the blocks of whatever the user ran before printing the flag. */
function proofBlocks(proof: string): CommandBlock[] {
  const blocks = splitPaste(proof);
  if (blocks.length === 1 && !blocks[0].shell && /^[$#]\s/.test(blocks[0].command)) return splitBarePrompts(proof);
  return blocks;
}

/** The command blocks an entry speaks through: its own for a command, the parsed proof transcript for a flag, else none. */
export function identityBlocksOf(entry: LogEntry): CommandBlock[] {
  if (entry.content.kind === "command") return entry.content.blocks;
  if (entry.content.kind === "flag" && entry.content.proof?.trim()) return proofBlocks(entry.content.proof);
  return [];
}

/** A command entry, or a flag entry with a proof, linked to exactly this host (its blocks are judged one by one with `isIdentityBlockFor`). */
export function isIdentityEntryFor(entry: LogEntry, host: Host): boolean {
  const readable = entry.content.kind === "command" || (entry.content.kind === "flag" && !!entry.content.proof?.trim());
  return readable && entry.hostIds.length === 1 && entry.hostIds[0] === host.id;
}

/**
 * Whether one command block of an entry speaks for this host's identity. Windows-only `whoami` forms cannot have run on
 * Kali, so they count on a windows or unknown-OS host; a block from a target-side shell (Evil-WinRM, PowerShell, cmd)
 * counts; anything else (bare `whoami`, `id`) counts only when Ran on is unknown or this host, never an attacker box.
 */
export function isIdentityBlockFor(entry: LogEntry, host: Host, block: Pick<CommandBlock, "command"> & Partial<CommandBlock>): boolean {
  if (!isIdentityEntryFor(entry, host)) return false;
  // A block that ran in an attacker (Kali) shell never speaks for the target, whatever its command or Ran on.
  if (block.shell && isKaliLabel(block.shell)) return false;
  const cmd = normalizeCommand(block.command);
  if (WINDOWS_ONLY.has(cmd) && (host.os === "windows" || host.os == null)) return true;
  if ((block.shell && TARGET_SHELLS.has(block.shell)) || LEADING_PROMPT.test(block.command.trim())) return true;
  const ranOn = entry.ranOn?.trim() ?? "";
  if (!ranOn) return true;
  return !isKaliLabel(ranOn) && ranOn.toLowerCase() === host.name.toLowerCase();
}
