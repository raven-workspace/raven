import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { LogEntry } from '../../types/log';
import { namedHostsInLine, shellHost } from '../attribution';
import { firstBinary } from '../library/matcher';
import { MSFVENOM } from '../payloads/msfvenom';
import { SHELLS } from '../payloads/shells';

const blocksOf = (entry: LogEntry) => (entry.content.kind === 'command' ? entry.content.blocks : []);

const PROMPT_PREFIX = /^msf\d*(?: \w+\([^)]*\))? >\s*/i;
/** `use <module>`: long form (exploit/, auxiliary/, post/) or any short-form path like `windows/smb/psexec`. */
export const USE_MODULE = /(?:^|[;\s"'`])use\s+([\w-]+(?:\/[\w.-]+)+)/gi;
const HANDLER = /(?:^|\/)multi\/handler$/i;

/**
 * A line that spends the exam's one Metasploit use: it identifies a module with `use <path>` (optionally behind an
 * `msf6 > ` prompt, or inside `msfconsole -x "..."`). `multi/handler` (a plain listener) never counts, nor does
 * a bare `msfconsole` / `msfconsole -r file.rc` with no module on the line, nor `msfvenom`.
 */
export function isMetasploitLine(line: string): boolean {
  const text = line.trim().replace(PROMPT_PREFIX, '');
  if (!text) return false;
  const startsUse = /^use\s/i.test(text);
  if (!startsUse && firstBinary(text) !== 'msfconsole') return false;
  for (const m of text.matchAll(USE_MODULE)) if (!HANDLER.test(m[1])) return true;
  return false;
}

const METERPRETER_LABEL = /meterpreter/i;

/** Payload defs that are Meterpreter: logging one (copy and log) is Metasploit use on the host it was logged against. */
const METERPRETER_PAYLOAD_IDS = new Set([...MSFVENOM, ...SHELLS].filter((d) => d.meterpreter).map((d) => d.id));
const isMeterpreterPayload = (entry: LogEntry) => !!entry.payloadId && METERPRETER_PAYLOAD_IDS.has(entry.payloadId);

/**
 * Hosts a Metasploit log entry is attributed to, using auto-tick's attribution: hosts the block's lines name
 * (`set RHOSTS ...` counts), the shell host of a meterpreter block, else the entry's own host tags.
 * A logged Meterpreter payload (its `payloadId`) counts for the target hosts it was logged against (its host tags),
 * never for `ranOn`: an msfvenom entry ran on Kali. Empty when the entry has no Metasploit line and no such payload.
 */
export function metasploitHostIds(entry: LogEntry, engagement: Pick<Engagement, 'domain'>, hosts: Host[]): string[] {
  if (isMeterpreterPayload(entry)) return (entry.hostIds ?? []).filter((id) => hosts.some((h) => h.id === id));
  const domain = (engagement.domain ?? '').trim().toLowerCase();
  const ids = new Set<string>();
  let isMsf = false;
  for (const block of blocksOf(entry)) {
    const lines = (block.command ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const meterpreter = METERPRETER_LABEL.test(block.shell ?? '');
    if (!meterpreter && !lines.some(isMetasploitLine)) continue;
    isMsf = true;
    if (meterpreter) {
      // Lines inside a session (portfwd, autoroute) name other hosts without using Metasploit on them.
      const h = shellHost(block.shell, entry.ranOn ?? undefined, hosts, domain);
      if (h) ids.add(h.id);
      continue;
    }
    for (const line of lines) for (const h of namedHostsInLine(line, hosts, domain)) ids.add(h.id);
  }
  if (!isMsf) return [];
  if (ids.size === 0) for (const id of entry.hostIds ?? []) if (hosts.some((h) => h.id === id)) ids.add(id);
  return [...ids];
}

/** The warning for a Metasploit entry attributed to a host other than the locked one; null otherwise. */
export function metasploitWarning(entry: LogEntry, engagement: Pick<Engagement, 'kind' | 'msfHostId'>, hostIds: string[]): string | null {
  const locked = engagement.msfHostId;
  if (!locked || engagement.kind !== 'exam-sim') return null;
  const isMsf = isMeterpreterPayload(entry) || blocksOf(entry).some(
    (b) => METERPRETER_LABEL.test(b.shell ?? '') || (b.command ?? '').split(/\r?\n/).some(isMetasploitLine),
  );
  if (!isMsf || !hostIds.some((id) => id !== locked)) return null;
  return 'Metasploit is already locked to another host on this engagement. This entry uses it on a different host.';
}
