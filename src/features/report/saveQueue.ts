import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { stillRemoved, type ReportNode, type SectionMeta } from "../../engines/report";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { RavenError } from "../../types/errors";
import type { ReportSection } from "../../types/report";

/**
 * The report's autosave queue. It lives outside the Report view, so leaving the view never drops a write and a lock
 * can save what is queued before the backend locks (like field notes).
 *
 * - One write per section is queued: a newer change replaces the queued one.
 * - Writes for one section never overlap: while one is on its way, a newer one waits and goes out once it settles,
 *   so an older write can never land after a newer one.
 * - A failed write stays queued and is retried after 2 s, 5 s, 15 s, then every 30 s, until it lands.
 * - A write the backend refuses for good (the page is too big, the section is gone) stays queued but isn't retried:
 *   the view says why, and the owner's next change to that page is sent as usual.
 * - Report details writes (`trackReportWrite`) are awaited by a flush too, so a lock saves them first.
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
  /** Sections whose last write the backend refused for good, with what to tell the owner: no retry until they change it. */
  refused: Map<string, string>;
  /** Report details writes on their way. */
  writes: Set<Promise<unknown>>;
  timer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  retryStep: number;
}

const newSession = (): Session => ({
  qc: null,
  pending: new Map(),
  runs: new Map(),
  failed: new Set(),
  refused: new Map(),
  writes: new Set(),
  retryStep: 0,
});
let session = newSession();

/** Whether a failed write is still unsaved: the Report view shows a warning while it is, and why when it is refused for
 *  good (`refused`). */
export const useReportSaveStore = create<{ unsaved: boolean; refused: { sectionId: string; message: string } | null }>()(() => ({
  unsaved: false,
  refused: null,
}));

/** What the owner is told when the backend refuses a page for good; null when a retry may land. A page refused for
 *  size whose archive of earlier versions (`meta.originals`) is at least half of what was sent says that is the bulk,
 *  not the owner's text. */
export function refusalOf(e: unknown, write?: Write): string | null {
  const err = RavenError.from(e);
  if (err.code === "validation") {
    if (!/8 MiB/.test(err.message)) return `This page can't be saved: ${err.message}. Change it to save again.`;
    const archive = write?.meta.originals ? JSON.stringify(write.meta.originals).length : 0;
    const total = write ? JSON.stringify(write.doc).length + JSON.stringify(write.meta).length : 0;
    return archive > 0 && archive * 2 >= total
      ? "This page can't be saved: with the earlier versions of it Raven keeps, it is over 8 MiB. Most of that is those kept versions, not your text."
      : "This page is over 8 MiB and can't be saved. Cut some text.";
  }
  if (err.code === "not_found") return "This page no longer exists, so it can't be saved. Copy what you need from it, then reopen the report.";
  return null;
}

/** Writes a section into every cached sections list that holds it. */
export function patchCachedSection(qc: QueryClient, id: string, patch: Partial<ReportSection>) {
  qc.setQueriesData<ReportSection[]>({ queryKey: ["reportSections"] }, (list) =>
    list?.some((s) => s.id === id) ? list.map((s) => (s.id === id ? { ...s, ...patch } : s)) : list,
  );
}

/** Drops removed-entry ids whose entry is on the page again (an undo), so the meta only lists entries really removed. */
export function pruneRemoved(doc: ReportNode, meta: SectionMeta): SectionMeta {
  if (!meta.removedEntryIds?.length) return meta;
  const kept = stillRemoved(meta.removedEntryIds, doc);
  return kept.length === meta.removedEntryIds.length ? meta : { ...meta, removedEntryIds: kept };
}

function updateUnsaved(s: Session) {
  if (s !== session) return;
  // `unsaved` is the transient kind (a retry may land); a refused page has its own message.
  const unsaved = [...s.failed].some((id) => s.pending.has(id) && !s.refused.has(id));
  const hit = [...s.refused].find(([id]) => s.pending.has(id));
  const refused = hit ? { sectionId: hit[0], message: hit[1] } : null;
  const st = useReportSaveStore.getState();
  if (st.unsaved !== unsaved || st.refused?.sectionId !== refused?.sectionId || st.refused?.message !== refused?.message)
    useReportSaveStore.setState({ unsaved, refused });
}

/** Failed writes a retry may still land. */
const retryable = (s: Session) => [...s.failed].some((id) => s.pending.has(id) && !s.refused.has(id));

function scheduleRetry(s: Session) {
  if (s !== session || s.retryTimer) return;
  if (!retryable(s)) {
    s.retryStep = 0;
    return;
  }
  const delay = RETRY_DELAYS_MS[Math.min(s.retryStep, RETRY_DELAYS_MS.length - 1)];
  s.retryStep++;
  s.retryTimer = setTimeout(() => {
    s.retryTimer = undefined;
    void flush(true);
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
      if (s === session && s.qc) patchCachedSection(s.qc, id, { doc: w.doc, meta: meta as Record<string, unknown> });
      try {
        await api.reportSectionSave(id, w.doc, meta as Record<string, unknown>);
        // A newer change queued meanwhile stays for its own write (the next turn of this loop).
        if (s.pending.get(id) === w) s.pending.delete(id);
        s.failed.delete(id);
        s.refused.delete(id);
      } catch (e) {
        s.failed.add(id);
        const refused = refusalOf(e, { doc: w.doc, meta });
        if (refused) s.refused.set(id, refused);
        else s.refused.delete(id);
        reportError(e);
      }
      updateUnsaved(s);
    }
  } finally {
    s.runs.delete(id);
    // The backoff starts again once nothing a retry could land is failing (refused pages wait for a change).
    if (!retryable(s)) s.retryStep = 0;
    scheduleRetry(s);
  }
}

function run(s: Session, id: string, skipRefused: boolean): Promise<void> {
  const running = s.runs.get(id);
  if (running) return running;
  if (!s.pending.has(id)) return Promise.resolve();
  // A refused write waits for the owner's next change; a flush (a lock, leaving the page) still tries it once more.
  if (skipRefused && s.refused.has(id)) return Promise.resolve();
  const p = sendRun(s, id);
  s.runs.set(id, p);
  return p;
}

/** Queues a section's page and meta and writes them 600 ms after the last change. */
export function queueReportSave(qc: QueryClient, id: string, doc: ReportNode, meta: SectionMeta) {
  const s = session;
  s.qc = qc;
  s.pending.set(id, { doc, meta });
  // A change to a refused page is the owner's fix: it is sent as usual.
  if (s.refused.delete(id)) updateUnsaved(s);
  clearTimeout(s.timer);
  s.timer = setTimeout(() => void flush(true), SAVE_DEBOUNCE_MS);
}

/**
 * Writes everything queued now and resolves once every section has settled (a write queued behind one on its way
 * included). Never rejects: a failed write stays queued for the retry.
 */
export function flushReports(): Promise<void> {
  return flush(false);
}

/** The autosave and the retry skip refused pages; an explicit flush sends them and waits for details writes too. */
function flush(skipRefused: boolean): Promise<void> {
  const s = session;
  clearTimeout(s.timer);
  s.timer = undefined;
  const ids = new Set([...s.pending.keys(), ...s.runs.keys()]);
  const sends = [...ids].map((id) => run(s, id, skipRefused));
  return Promise.all(skipRefused ? sends : [...sends, ...s.writes]).then(() => undefined);
}

/**
 * A report details write on its way (the details chain): a flush, and so a lock, waits for it. Never rejects the
 * flush: pass a promise that settles either way.
 */
export function trackReportWrite(p: Promise<unknown>) {
  const s = session;
  const settled = p.then(
    () => undefined,
    () => undefined,
  );
  s.writes.add(settled);
  void settled.then(() => s.writes.delete(settled));
}

/**
 * Forgets a section's queued, failed or refused write: its page was deleted, so no retry, flush or lock may send it
 * again (it would only come back `not_found` and leave a lasting warning). A write already on its way still settles,
 * but nothing queued follows it.
 */
export function forgetReportSave(id: string) {
  const s = session;
  s.pending.delete(id);
  s.failed.delete(id);
  s.refused.delete(id);
  s.runs.delete(id);
  updateUnsaved(s);
  if (!retryable(s)) {
    clearTimeout(s.retryTimer);
    s.retryTimer = undefined;
    s.retryStep = 0;
  }
}

/** True while a write of this section is queued (unsent, or failed and waiting for its retry) or on its way. */
export function isReportSaveQueued(id: string): boolean {
  return session.pending.has(id) || session.runs.has(id);
}

/** Resolves once this section's write on its way (if any) has settled. Never rejects. */
export function settleReportSave(id: string): Promise<void> {
  return session.runs.get(id) ?? Promise.resolve();
}

/** True while any report write is queued or on its way. */
export function hasPendingReports(): boolean {
  return session.pending.size > 0 || session.runs.size > 0 || session.writes.size > 0;
}

/**
 * On every lock: no report text stays queued. Writes already started (by the lock's flush) finish from the old
 * session; nothing from them reaches the cache or the warning.
 */
export function discardReports() {
  clearTimeout(session.timer);
  clearTimeout(session.retryTimer);
  session = newSession();
  useReportSaveStore.setState({ unsaved: false, refused: null });
}
