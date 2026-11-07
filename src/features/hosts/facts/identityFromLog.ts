import { identityFieldsOf, isIdentityBlockFor, isIdentityEntryFor, mergeIdentity, usableIdentity, type IdentityFields } from "../../../engines/facts";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";

export interface IdentityFromLog {
  identity: { username: string | null; privileges: string[]; groups: string[]; entryId: string } | null;
  /** How many log entries contributed. */
  sources: number;
}

type Field = keyof IdentityFields;

/**
 * What the host's existing log already says about who the user is: each identity command folded in oldest first with
 * `mergeIdentity`, the same rule capture uses, so `whoami /priv` then `whoami /groups` keeps both. Same block rule
 * (`isIdentityBlockFor`) and error guard as capture-time recording. An entry counts as a source when a field it set is still in the result.
 */
export function identityFromLog(entries: LogEntry[], host: Host): IdentityFromLog {
  const oldestFirst = entries.filter((e) => isIdentityEntryFor(e, host)).sort((a, b) => a.at - b.at || a.createdAt - b.createdAt);
  let identity: IdentityFields | null = null;
  // Which entry last set each field.
  const setBy: Partial<Record<Field, LogEntry>> = {};
  for (const entry of oldestFirst) {
    if (entry.content.kind !== "command") continue;
    for (const block of entry.content.blocks) {
      if (!isIdentityBlockFor(entry, host, block)) continue;
      const parsed = usableIdentity(block);
      if (!parsed) continue;
      identity = mergeIdentity(identity, parsed, block.command);
      const covers = identityFieldsOf(block.command);
      if (covers.username && parsed.username) setBy.username = entry;
      if (covers.privileges) setBy.privileges = entry;
      if (covers.groups) setBy.groups = entry;
    }
  }
  if (!identity) return { identity: null, sources: 0 };
  const sources = [...new Set(Object.values(setBy))].sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
  return { identity: { ...identity, entryId: sources[0].id }, sources: sources.length };
}
