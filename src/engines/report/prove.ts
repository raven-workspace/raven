import type { LogEntry } from "../../types/log";
import type { ReportData } from "./types";

export type ProofReason = "goal" | "service" | "access" | "hop" | "flag" | "finding-step";

/** Linked from a failed attempt, or logged as returning nothing. */
export function isDeadEnd(entry: LogEntry, data: ReportData): boolean {
  return entry.returnedNothing || data.attempts.some((a) => a.logEntryId === entry.id);
}

/** The host's non-private, non-dead-end entries that proved something, with every reason they count. */
export function provingEntries(data: ReportData, hostId: string): Map<string, ProofReason[]> {
  const reasons = new Map<string, ProofReason[]>();
  const add = (id: string | null, reason: ProofReason) => {
    if (id == null) return;
    const list = reasons.get(id) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(id, list);
  };

  const owners = new Set([hostId, data.engagement.id]);
  for (const item of data.checklist) {
    if (owners.has(item.ownerId)) for (const ev of item.evidence) add(ev.entryId, "goal");
  }
  for (const s of data.services) if (s.hostId === hostId) add(s.confirmedEntryId, "service");
  for (const g of data.grants) if (g.hostId === hostId) add(g.logEntryId, "access");
  for (const h of data.hops) if (h.toHostId === hostId) add(h.logEntryId, "hop");
  for (const e of data.log) if (e.kind === "flag") add(e.id, "flag");
  for (const f of data.findings) {
    if (f.hostIds.includes(hostId)) for (const id of f.stepEntryIds) add(id, "finding-step");
  }

  const out = new Map<string, ProofReason[]>();
  for (const e of data.log) {
    const r = reasons.get(e.id);
    if (r && !e.private && e.hostIds.includes(hostId) && !isDeadEnd(e, data)) out.set(e.id, r);
  }
  return out;
}

/** The reasons that place an entry on the page (§10.2): goal evidence and service confirmation alone stay in the rail. */
const PLACING: ReadonlySet<ProofReason> = new Set<ProofReason>(["access", "hop", "flag", "finding-step"]);

/** The host's entries the draft places: proving entries (`provingEntries`) with an access, hop, flag or finding-step
 *  reason. */
export function placingEntries(data: ReportData, hostId: string): Set<string> {
  const out = new Set<string>();
  for (const [id, reasons] of provingEntries(data, hostId)) if (reasons.some((r) => PLACING.has(r))) out.add(id);
  return out;
}
