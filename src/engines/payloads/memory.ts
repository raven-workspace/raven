import type { LogEntry } from "../../types/log";
import type { PayloadBuild } from "../../types/payloadBuild";

const FAILED_OUTPUT = /not recognized|invalid option|cannot find|Access is denied|command not found/i;

/** Payload ids that were merged into another: what was logged or built under the old id counts for the new one. */
const MERGED_IDS: Record<string, string> = { "msf-java-war-linux": "msf-java-war", "msf-java-war-windows": "msf-java-war" };
/** The current id for a stored payload id. */
export const currentPayloadId = (id: string) => MERGED_IDS[id] ?? id;

const outputOf = (e: LogEntry) => (e.content.kind === "command" ? e.content.blocks.map((b) => b.output).join("\n") : "");

/** Payloads whose newest non-pending outcome on this host was a failure (returned nothing or a "can't run here" error). A later success clears it. */
export function failedPayloadIds(entries: LogEntry[], hostId: string): string[] {
  const newest = new Map<string, { e: LogEntry; failed: boolean }>();
  for (const e of entries) {
    if (!e.payloadId || !e.hostIds.includes(hostId)) continue;
    const text = outputOf(e);
    const failed = e.returnedNothing || FAILED_OUTPUT.test(text);
    if (!failed && !text.trim()) continue; // pending: neither fails nor clears
    const id = currentPayloadId(e.payloadId);
    const prev = newest.get(id);
    if (!prev || e.at > prev.e.at || (e.at === prev.e.at && e.createdAt >= prev.e.createdAt)) newest.set(id, { e, failed });
  }
  return [...newest].filter(([, v]) => v.failed).map(([id]) => id);
}

/** Whether a baked payload built for this host used a different LHOST or LPORT than the current ones (compared trimmed). Null when unknown or unchanged. */
export function staleBuild(
  records: PayloadBuild[], hostId: string | null, payloadId: string, current: { LHOST: string; LPORT: string },
): { was: string; now: string } | null {
  if (!hostId) return null;
  // The newest record for this payload (old merged ids included).
  const r = records
    .filter((b) => b.hostId === hostId && currentPayloadId(b.payloadId) === payloadId)
    .reduce<PayloadBuild | null>((a, b) => (a && a.at >= b.at ? a : b), null);
  if (!r) return null;
  const [LHOST, LPORT, lhost, lport] = [current.LHOST, current.LPORT, r.lhost, r.lport].map((v) => v.trim());
  if (!LHOST || !LPORT || !lhost || !lport) return null;
  if (lhost === LHOST && lport === LPORT) return null;
  return { was: `${lhost}:${lport}`, now: `${LHOST}:${LPORT}` };
}
