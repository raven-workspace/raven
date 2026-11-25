import type { QueryClient } from "@tanstack/react-query";
import { applicableGoals, daCoverGoals, derivedColumn, factTickGoals, type TickContext } from "../../engines/checklist";
import type { Change, Entity } from "../../engines/staleness";
import { api } from "../../lib/api";
import { storeChanged, type StoreChange } from "../../lib/storeChange";
import type { ChecklistItemInput, ChecklistState, EntryTicks } from "../../types/checklist";
import type { AccessGrant, CredAttempt } from "../../types/credentials";
import { RavenError } from "../../types/errors";
import type { LogEntry, OutputTick } from "../../types/log";
import { byOwnerOf, stateToInput } from "./state";
import { entryTicksOf, loadTickContext, ticksOfEntry } from "./ticks";

/**
 * The checklist sync (GLOSSARY.md): after a store change, the checklist and the board are brought up to date in one
 * order, from one read of the checklist: the entry's ticks (when an entry is involved), the fact ticks, the domain
 * admin cover, then each host's board column. Every checklist write is a conditional write in the store, so a status
 * set by hand in the meantime is never overwritten. What the sync writes it reports to the staleness map; it
 * refetches nothing itself. `syncChecklist` is the one way in.
 */

/** Entities whose writes can change the fact ticks, the cover or a board column, and need no step of their own. */
type FactEntity = Exclude<Entity, "logEntry" | "extraction">;

/** The store change a sync follows. */
export type SyncChange =
  /** An entry saved or edited: its ticks are re-derived. A capture save gives the ticks its output proved, before
   *  the extraction stores them; otherwise they are read from the entry's extraction. */
  | { entity: "logEntry"; id: string; change: "saved" | "updated"; entry: LogEntry; outputTicks?: OutputTick[] }
  /** An entry to delete: its ticks come off and the board follows, then the sync deletes the entry. If any of that
   *  fails, the entry stays and its ticks are put back. */
  | { entity: "logEntry"; id: string; change: "deleted" }
  /** An entry's extraction undone: the entry ticks nothing any more. */
  | { entity: "extraction"; id: string; change: "undone" }
  /** A full rebuild of every entry's ticks from the log (Tick from log). `id` is the engagement. */
  | { entity: "log"; id: string; change: "rebuilt" }
  /** The engagement opened: no write, but the store may hold what an older version never synced (an import, a log
   *  from before ticks). The first open in an app run of an engagement with a log and no checklist rebuilds from
   *  the log; every other sync waits for that rebuild. */
  | { entity: "engagement"; id: string; change: "opened" }
  /** A host, service, access grant, credential attempt, hand-set status or other write. */
  | { entity: FactEntity; id: string; change: Change };

export interface SyncArgs {
  engagementId: string;
  change: SyncChange;
  /** Where the sync reports its own writes (checklist rows, board columns). Left out, the caller's own store change
   *  must already cover them (a capture save's `logEntry saved`). */
  qc?: QueryClient;
}

export interface SyncResult {
  /** How many checklist items a rebuild from the log changed; 0 for any other change. */
  rebuilt: number;
}

export const CHECKLIST_FAILED = "Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist.";
export const BOARD_FAILED = "Saved the entry, but the board didn't update. Use Tick from log on the Engagement checklist.";

/**
 * A checklist sync failed. After a saved, edited or undone entry the message is `CHECKLIST_FAILED` or
 * `BOARD_FAILED`; after a delete it is why the delete failed, and says when the ticks could not be put back; after
 * anything else it is the store's own message. Its `code` is the cause's, so a locked vault still reaches the gate.
 * `reason` is what made it fail.
 */
export class ChecklistSyncError extends RavenError {
  readonly reason: unknown;
  constructor(message: string, reason: unknown) {
    super(RavenError.from(reason).code, message);
    this.name = "ChecklistSyncError";
    this.reason = reason;
  }
}

/** The store's conditional entry-tick write takes at most this many entries, and ticks, a call. */
const MAX_ENTRIES = 500;
const MAX_TICKS = 2000;

/** What the sync read once and every step shares. */
interface Inputs {
  ctx: TickContext;
  attempts: CredAttempt[];
  grants: AccessGrant[];
}

/** What the sync wrote, to report. */
interface Written {
  checklist: boolean;
  hosts: Set<string>;
}

/** Per engagement: the rebuild a first open runs, once per app run (see `SyncChange` "opened"). */
const firstOpens = new Map<string, Promise<boolean>>();

/** Test helper: forget which engagements were opened. */
export function resetFirstOpens(): void {
  firstOpens.clear();
}

/** Brings the checklist and the board up to date after `change`. Throws a `ChecklistSyncError`. */
export async function syncChecklist({ engagementId, change, qc }: SyncArgs): Promise<SyncResult> {
  if (change.entity === "engagement" && change.change === "opened") return opened(engagementId, qc);
  // No sync runs on the still-empty checklist before a first-open rebuild.
  await firstOpens.get(engagementId)?.catch(() => undefined);
  return run(engagementId, change, qc);
}

async function opened(engagementId: string, qc: QueryClient | undefined): Promise<SyncResult> {
  let first = firstOpens.get(engagementId);
  const mine = !first;
  if (!first) {
    first = (async () => {
      const [items, log] = await Promise.all([api.checklistList(engagementId), api.logList(engagementId)]);
      if (items.length > 0 || log.length === 0) return false;
      await run(engagementId, { entity: "log", id: engagementId, change: "rebuilt" }, qc);
      return true;
    })();
    const running = first;
    firstOpens.set(engagementId, running);
    // A failed first open lets the next open try again.
    running.catch(() => {
      if (firstOpens.get(engagementId) === running) firstOpens.delete(engagementId);
    });
  }
  let rebuilt: boolean;
  try {
    rebuilt = await first;
  } catch (e) {
    throw failure({ entity: "engagement", id: engagementId, change: "opened" }, "checklist", e);
  }
  return mine && rebuilt ? { rebuilt: 0 } : run(engagementId, { entity: "engagement", id: engagementId, change: "opened" }, qc);
}

/** The message a failed step gets, by what the sync followed. */
function failure(change: SyncChange, step: "checklist" | "board", reason: unknown): ChecklistSyncError {
  const entry = change.entity === "extraction" || (change.entity === "logEntry" && change.change !== "deleted");
  const message = entry ? (step === "board" ? BOARD_FAILED : CHECKLIST_FAILED) : RavenError.from(reason).message;
  return new ChecklistSyncError(message, reason);
}

async function run(engagementId: string, change: SyncChange, qc: QueryClient | undefined): Promise<SyncResult> {
  const written: Written = { checklist: false, hosts: new Set() };
  try {
    return await steps(engagementId, change, written);
  } finally {
    report(qc, engagementId, written);
  }
}

function report(qc: QueryClient | undefined, engagementId: string, written: Written): void {
  if (!qc) return;
  const changes: StoreChange[] = [...written.hosts].map((id) => ({ entity: "host", id, change: "updated" }));
  if (written.checklist) changes.push({ entity: "checklistItem", id: engagementId, change: "updated" });
  if (changes.length > 0) void storeChanged(qc, ...changes);
}

async function steps(engagementId: string, change: SyncChange, written: Written): Promise<SyncResult> {
  let inputs: Inputs;
  try {
    const [ctx, attempts, grants] = await Promise.all([
      loadTickContext(engagementId),
      api.credAttemptsList(engagementId),
      api.accessGrantsList(engagementId),
    ]);
    inputs = { ctx, attempts: attempts ?? [], grants: grants ?? [] };
  } catch (e) {
    throw failure(change, "checklist", e);
  }

  let state: Map<string, ChecklistState> | null = null;
  let undo: ChecklistItemInput[] = [];
  let rebuilt = 0;
  let failed: ChecklistSyncError | null = null;
  try {
    ({ state, undo, rebuilt } = await entryStep(engagementId, change, inputs.ctx, written));
    // A scan saved with an entry may have set services and OS; then an intake may have recorded the admin result.
    state = await factStep(engagementId, inputs, state, written);
    state = await coverStep(engagementId, inputs, state, written);
  } catch (e) {
    failed = failure(change, "checklist", e);
  }
  if (state) {
    try {
      await boardStep(inputs, state, written);
    } catch (e) {
      failed ??= failure(change, "board", e);
    }
  }

  if (change.entity === "logEntry" && change.change === "deleted") {
    if (!failed) {
      try {
        await api.logDelete(change.id);
        return { rebuilt };
      } catch (e) {
        failed = failure(change, "checklist", e);
      }
    }
    // Nothing to put back when the ticks never came off.
    if (state) await putBack(engagementId, inputs, undo, written, failed);
  }
  if (failed) throw failed;
  return { rebuilt };
}

/** A failed delete: the entry's rows as they were (completion times included), then facts, cover and board again. */
async function putBack(engagementId: string, inputs: Inputs, undo: ChecklistItemInput[], written: Written, failed: ChecklistSyncError): Promise<void> {
  try {
    let state = byOwnerOf(undo.length > 0 ? await api.checklistPut(engagementId, undo) : await api.checklistList(engagementId));
    if (undo.length > 0) written.checklist = true;
    state = await factStep(engagementId, inputs, state, written);
    state = await coverStep(engagementId, inputs, state, written);
    await boardStep(inputs, state, written);
  } catch (restore) {
    throw new ChecklistSyncError(`${failed.message}. The checklist lost this entry's ticks: use Tick from log on the Engagement checklist.`, restore);
  }
}

interface Ticked {
  state: Map<string, ChecklistState>;
  /** A delete: the rows holding the entry's evidence before, to put back if the delete fails. */
  undo: ChecklistItemInput[];
  rebuilt: number;
}

/** The entry's ticks through the store's conditional write; for any other change, the one read of the checklist. */
async function entryStep(engagementId: string, change: SyncChange, ctx: TickContext, written: Written): Promise<Ticked> {
  const write = async (entries: EntryTicks[]) => {
    if (entries.length === 0) return byOwnerOf(await api.checklistList(engagementId));
    let items = null;
    for (const batch of batches(entries)) {
      items = await api.checklistApplyEntryTicks(engagementId, batch);
      written.checklist = true;
    }
    return byOwnerOf(items!);
  };
  if (change.entity === "logEntry" && change.change !== "deleted") {
    const extraction = change.outputTicks ? null : await api.extractionGet(change.id);
    const output = change.outputTicks ?? extraction?.record.outputTicks ?? [];
    const ticks = ticksOfEntry(change.entry, ctx, output, extraction?.undoneAt != null);
    return { state: await write([entryTicksOf(change.id, Date.now(), ticks)]), undo: [], rebuilt: 0 };
  }
  if (change.entity === "extraction") {
    return { state: await write([entryTicksOf(change.id, Date.now(), [])]), undo: [], rebuilt: 0 };
  }
  if (change.entity === "logEntry") {
    const before = byOwnerOf(await api.checklistList(engagementId));
    const undo = [...before].flatMap(([ownerId, s]) =>
      Object.entries(s).filter(([, it]) => it.evidence?.some((e) => e.entryId === change.id)).map(([goalId, it]) => stateToInput(ownerId, goalId, it)),
    );
    return { state: await write([entryTicksOf(change.id, Date.now(), [])]), undo, rebuilt: 0 };
  }
  if (change.entity === "log") {
    const [items, log, extractions] = await Promise.all([api.checklistList(engagementId), api.logList(engagementId), api.extractionsList(engagementId)]);
    const before = byOwnerOf(items);
    const extractionOf = new Map((extractions ?? []).map((x) => [x.logEntryId, x]));
    // Oldest entry first; a goal the rebuild ticks was done when the entry was logged, not now.
    const entries = [...log]
      .sort((a, b) => a.at - b.at)
      .map((entry) => {
        const x = extractionOf.get(entry.id);
        return entryTicksOf(entry.id, entry.at, ticksOfEntry(entry, ctx, x?.record.outputTicks ?? [], x?.undoneAt != null));
      });
    // Evidence from entries no longer in the log comes off.
    const known = new Set(log.map((e) => e.id));
    const orphans = new Set(items.flatMap((it) => it.evidence.map((e) => e.entryId)).filter((id) => !known.has(id)));
    const state = await write([...entries, ...[...orphans].map((id) => entryTicksOf(id, 0, []))]);
    return { state, undo: [], rebuilt: changedCount(before, state) };
  }
  return { state: byOwnerOf(await api.checklistList(engagementId)), undo: [], rebuilt: 0 };
}

/** Entries in order, split so no call passes the store's limits. */
function batches(entries: EntryTicks[]): EntryTicks[][] {
  const out: EntryTicks[][] = [];
  let batch: EntryTicks[] = [];
  let ticks = 0;
  for (const e of entries) {
    if (batch.length > 0 && (batch.length === MAX_ENTRIES || ticks + e.ticks.length > MAX_TICKS)) {
      out.push(batch);
      batch = [];
      ticks = 0;
    }
    batch.push(e);
    ticks += e.ticks.length;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

/** How many (owner, goal) items differ between two reads of the checklist. */
function changedCount(before: Map<string, ChecklistState>, after: Map<string, ChecklistState>): number {
  let n = 0;
  for (const [ownerId, state] of after) {
    const old = before.get(ownerId) ?? {};
    for (const [goalId, s] of Object.entries(state)) {
      const was = stateToInput(ownerId, goalId, old[goalId] ?? { status: "todo" });
      if (JSON.stringify(stateToInput(ownerId, goalId, s)) !== JSON.stringify(was)) n++;
    }
  }
  return n;
}

/** "Every port identified" and "OS identified" from the hosts' own data (`factTickGoals`), as a conditional write. */
async function factStep(engagementId: string, { ctx }: Inputs, byOwner: Map<string, ChecklistState>, written: Written): Promise<Map<string, ChecklistState>> {
  const { done, revert } = factTickGoals({ engagement: ctx.engagement, hosts: ctx.hosts, servicesByHost: ctx.servicesByHost, byOwner });
  if (done.length === 0 && revert.length === 0) return byOwner;
  const items = await api.checklistApplyFacts(engagementId, done, revert);
  written.checklist = true;
  return byOwnerOf(items);
}

/** Domain admin on the DC covers privesc and post-exploitation on domain-joined hosts (`daCoverGoals`), as a
 *  conditional write. */
async function coverStep(engagementId: string, { ctx, attempts }: Inputs, byOwner: Map<string, ChecklistState>, written: Written): Promise<Map<string, ChecklistState>> {
  const { cover, revert } = daCoverGoals({ engagement: ctx.engagement, hosts: ctx.hosts, servicesByHost: ctx.servicesByHost, attempts, byOwner });
  if (cover.length === 0 && revert.length === 0) return byOwner;
  const items = await api.checklistApplyCover(engagementId, cover, revert);
  written.checklist = true;
  return byOwnerOf(items);
}

/**
 * Moves each host to the column its checklist and access grants imply, only when that differs from the column last
 * derived (a hand placement holds until then).
 *
 * While the engagement has no checklist rows at all (an engagement from before step 3 whose log has not been ticked
 * yet), a hand-placed host with no derived column is left alone: its first derived column must come from its real
 * checklist, so the store's seed (T6-R2) records that one rather than an empty-checklist "information-gathering".
 */
async function boardStep({ ctx, grants }: Inputs, states: Map<string, ChecklistState>, written: Written): Promise<void> {
  const { engagement, hosts, servicesByHost } = ctx;
  const noRows = [...states.values()].every((s) => Object.keys(s).length === 0);
  for (const [i, host] of hosts.entries()) {
    if (noRows && host.boardDerived == null && host.boardManual) continue;
    const applicable = applicableGoals(host, engagement, hosts, servicesByHost);
    const column = derivedColumn(host, states.get(host.id) ?? {}, applicable, grants);
    if (column === host.boardDerived) continue;
    await api.hostSyncBoard(host.id, column);
    // Remembered, so putting a failed delete back moves the card back too.
    hosts[i] = { ...host, boardDerived: column };
    written.hosts.add(host.id);
  }
}
