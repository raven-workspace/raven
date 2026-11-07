import { isIdentityEntryFor, usableIdentity } from "../../../engines/facts";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";

export interface IdentityFromLog {
  identity: { username: string | null; privileges: string[]; groups: string[]; entryId: string } | null;
  /** How many log entries contributed. */
  sources: number;
}

/** `whoami /priv`, `whoami /groups`, `whoami /all`, `id` and `whoami` each say something different. */
const kindOf = (command: string) => command.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * What the host's existing log already says about who the user is: the newest username, and the privileges and
 * groups of the newest entry of each kind of command. Same entry rule and error guard as capture-time recording.
 */
export function identityFromLog(entries: LogEntry[], host: Host): IdentityFromLog {
  const newestFirst = entries.filter((e) => isIdentityEntryFor(e, host)).sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
  let username: string | null = null;
  const privileges: string[] = [];
  const groups: string[] = [];
  const seenKinds = new Set<string>();
  const sources: LogEntry[] = [];
  for (const entry of newestFirst) {
    if (entry.content.kind !== "command") continue;
    let contributed = false;
    for (const block of [...entry.content.blocks].reverse()) {
      const parsed = usableIdentity(block);
      if (!parsed) continue;
      if (parsed.username && username === null) {
        username = parsed.username;
        contributed = true;
      }
      const kind = kindOf(block.command);
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);
      for (const p of parsed.privileges) if (!privileges.includes(p)) privileges.push(p);
      for (const g of parsed.groups) if (!groups.includes(g)) groups.push(g);
      if (parsed.privileges.length > 0 || parsed.groups.length > 0) contributed = true;
    }
    if (contributed) sources.push(entry);
  }
  if (sources.length === 0) return { identity: null, sources: 0 };
  return { identity: { username, privileges, groups, entryId: sources[0].id }, sources: sources.length };
}
