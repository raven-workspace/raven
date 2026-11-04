import { openThreads } from "../../engines/notes/threads";
import type { Note } from "../../types/notes";
import { noteKey, useNotesStore, type PendingNote } from "./useNotesStore";
import { useNotes } from "./queries";

export interface ThreadCounts {
  /** Open threads per host id (hosts with none are absent). */
  byHost: Map<string, number>;
  /** Open threads in every note of the engagement, the engagement note included. */
  total: number;
}

const EMPTY: ThreadCounts = { byHost: new Map(), total: 0 };
const cache = new Map<string, { notes: Note[] | undefined; pending: Record<string, PendingNote>; counts: ThreadCounts }>();
/** Per note key: the last body parsed and its count, so a keystroke re-parses only the note being typed in. */
const parsed = new Map<string, { body: string; n: number }>();

/** On every lock (via `discardNotes`): the caches hold note bodies, which never stay in memory once locked. */
export function clearThreadCounts(): void {
  cache.clear();
  parsed.clear();
}

/** Test helper: every note body the caches hold. */
export function threadCountsMemory(): string[] {
  const out = [...parsed.values()].map((p) => p.body);
  for (const { notes, pending } of cache.values()) {
    for (const n of notes ?? []) out.push(n.body);
    for (const p of Object.values(pending)) out.push(p.body);
  }
  return out;
}

function countOf(key: string, body: string): number {
  const hit = parsed.get(key);
  if (hit && hit.body === body) return hit.n;
  const n = openThreads(body).length;
  parsed.set(key, { body, n });
  return n;
}

/** One computation per engagement and input change, shared by every consumer on the screen. */
function compute(engagementId: string, notes: Note[] | undefined, pending: Record<string, PendingNote>): ThreadCounts {
  const hit = cache.get(engagementId);
  if (hit && hit.notes === notes && hit.pending === pending) return hit.counts;
  const bodies = new Map<string, { hostId: string | null; body: string }>();
  for (const n of notes ?? []) bodies.set(noteKey(n), { hostId: n.hostId, body: n.body });
  for (const [key, p] of Object.entries(pending)) {
    if (p.engagementId === engagementId) bodies.set(key, { hostId: p.hostId, body: p.body });
  }
  const byHost = new Map<string, number>();
  let total = 0;
  for (const [key, { hostId, body }] of bodies) {
    const n = countOf(key, body);
    if (n === 0) continue;
    total += n;
    if (hostId) byHost.set(hostId, n);
  }
  const counts = total === 0 && byHost.size === 0 ? EMPTY : { byHost, total };
  cache.set(engagementId, { notes, pending, counts });
  return counts;
}

/** Open-thread counts. Unsaved text counts: a note's pending body wins over its saved one. */
export function useThreadCounts(engagementId: string): ThreadCounts {
  const notes = useNotes(engagementId).data;
  const pending = useNotesStore((s) => s.pending);
  return compute(engagementId, notes, pending);
}

export const threadsLabel = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;
export const openThreadsLabel = (n: number) => `${n} open ${n === 1 ? "thread" : "threads"}`;
