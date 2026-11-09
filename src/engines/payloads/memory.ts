import type { LogEntry } from "../../types/log";
import type { PayloadBuild } from "../../types/payloadBuild";

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

/** Whether a baked payload built for this host used a different LHOST or LPORT than the current ones. Null when unknown or unchanged. */
export function staleBuild(
  records: PayloadBuild[], hostId: string | null, payloadId: string, current: { LHOST: string; LPORT: string },
): { was: string; now: string } | null {
  if (!hostId) return null;
  const r = records.find((b) => b.hostId === hostId && b.payloadId === payloadId);
  if (!r) return null;
  const { LHOST, LPORT } = current;
  if (!LHOST.trim() || !LPORT.trim() || !r.lhost.trim() || !r.lport.trim()) return null;
  if (r.lhost === LHOST && r.lport === LPORT) return null;
  return { was: `${r.lhost}:${r.lport}`, now: `${LHOST}:${LPORT}` };
}
