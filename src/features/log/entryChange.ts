import type { QueryClient } from "@tanstack/react-query";
import { metasploitHostIds } from "../../engines/checklist";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { storeChanged, type StoreChange } from "../../lib/storeChange";
import { RavenError } from "../../types/errors";
import type { ExtractionSummary, LogEntry, OutputTick } from "../../types/log";
import { useSaveSummaryStore } from "../capture/useSaveSummaryStore";
import { CHECKLIST_FAILED, ChecklistSyncError, syncChecklist, type SyncChange } from "../checklist/sync";

/**
 * The entry change (GLOSSARY.md): every way a log entry changes (a capture save, an edit, a delete, an undo of what a
 * save filed) reports it here, once its own write is done, and this module runs what follows, always in this order:
 *
 * 1. the checklist sync, with the entry change as its store change;
 * 2. the exam-sim Metasploit lock;
 * 3. for a capture save, the extraction's summary and output ticks, stamped after the board sync (Undo compares
 *    against that time);
 * 4. the reporting: one store change to the staleness map, the save summary, and on a failure one `EntryChangeError`.
 *
 * Each step runs even when an earlier one failed. `entryChanged` is the one way in.
 */

/** What a capture save's store filing produced: the summary to show and the output ticks to store with it. */
export interface Filing {
  summary: ExtractionSummary;
  ticks: OutputTick[];
}

/** A step that failed, with its message when it comes first and its sentence when it follows another. */
export interface StepFailure {
  reason: unknown;
  message: string;
  also: string;
}

export type EntryChange =
  /** A capture save stored `entry`. `filing` is what the store filed from its output (null: nothing was), and
   *  `failures` the steps of the save itself that failed (reading the identity, filing). */
  | { change: "saved"; entry: LogEntry; filing: Filing | null; failures: StepFailure[] }
  /** An entry edited and stored. */
  | { change: "edited"; entry: LogEntry }
  /** An entry to delete: the checklist sync takes its ticks off, then deletes it (RAV-41). */
  | { change: "deleted"; id: string }
  /** What an entry's save filed was undone; the entry stays. */
  | { change: "undone"; id: string };

export interface EntryChangeArgs {
  qc: QueryClient;
  engagementId: string;
  change: EntryChange;
}

/** What the caller shows after the change. */
export interface EntryChanged {
  /** The summary of what a capture save filed, already on the save summary toast; null when nothing was filed. */
  summary: ExtractionSummary | null;
}

export const MSF_LOCK_FAILED = "Saved the entry, but the Metasploit lock didn't update.";
const CHECKLIST_ALSO = "The checklist didn't update either: use Tick from log on the Engagement checklist.";
export const EXTRACTION_FAILED = "Saved the entry, but Raven couldn't file what it found. Paste the output again to retry.";
export const EXTRACTION_ALSO = "Raven couldn't file what it found either: paste the output again to retry.";

/**
 * A step after an entry change failed. A saved, edited or undone entry stays stored (a partial save); a delete that
 * fails leaves the entry. The message is the first failure's, followed by a sentence for each one after it. Its `code`
 * is the first cause's, so a locked vault still reaches the gate.
 */
export class EntryChangeError extends RavenError {
  readonly entryId: string;
  /** What made the first step fail. */
  readonly reason: unknown;
  /** What made each failed step fail, in order; `reason` is the first. */
  readonly reasons: unknown[];
  /** The summary of the extraction a capture save stored despite the failure (it can be undone); null when none was. */
  readonly summary: ExtractionSummary | null;
  constructor(entryId: string, failures: StepFailure[], summary: ExtractionSummary | null) {
    const [first, ...rest] = failures;
    super(RavenError.from(first!.reason).code, rest.reduce((acc, f) => `${acc}${acc.endsWith(".") ? "" : "."} ${f.also}`, first!.message));
    this.name = "EntryChangeError";
    this.entryId = entryId;
    this.reason = first!.reason;
    this.reasons = failures.map((f) => f.reason);
    this.summary = summary;
  }
}

/** Runs what follows an entry change. Resolves to what to show; throws an `EntryChangeError` when a step failed. */
export async function entryChanged({ qc, engagementId, change }: EntryChangeArgs): Promise<EntryChanged> {
  const failures: StepFailure[] = change.change === "saved" ? [...change.failures] : [];
  const entryId = change.change === "saved" || change.change === "edited" ? change.entry.id : change.id;
  const filing = change.change === "saved" ? change.filing : null;
  await step(failures, () => syncChecklist({ engagementId, change: syncChangeOf(change) }));
  await step(failures, () => lockMetasploit(engagementId, change));
  if (filing) {
    try {
      await api.extractionFinish(entryId, filing.summary, filing.ticks);
    } catch (e) {
      failures.push({ reason: e, message: EXTRACTION_FAILED, also: EXTRACTION_ALSO });
    }
  }
  // Whatever failed, the change itself happened (a failed delete may have moved ticks and put them back). The sync's
  // writes and the lock's are part of this one store change in the staleness map, so nothing else is refetched.
  void storeChanged(qc, storeChangeOf(change));

  const summary = filing?.summary ?? null;
  // The extraction was stored all the same: its summary (and Undo) shows even after a partial save.
  if (change.change === "saved") useSaveSummaryStore.getState().show(entryId, summary);
  if (failures.length === 0) return { summary };
  // A `locked` rejection must reach the vault gate, as query and mutation errors do.
  for (const f of failures) reportError(f.reason);
  throw new EntryChangeError(entryId, failures, summary);
}

/** Runs one step, recording its failure. */
async function step(failures: StepFailure[], run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (e instanceof ChecklistSyncError || e instanceof MsfLockError) {
      failures.push({ reason: e.reason, message: e.message, also: e.message !== CHECKLIST_FAILED ? e.message : CHECKLIST_ALSO });
    } else {
      failures.push({ reason: e, message: `Saved, but services didn't update: ${RavenError.from(e).message}`, also: CHECKLIST_ALSO });
    }
  }
}

function syncChangeOf(change: EntryChange): SyncChange {
  switch (change.change) {
    case "saved":
      return { entity: "logEntry", id: change.entry.id, change: "saved", entry: change.entry, outputTicks: change.filing?.ticks ?? [] };
    case "edited":
      return { entity: "logEntry", id: change.entry.id, change: "updated", entry: change.entry };
    case "deleted":
      return { entity: "logEntry", id: change.id, change: "deleted" };
    case "undone":
      return { entity: "extraction", id: change.id, change: "undone" };
  }
}

function storeChangeOf(change: EntryChange): StoreChange {
  switch (change.change) {
    case "saved":
      return { entity: "logEntry", id: change.entry.id, change: "saved" };
    case "edited":
      return { entity: "logEntry", id: change.entry.id, change: "updated" };
    case "deleted":
      return { entity: "logEntry", id: change.id, change: "deleted" };
    case "undone":
      return { entity: "extraction", id: change.id, change: "undone" };
  }
}

/** The exam-sim Metasploit lock failed. `reason` is what made it fail. */
export class MsfLockError extends RavenError {
  readonly reason: unknown;
  constructor(reason: unknown) {
    super(RavenError.from(reason).code, MSF_LOCK_FAILED);
    this.name = "MsfLockError";
    this.reason = reason;
  }
}

/**
 * Exam sims: the first entry that uses a Metasploit module on exactly one host locks Metasploit to that host.
 * Does nothing once a lock exists, outside exam sims, or when the entry names no single host. A deleted entry is gone,
 * so it locks nothing (and a lock it set stays). An undo leaves the entry, so its lock runs again: what the undo took
 * away (a host the save made) may have cleared the lock, and the entry still used Metasploit where it still points.
 */
async function lockMetasploit(engagementId: string, change: EntryChange): Promise<void> {
  if (change.change === "deleted") return;
  try {
    const [engagement, hosts, entry] = await Promise.all([
      api.engagementGet(engagementId),
      api.hostsList(engagementId),
      change.change === "undone" ? api.logList(engagementId).then((log) => log.find((e) => e.id === change.id) ?? null) : change.entry,
    ]);
    if (!entry || engagement.kind !== "exam-sim" || engagement.msfHostId) return;
    const ids = metasploitHostIds(entry, engagement, hosts);
    if (ids.length === 1) await api.engagementSetMsfHost(engagement.id, ids[0]!);
  } catch (e) {
    throw new MsfLockError(e);
  }
}
