import type { LogEntry } from "../../types/log";
import { MSFVENOM } from "./msfvenom";
import { REVERSE_SHELLS } from "./reverseShells";

const FAILED_OUTPUT = /not recognized|invalid option|cannot find|Access is denied|command not found/i;

const outputOf = (e: LogEntry) => (e.content.kind === "command" ? e.content.blocks.map((b) => b.output).join("\n") : "");

/** Payloads logged on this host whose run returned nothing or printed a "can't run here" error. */
export function failedPayloadIds(entries: LogEntry[], hostId: string): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    if (!e.payloadId || !e.hostIds.includes(hostId)) continue;
    if (e.returnedNothing || FAILED_OUTPUT.test(outputOf(e))) out.add(e.payloadId);
  }
  return [...out];
}

const BAKED = new Set([...REVERSE_SHELLS, ...MSFVENOM].filter((d) => d.bakesIp).map((d) => d.id));

/** Baked-IP payloads (served scripts, exes) whose newest logged copy used a different LHOST or LPORT than now. */
export function staleBaked(
  entries: LogEntry[], current: { LHOST: string; LPORT: string },
): { payloadId: string; at: number; was: string }[] {
  const newest = new Map<string, LogEntry>();
  for (const e of entries) {
    if (!e.payloadId || !BAKED.has(e.payloadId) || !e.payloadValues) continue;
    const prev = newest.get(e.payloadId);
    if (!prev || e.at > prev.at) newest.set(e.payloadId, e);
  }
  const out: { payloadId: string; at: number; was: string }[] = [];
  for (const [payloadId, e] of newest) {
    const { LHOST = "", LPORT = "" } = e.payloadValues!;
    if (LHOST !== current.LHOST || LPORT !== current.LPORT) out.push({ payloadId, at: e.at, was: `${LHOST}:${LPORT}` });
  }
  return out;
}
