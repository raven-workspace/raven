import type { LogEntry } from "../../types/log";
import type { ReportData } from "./types";

/** Log entries in time order: by time, then by creation, then by id. */
export const byTime = (a: LogEntry, b: LogEntry) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/**
 * An entry the report keeps to the operator: private, or behind a failed attempt logged with an operator-only reason
 * (or kept private). The evidence rail and the slash menu never offer one.
 */
export const keptFromReport = (data: Pick<ReportData, "attempts">, e: LogEntry) =>
  e.private || data.attempts.some((a) => a.logEntryId === e.id && (a.private || a.reasonKind === "operator"));

export const isFlag = (e: LogEntry | undefined) => e?.content.kind === "flag";

/** A host's name, its id when the host is gone; "" for none. */
export const hostName = (data: ReportData, id: string | null) => (id ? (data.hosts.find((h) => h.id === id)?.name ?? id) : "");

export type ProofReason = "goal" | "service" | "access" | "hop" | "flag" | "finding-step";

/** Linked from a failed attempt, or logged as returning nothing. */
export function isDeadEnd(entry: LogEntry, data: ReportData): boolean {
  return entry.returnedNothing || data.attempts.some((a) => a.logEntryId === entry.id);
}

/** An entry a draft may print beside a step it doesn't prove (a flag's companion, the first port scan): neither kept
 *  from the report nor a dead end. */
export const draftable = (data: ReportData, e: LogEntry) => !keptFromReport(data, e) && !isDeadEnd(e, data);

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
