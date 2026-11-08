import type { LogEntry } from "../../types/log";
import { MSFVENOM } from "./msfvenom";
import { REVERSE_SHELLS } from "./reverseShells";

const FAILED_OUTPUT = /not recognized|invalid option|cannot find|Access is denied|command not found/i;

const outputOf = (e: LogEntry) => (e.content.kind === "command" ? e.content.blocks.map((b) => b.output).join("\n") : "");

/** Payloads whose newest non-pending outcome on this host was a failure (returned nothing or a "can't run here" error). A later success clears it. */
export function failedPayloadIds(entries: LogEntry[], hostId: string): string[] {
  const newest = new Map<string, { e: LogEntry; failed: boolean }>();
  for (const e of entries) {
    if (!e.payloadId || !e.hostIds.includes(hostId)) continue;
    const text = outputOf(e);
    const failed = e.returnedNothing || FAILED_OUTPUT.test(text);
    if (!failed && !text.trim()) continue; // pending: neither fails nor clears
    const prev = newest.get(e.payloadId);
    if (!prev || e.at > prev.e.at || (e.at === prev.e.at && e.createdAt >= prev.e.createdAt)) newest.set(e.payloadId, { e, failed });
  }
  return [...newest].filter(([, v]) => v.failed).map(([id]) => id);
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
