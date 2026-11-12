import { isMetasploitLine, metasploitHostIds, USE_MODULE } from "../checklist/examRules";
import { firstBinary } from "../library/matcher";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

const blocksOf = (entry: LogEntry) => (entry.content.kind === "command" ? entry.content.blocks : []);
const linesOf = (command: string) =>
  command
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/** Command segments of a line, split at unquoted `;`, `&&`, `||` and `|`. */
function segments(line: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ";" || ch === "|" || (ch === "&" && line[i + 1] === "&")) {
      out.push(line.slice(from, i));
      if (line[i + 1] === ch) i++;
      from = i + 1;
    }
  }
  out.push(line.slice(from));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Port scanners: their entries open a standalone target's Service Enumeration. */
const SCANNERS = new Set(["nmap", "rustscan", "masscan", "autorecon", "naabu", "nmapautomator", "nmapautomator.sh"]);

/** A command entry that runs a port scanner (`nmap`, `sudo rustscan`), in any of its blocks. */
export function isPortScan(entry: LogEntry): boolean {
  return blocksOf(entry).some((b) =>
    linesOf(b.command ?? "").some((line) => segments(line).some((seg) => SCANNERS.has((firstBinary(seg) ?? "").toLowerCase()))),
  );
}

const HANDLER = /(?:^|\/)multi\/handler$/i;

/** Metasploit modules the non-private entries selected with `use <path>`, each with the hosts it is attributed to. */
export function msfModules(
  log: LogEntry[],
  engagement: Engagement,
  hosts: Host[],
): { hostId: string; module: string }[] {
  const seen = new Set<string>();
  const out: { hostId: string; module: string }[] = [];
  for (const e of log) {
    if (e.private) continue;
    const modules: string[] = [];
    for (const block of blocksOf(e)) {
      for (const line of linesOf(block.command ?? "")) {
        if (!isMetasploitLine(line)) continue;
        for (const m of line.matchAll(USE_MODULE)) if (!HANDLER.test(m[1])) modules.push(m[1]);
      }
    }
    if (modules.length === 0) continue;
    for (const hostId of metasploitHostIds(e, engagement, hosts)) {
      for (const module of modules) {
        const key = `${hostId}\0${module}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ hostId, module });
      }
    }
  }
  return out;
}

/** Hosts Metasploit was used against by any non-private entry: a module selected with `use`, or a Meterpreter
 *  session or payload (which names no module). */
export function msfHosts(log: LogEntry[], engagement: Engagement, hosts: Host[]): string[] {
  const out = new Set<string>();
  for (const e of log) if (!e.private) for (const id of metasploitHostIds(e, engagement, hosts)) out.add(id);
  return [...out];
}
