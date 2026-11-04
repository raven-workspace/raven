import { useMemo } from "react";
import { openThreads } from "../../engines/notes/threads";
import { noteKey, useNotesStore } from "./useNotesStore";
import { useNotes } from "./queries";

export interface ThreadCounts {
  /** Open threads per host id (hosts with none are absent). */
  byHost: Map<string, number>;
  /** Open threads in every note of the engagement, the engagement note included. */
  total: number;
}

/** Open-thread counts. Unsaved text counts: a note's pending body wins over its saved one. */
export function useThreadCounts(engagementId: string): ThreadCounts {
  const notes = useNotes(engagementId).data;
  const pending = useNotesStore((s) => s.pending);
  return useMemo(() => {
    const bodies = new Map<string, { hostId: string | null; body: string }>();
    for (const n of notes ?? []) bodies.set(noteKey(n), { hostId: n.hostId, body: n.body });
    for (const [key, p] of Object.entries(pending)) {
      if (p.engagementId === engagementId) bodies.set(key, { hostId: p.hostId, body: p.body });
    }
    const byHost = new Map<string, number>();
    let total = 0;
    for (const { hostId, body } of bodies.values()) {
      const n = openThreads(body).length;
      if (n === 0) continue;
      total += n;
      if (hostId) byHost.set(hostId, n);
    }
    return { byHost, total };
  }, [notes, pending, engagementId]);
}

export const threadsLabel = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;
export const openThreadsLabel = (n: number) => `${n} open ${n === 1 ? "thread" : "threads"}`;
