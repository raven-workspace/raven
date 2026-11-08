import {
  applicableGoals,
  daCoverGoals,
  derivedColumn,
  factTickGoals,
  metasploitHostIds,
  removeEntryTicks,
  replaceEntryTicks,
  ticksForEntry,
  type Tick,
  type TickContext,
} from "../../engines/checklist";
import { getLibrary } from "../../engines/library/store";
import { api } from "../../lib/api";
import type { ChecklistItemInput, ChecklistState } from "../../types/checklist";
import type { LogEntry, OutputTick } from "../../types/log";
import { byOwnerOf, servicesByHostOf, stateToInput } from "./state";

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
  return { engagement, hosts, servicesByHost: servicesByHostOf(services), library: getLibrary() };
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

/** Command ticks merged with output ticks, deduped by owner and goal; a command tick wins. */
function mergeTicks(commandTicks: Tick[], outputTicks: Tick[]): Tick[] {
  const seen = new Set(commandTicks.map((t) => `${t.ownerId}\u0000${t.goalId}`));
  const out = [...commandTicks];
  for (const t of outputTicks) {
    const key = `${t.ownerId}\u0000${t.goalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** An extraction's output ticks as checklist ticks of its entry. */
export function outputTicksOf(entryId: string, ticks: OutputTick[]): Tick[] {
  return ticks.map((t) => ({ ownerId: t.ownerId, goalId: t.goalId, commandId: `out:${t.parser}`, entryId }));
}

/**
 * An entry's ticks: its command ticks (`ticksForEntry`) and its output ticks (`commandId: 'out:<parser>'`). Without
 * `outputTicks` they are read from the entry's extraction record, so an edit keeps them. An entry whose extraction
 * was undone ticks nothing at all (R3).
 */
async function entryTicks(entry: LogEntry, ctx: TickContext, outputTicks?: Tick[]): Promise<Tick[]> {
  let output = outputTicks;
  if (!output) {
    const extraction = await api.extractionGet(entry.id);
    if (extraction?.undoneAt != null) return [];
    output = extraction ? outputTicksOf(entry.id, extraction.record.outputTicks ?? []) : [];
  }
  return mergeTicks(ticksForEntry(entry, ctx), output);
}

/**
 * Re-derives one log entry's ticks after it was created, edited (`entry`) or deleted (`entry` null). Every owner
 * that holds evidence from the entry, or gets a tick from it, runs `replaceEntryTicks` with its own ticks, so a tick
 * moves when the entry's hosts change and an undo restores the prior status. `outputTicks` are the ticks its output
 * proved, given on create before the extraction is stored. Writes only changed items, in one
 * `checklistPut`. Returns the rows that undo the write (empty when nothing changed) and the checklist after it.
 */
export async function writeEntryTicks(
  engagementId: string,
  entry: LogEntry | null,
  entryId: string,
  ctx: TickContext,
  outputTicks?: Tick[],
): Promise<{ undo: ChecklistItemInput[]; after: Map<string, ChecklistState> }> {
  const before = byOwnerOf(await api.checklistList(engagementId));
  const ticks = entry ? await entryTicks(entry, ctx, outputTicks) : [];
  const owners = new Set(ticks.map((t) => t.ownerId));
  for (const [ownerId, state] of before) if (hasEvidenceFrom(state, entryId)) owners.add(ownerId);

  const now = Date.now();
  const after = new Map(before);
  for (const ownerId of owners) after.set(ownerId, replaceEntryTicks(before.get(ownerId), entryId, ticksFor(ticks, ownerId), now));
  const { next, prev } = changedItems(before, after);
  if (next.length > 0) await write(engagementId, next);
  return { undo: prev, after };
}

/** `writeEntryTicks`, then the board sync. */
export async function syncEntryTicks(engagementId: string, entry: LogEntry | null, entryId: string, ctx: TickContext): Promise<void> {
  const { after } = await writeEntryTicks(engagementId, entry, entryId, ctx);
  await syncBoards(engagementId, ctx, after);
}

/** Re-reads the store and syncs every host's board column (after a service change alters applicability). */
export async function resyncBoards(engagementId: string): Promise<void> {
  await afterAutoTick(engagementId);
  const ctx = await loadTickContext(engagementId);
  const facts = await applyFacts(engagementId, ctx);
  const after = await applyDaCover(engagementId, ctx, facts);
  await syncBoards(engagementId, ctx, after);
}

/**
 * Ticks "every port identified" and "OS identified" from the hosts' own data (`factTickGoals`), through the store's
 * conditional write. Returns the checklist after it. `byOwner` is the current checklist; read from the store when left out.
 */
export async function applyFacts(engagementId: string, ctx: TickContext, byOwner?: Map<string, ChecklistState>): Promise<Map<string, ChecklistState>> {
  const before: Map<string, ChecklistState> = byOwner ?? byOwnerOf(await api.checklistList(engagementId));
  const { done, revert } = factTickGoals({ engagement: ctx.engagement, hosts: ctx.hosts, servicesByHost: ctx.servicesByHost, byOwner: before });
  if (done.length === 0 && revert.length === 0) return before;
  return byOwnerOf(await api.checklistApplyFacts(engagementId, done, revert));
}

/**
 * Domain admin on the DC covers privilege escalation and post-exploitation on domain-joined hosts (`daCoverGoals`). Reads the attempts and the
 * checklist from the store and sends the goals to the store's conditional write, which re-checks every row, so a status
 * set by hand in the meantime is never overwritten. Returns the checklist after it.
 * `byOwner` is the current checklist; read from the store when left out.
 */
export async function applyDaCover(engagementId: string, ctx: TickContext, byOwner?: Map<string, ChecklistState>): Promise<Map<string, ChecklistState>> {
  const [attempts, before] = await Promise.all([
    api.credAttemptsList(engagementId),
    byOwner ?? api.checklistList(engagementId).then(byOwnerOf),
  ]);
  const { cover, revert } = daCoverGoals({ engagement: ctx.engagement, hosts: ctx.hosts, servicesByHost: ctx.servicesByHost, attempts, byOwner: before });
  if (cover.length === 0 && revert.length === 0) return before;
  return byOwnerOf(await api.checklistApplyCover(engagementId, cover, revert));
}

/**
 * Moves each host to the column its checklist implies, only when that differs from the column last derived (a
 * hand placement holds until then). `byOwner` is the current checklist; read from the store when left out.
 *
 * While the engagement has no checklist rows at all (an engagement from before step 3 whose log has not been ticked
 * yet), a hand-placed host with no derived column is left alone: its first derived column must come from its real
 * checklist, so the store's seed (T6-R2) records that one rather than an empty-checklist "information-gathering".
 */
export async function syncBoards(engagementId: string, ctx: TickContext, byOwner?: Map<string, ChecklistState>): Promise<void> {
  const states = byOwner ?? byOwnerOf(await api.checklistList(engagementId));
  const { engagement, hosts, servicesByHost } = ctx;
  const noRows = [...states.values()].every((s) => Object.keys(s).length === 0);
  for (const host of hosts) {
    if (noRows && host.boardDerived == null && host.boardManual) continue;
    const applicable = applicableGoals(host, engagement, hosts, servicesByHost);
    const column = derivedColumn(host, states.get(host.id) ?? {}, applicable);
    if (column !== host.boardDerived) await api.hostSyncBoard(host.id, column);
  }
}

/**
 * Rebuilds every auto-tick from the whole log, oldest entry first: each entry's ticks are re-applied (a goal it
 * still ticks keeps its completion time, a new tick is stamped with the entry's time) and evidence from entries no longer in the log is removed.
 * Output ticks come from each entry's extraction; an undone extraction's entry ticks nothing. Manual statuses
 * and notes stay. Writes the changed items, then syncs the board.
 */
export async function tickFromLog(engagementId: string, ctx: TickContext): Promise<{ updated: number; message: string }> {
  const [items, log, extractions] = await Promise.all([
    api.checklistList(engagementId),
    api.logList(engagementId),
    api.extractionsList(engagementId),
  ]);
  const before = byOwnerOf(items);
  const after = new Map(before);
  const extractionOf = new Map((extractions ?? []).map((x) => [x.logEntryId, x]));
  const entries = [...log].sort((a, b) => a.at - b.at);
  for (const entry of entries) {
    const x = extractionOf.get(entry.id);
    const ticks = x?.undoneAt != null ? [] : mergeTicks(ticksForEntry(entry, ctx), outputTicksOf(entry.id, x?.record.outputTicks ?? []));
    const owners = new Set(ticks.map((t) => t.ownerId));
    for (const [ownerId, state] of after) if (hasEvidenceFrom(state, entry.id)) owners.add(ownerId);
    // A goal the rebuild ticks was done when the entry was logged, not now.
    for (const ownerId of owners) after.set(ownerId, replaceEntryTicks(after.get(ownerId), entry.id, ticksFor(ticks, ownerId), entry.at));
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
  // Same follow-ups as resyncBoards, so this recovery path restores fact ticks and DA cover too.
  const facts = await applyFacts(engagementId, ctx, after);
  const covered = await applyDaCover(engagementId, ctx, facts);
  await syncBoards(engagementId, ctx, covered);
  const n = next.length;
  return { updated: n, message: `Updated ${n} ${n === 1 ? "goal" : "goals"}` };
}

/** Per engagement: the automatic first tick from the log, once per app run (see `autoTickFromLog`). */
const autoTicks = new Map<string, Promise<boolean>>();

/**
 * F-R1: an engagement from before step 3 has a log but no checklist rows, so nothing it logged counts yet. When the
 * checklist is empty and the log is not, runs `tickFromLog` once. Runs at most once per engagement (concurrent
 * callers share the run); a failed run lets the next call try again. Resolves true when it ran the rebuild.
 */
export function autoTickFromLog(engagementId: string): Promise<boolean> {
  const running = autoTicks.get(engagementId);
  if (running) return running;
  const run = (async () => {
    const [items, log] = await Promise.all([api.checklistList(engagementId), api.logList(engagementId)]);
    if (items.length > 0 || log.length === 0) return false;
    await tickFromLog(engagementId, await loadTickContext(engagementId));
    return true;
  })();
  autoTicks.set(engagementId, run);
  run.catch(() => {
    if (autoTicks.get(engagementId) === run) autoTicks.delete(engagementId);
  });
  return run;
}

/** Waits for a running automatic tick, so no other board sync runs on the still-empty checklist before it. */
async function afterAutoTick(engagementId: string): Promise<void> {
  await autoTicks.get(engagementId)?.catch(() => undefined);
}

/** Test helper: forget which engagements were auto-ticked. */
export function resetAutoTicks(): void {
  autoTicks.clear();
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
export const BOARD_FAILED = "Saved the entry, but the board didn't update. Use Tick from log on the Engagement checklist.";

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
 * The follow-up of a saved, edited (`entry`) or deleted (`entry` null) log entry: its checklist ticks, the board,
 * then the exam-sim Metasploit lock. A failed step does not stop the lock; the first failure is thrown as a
 * `FollowUpError` (`CHECKLIST_FAILED`, `BOARD_FAILED` or `MSF_LOCK_FAILED`).
 */
export async function afterEntrySaved(engagementId: string, entry: LogEntry | null, entryId: string, outputTicks?: Tick[]): Promise<void> {
  await afterAutoTick(engagementId);
  let ctx: TickContext;
  try {
    ctx = await loadTickContext(engagementId);
  } catch (e) {
    throw new FollowUpError(CHECKLIST_FAILED, e);
  }
  let failure: FollowUpError | null = null;
  let after: Map<string, ChecklistState> | null = null;
  try {
    ({ after } = await writeEntryTicks(engagementId, entry, entryId, ctx, outputTicks));
    // A scan saved with this entry may have set services and OS; then an intake may have recorded the admin result.
    after = await applyFacts(engagementId, ctx, after);
    after = await applyDaCover(engagementId, ctx, after);
  } catch (e) {
    failure = new FollowUpError(CHECKLIST_FAILED, e);
  }
  if (after) {
    try {
      await syncBoards(engagementId, ctx, after);
    } catch (e) {
      failure = new FollowUpError(BOARD_FAILED, e);
    }
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
 * Deletes a log entry with its checklist evidence. The ticks come off and the board syncs first; if either fails,
 * the entry stays and the error is thrown as is. If the board sync or the delete fails after the ticks came off, the
 * prior checklist rows (completion times included) and the board are put back; if that also fails, the thrown
 * message says to use Tick from log.
 */
export async function deleteEntryWithTicks(engagementId: string, entryId: string): Promise<void> {
  await afterAutoTick(engagementId);
  const ctx = await loadTickContext(engagementId);
  const { undo, after: ticked } = await writeEntryTicks(engagementId, null, entryId, ctx);
  try {
    // Removing the entry's evidence can free an item the cover still wants, as when saving an entry.
    const after = await applyDaCover(engagementId, ctx, ticked);
    await syncBoards(engagementId, ctx, after);
    await api.logDelete(entryId);
  } catch (e) {
    try {
      if (undo.length > 0) await write(engagementId, undo);
      await resyncBoards(engagementId);
    } catch (restore) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new FollowUpError(`${detail}. The checklist lost this entry's ticks: use Tick from log on the Engagement checklist.`, restore);
    }
    throw e;
  }
}
