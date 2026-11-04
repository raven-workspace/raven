import {
  applicableGoals,
  derivedColumn,
  metasploitHostIds,
  removeEntryTicks,
  replaceEntryTicks,
  ticksForEntry,
  type Tick,
  type TickContext,
} from "../../engines/checklist";
import { BUILTIN_LIBRARY } from "../../engines/library/data";
import { api } from "../../lib/api";
import type { ChecklistItemInput, ChecklistState } from "../../types/checklist";
import type { LogEntry } from "../../types/log";
import { byOwnerOf, servicesByHostOf, stateToInput } from "./queries";

/** checklist_put accepts at most this many items per call. */
const PUT_LIMIT = 500;

export const CHECKLIST_FAILED = "Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist.";

/** Reads the engagement, its hosts and services from the store, so ticks see what was just saved. */
export async function loadTickContext(engagementId: string): Promise<TickContext> {
  const [engagement, hosts, services] = await Promise.all([
    api.engagementGet(engagementId),
    api.hostsList(engagementId),
    api.servicesListEngagement(engagementId),
  ]);
  return { engagement, hosts, servicesByHost: servicesByHostOf(services), library: BUILTIN_LIBRARY };
}

const hasEvidenceFrom = (state: ChecklistState | undefined, entryId: string) =>
  !!state && Object.values(state).some((s) => s.evidence?.some((e) => e.entryId === entryId));

const ticksFor = (ticks: Tick[], ownerId: string) => ticks.filter((t) => t.ownerId === ownerId);

/**
 * The (owner, goal) items whose state differs between `before` and `after`, as full upsert rows (`next`), with the
 * rows that undo them (`prev`).
 */
function changedItems(
  before: Map<string, ChecklistState>,
  after: Map<string, ChecklistState>,
): { next: ChecklistItemInput[]; prev: ChecklistItemInput[] } {
  const next: ChecklistItemInput[] = [];
  const prev: ChecklistItemInput[] = [];
  for (const [ownerId, state] of after) {
    const old = before.get(ownerId) ?? {};
    if (state === old) continue;
    for (const [goalId, s] of Object.entries(state)) {
      const input = stateToInput(ownerId, goalId, s);
      const undo = stateToInput(ownerId, goalId, old[goalId] ?? { status: "todo" });
      if (JSON.stringify(input) === JSON.stringify(undo)) continue;
      next.push(input);
      prev.push(undo);
    }
  }
  return { next, prev };
}

async function write(engagementId: string, items: ChecklistItemInput[]): Promise<void> {
  // One atomic batch in practice; only a whole-log rebuild can pass the per-call limit.
  for (let i = 0; i < items.length; i += PUT_LIMIT) await api.checklistPut(engagementId, items.slice(i, i + PUT_LIMIT));
}

/**
 * Re-derives one log entry's ticks after it was created, edited (`entry`) or deleted (`entry` null). Every owner
 * that holds evidence from the entry, or gets a tick from it, runs `replaceEntryTicks` with its own ticks, so a tick
 * moves when the entry's hosts change and an undo restores the prior status. Writes only changed items, in one
 * `checklistPut`, then syncs the board. Returns the rows that undo the write (empty when nothing changed).
 */
export async function syncEntryTicks(
  engagementId: string,
  entry: LogEntry | null,
  entryId: string,
  ctx: TickContext,
): Promise<ChecklistItemInput[]> {
  const before = byOwnerOf(await api.checklistList(engagementId));
  const ticks = entry ? ticksForEntry(entry, ctx) : [];
  const owners = new Set(ticks.map((t) => t.ownerId));
  for (const [ownerId, state] of before) if (hasEvidenceFrom(state, entryId)) owners.add(ownerId);

  const now = Date.now();
  const after = new Map(before);
  for (const ownerId of owners) after.set(ownerId, replaceEntryTicks(before.get(ownerId), entryId, ticksFor(ticks, ownerId), now));
  const { next, prev } = changedItems(before, after);
  if (next.length > 0) await write(engagementId, next);
  await syncBoards(engagementId, ctx, after);
  return prev;
}

/**
 * Moves each host to the column its checklist implies, only when that differs from the column last derived (a
 * hand placement holds until then). `byOwner` is the current checklist; read from the store when left out.
 */
export async function syncBoards(engagementId: string, ctx: TickContext, byOwner?: Map<string, ChecklistState>): Promise<void> {
  const states = byOwner ?? byOwnerOf(await api.checklistList(engagementId));
  const { engagement, hosts, servicesByHost } = ctx;
  for (const host of hosts) {
    const applicable = applicableGoals(host, engagement, hosts, servicesByHost);
    const column = derivedColumn(host, states.get(host.id) ?? {}, applicable);
    if (column !== host.boardDerived) await api.hostSyncBoard(host.id, column);
  }
}

/**
 * Rebuilds every auto-tick from the whole log, oldest entry first: each entry's ticks are re-applied (a goal it
 * still ticks keeps its completion time) and evidence from entries no longer in the log is removed. Manual statuses
 * and notes stay. Writes the changed items, then syncs the board.
 */
export async function tickFromLog(engagementId: string, ctx: TickContext): Promise<{ updated: number; message: string }> {
  const [items, log] = await Promise.all([api.checklistList(engagementId), api.logList(engagementId)]);
  const before = byOwnerOf(items);
  const after = new Map(before);
  const now = Date.now();
  const entries = [...log].sort((a, b) => a.at - b.at);
  for (const entry of entries) {
    const ticks = ticksForEntry(entry, ctx);
    const owners = new Set(ticks.map((t) => t.ownerId));
    for (const [ownerId, state] of after) if (hasEvidenceFrom(state, entry.id)) owners.add(ownerId);
    for (const ownerId of owners) after.set(ownerId, replaceEntryTicks(after.get(ownerId), entry.id, ticksFor(ticks, ownerId), now));
  }
  const known = new Set(log.map((e) => e.id));
  for (const [ownerId, state] of after) {
    const orphans = new Set(Object.values(state).flatMap((s) => (s.evidence ?? []).map((e) => e.entryId)).filter((id) => !known.has(id)));
    let next = state;
    for (const id of orphans) next = removeEntryTicks(next, id);
    after.set(ownerId, next);
  }
  const { next } = changedItems(before, after);
  if (next.length > 0) await write(engagementId, next);
  await syncBoards(engagementId, ctx, after);
  const n = next.length;
  return { updated: n, message: `Updated ${n} ${n === 1 ? "goal" : "goals"}` };
}

/**
 * Exam sims: the first entry that uses a Metasploit module on exactly one host locks Metasploit to that host.
 * Does nothing once a lock exists, outside exam sims, or when the entry names no single host.
 */
export async function lockMetasploit(entry: LogEntry, ctx: TickContext): Promise<void> {
  const { engagement, hosts } = ctx;
  if (engagement.kind !== "exam-sim" || engagement.msfHostId) return;
  const ids = metasploitHostIds(entry, engagement, hosts);
  if (ids.length === 1) await api.engagementSetMsfHost(engagement.id, ids[0]!);
}

export const MSF_LOCK_FAILED = "Saved the entry, but the Metasploit lock didn't update.";

/** A saved log entry's follow-up (checklist or Metasploit lock) failed. `reason` is what made it fail. */
export class FollowUpError extends Error {
  readonly reason: unknown;
  constructor(message: string, reason: unknown) {
    super(message);
    this.name = "FollowUpError";
    this.reason = reason;
  }
}

/**
 * The follow-up of a saved, edited (`entry`) or deleted (`entry` null) log entry: its checklist ticks and board,
 * then the exam-sim Metasploit lock. A failed step does not stop the other; the first failure is thrown as a
 * `FollowUpError` (`CHECKLIST_FAILED` or `MSF_LOCK_FAILED`).
 */
export async function afterEntrySaved(engagementId: string, entry: LogEntry | null, entryId: string): Promise<void> {
  let ctx: TickContext;
  try {
    ctx = await loadTickContext(engagementId);
  } catch (e) {
    throw new FollowUpError(CHECKLIST_FAILED, e);
  }
  let failure: FollowUpError | null = null;
  try {
    await syncEntryTicks(engagementId, entry, entryId, ctx);
  } catch (e) {
    failure = new FollowUpError(CHECKLIST_FAILED, e);
  }
  if (entry) {
    try {
      await lockMetasploit(entry, ctx);
    } catch (e) {
      failure ??= new FollowUpError(MSF_LOCK_FAILED, e);
    }
  }
  if (failure) throw failure;
}

/**
 * Deletes a log entry with its checklist evidence. The ticks come off first, so a checklist failure leaves the
 * entry in place (the error is thrown as is). If the delete then fails, the prior checklist rows and board are
 * put back exactly; if that also fails, the thrown message says to use Tick from log.
 */
export async function deleteEntryWithTicks(engagementId: string, entryId: string): Promise<void> {
  const ctx = await loadTickContext(engagementId);
  const undo = await syncEntryTicks(engagementId, null, entryId, ctx);
  try {
    await api.logDelete(entryId);
  } catch (e) {
    try {
      if (undo.length > 0) await write(engagementId, undo);
      await syncBoards(engagementId, await loadTickContext(engagementId));
    } catch (restore) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new FollowUpError(`${detail}. The checklist lost this entry's ticks: use Tick from log on the Engagement checklist.`, restore);
    }
    throw e;
  }
}
