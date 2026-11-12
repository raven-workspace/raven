import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { evidenceIdsIn, type ReportNode, type SectionMeta } from "../../engines/report";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import type { ReportDoc, ReportSection } from "../../types/report";

/**
 * The report's autosave queue. It lives outside the Report view, so leaving the view never drops a write and a lock
 * can save what is queued before the backend locks (like field notes).
 *
 * - One write per section is queued: a newer change replaces the queued one.
 * - Writes for one section never overlap: while one is on its way, a newer one waits and goes out once it settles,
 *   so an older write can never land after a newer one.
 * - A failed write stays queued and is retried after 2 s, 5 s, 15 s, then every 30 s, until it lands.
 */

export const SAVE_DEBOUNCE_MS = 600;
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

type Write = { doc: ReportNode; meta: SectionMeta };

/** One session's queue. A lock swaps in a fresh one; writes already on their way finish from the old one. */
interface Session {
  qc: QueryClient | null;
  /** The newest unsaved write per section id. */
  pending: Map<string, Write>;
  /** Per section id, the run sending its writes one at a time. */
  runs: Map<string, Promise<void>>;
  /** Sections whose last write failed. */
  failed: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  retryStep: number;
}

const newSession = (): Session => ({ qc: null, pending: new Map(), runs: new Map(), failed: new Set(), retryStep: 0 });
let session = newSession();

/** Whether a failed write is still unsaved: the Report view shows a warning while it is. */
export const useReportSaveStore = create<{ unsaved: boolean }>()(() => ({ unsaved: false }));

/** Writes a section into every cached sections list that holds it. */
export function patchCachedSection(qc: QueryClient, id: string, patch: Partial<ReportSection>) {
  qc.setQueriesData<ReportSection[]>({ queryKey: ["reportSections"] }, (list) =>
    list?.some((s) => s.id === id) ? list.map((s) => (s.id === id ? { ...s, ...patch } : s)) : list,
  );
}

/** Drops removed-entry ids whose entry is on the page again (an undo), so the meta only lists entries really removed. */
export function pruneRemoved(doc: ReportNode, meta: SectionMeta): SectionMeta {
  if (!meta.removedEntryIds?.length) return meta;
  const onPage = evidenceIdsIn(doc);
  const kept = meta.removedEntryIds.filter((id) => !onPage.has(id));
  return kept.length === meta.removedEntryIds.length ? meta : { ...meta, removedEntryIds: kept };
}

function updateUnsaved(s: Session) {
  if (s !== session) return;
  const unsaved = [...s.failed].some((id) => s.pending.has(id));
  if (useReportSaveStore.getState().unsaved !== unsaved) useReportSaveStore.setState({ unsaved });
}

function scheduleRetry(s: Session) {
  if (s !== session || s.retryTimer) return;
  if (![...s.failed].some((id) => s.pending.has(id))) {
    s.retryStep = 0;
    return;
  }
  const delay = RETRY_DELAYS_MS[Math.min(s.retryStep, RETRY_DELAYS_MS.length - 1)];
  s.retryStep++;
  s.retryTimer = setTimeout(() => {
    s.retryTimer = undefined;
    void flushReports();
  }, delay);
}

/** Sends a section's newest write, then any newer one queued while it was on its way. Never rejects. */
async function sendRun(s: Session, id: string): Promise<void> {
  let last: Write | undefined;
  try {
    for (;;) {
      const w = s.pending.get(id);
      // Nothing queued, or only the write that just failed: it waits for the retry.
      if (!w || w === last) return;
      last = w;
      const meta = pruneRemoved(w.doc, w.meta);
      if (s === session && s.qc) patchCachedSection(s.qc, id, { doc: w.doc as ReportDoc, meta: meta as Record<string, unknown> });
      try {
        await api.reportSectionSave(id, w.doc as ReportDoc, meta as Record<string, unknown>);
        // A newer change queued meanwhile stays for its own write (the next turn of this loop).
        if (s.pending.get(id) === w) s.pending.delete(id);
        s.failed.delete(id);
      } catch (e) {
        s.failed.add(id);
        reportError(e);
      }
      updateUnsaved(s);
    }
  } finally {
    s.runs.delete(id);
    if (s.failed.size === 0) s.retryStep = 0;
    scheduleRetry(s);
  }
}

function run(s: Session, id: string): Promise<void> {
  const running = s.runs.get(id);
  if (running) return running;
  if (!s.pending.has(id)) return Promise.resolve();
  const p = sendRun(s, id);
  s.runs.set(id, p);
  return p;
}

/** Queues a section's page and meta and writes them 600 ms after the last change. */
export function queueReportSave(qc: QueryClient, id: string, doc: ReportNode, meta: SectionMeta) {
  const s = session;
  s.qc = qc;
  s.pending.set(id, { doc, meta });
  clearTimeout(s.timer);
  s.timer = setTimeout(() => void flushReports(), SAVE_DEBOUNCE_MS);
}

/**
 * Writes everything queued now and resolves once every section has settled (a write queued behind one on its way
 * included). Never rejects: a failed write stays queued for the retry.
 */
export function flushReports(): Promise<void> {
  const s = session;
  clearTimeout(s.timer);
  s.timer = undefined;
  const ids = new Set([...s.pending.keys(), ...s.runs.keys()]);
  return Promise.all([...ids].map((id) => run(s, id))).then(() => undefined);
}

/** True while any report write is queued or on its way. */
export function hasPendingReports(): boolean {
  return session.pending.size > 0 || session.runs.size > 0;
}

/**
 * On every lock: no report text stays queued. Writes already started (by the lock's flush) finish from the old
 * session; nothing from them reaches the cache or the warning.
 */
export function discardReports() {
  clearTimeout(session.timer);
  clearTimeout(session.retryTimer);
  session = newSession();
  useReportSaveStore.setState({ unsaved: false });
}
