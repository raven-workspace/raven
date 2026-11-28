import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { Engagement } from "../../types/engagement";

export const engagementsKey = ["engagements"] as const;
export const engagementKey = (id: string) => ["engagement", id] as const;

registerReads(engagementsKey, ["engagement"]);
registerReads(["engagement"], ["engagement"]);

export function useEngagements(enabled = true) {
  return useQuery({ queryKey: engagementsKey, queryFn: api.engagementsList, enabled });
}

export function useEngagement(id: string, enabled = true) {
  return useQuery({ queryKey: engagementKey(id), queryFn: () => api.engagementGet(id), enabled });
}

/** Shows a saved engagement at once, then reports the write so everything it touched refetches. */
export function engagementSaved(qc: QueryClient, saved: Engagement, change: "created" | "updated" | "saved" = "updated"): Promise<void> {
  qc.setQueryData(engagementKey(saved.id), saved);
  return storeChanged(qc, { entity: "engagement", id: saved.id, change });
}

/** Forgets a deleted engagement's own record, then reports the delete (its hosts, log and the rest cascade). */
export function engagementDeleted(qc: QueryClient, id: string): Promise<void> {
  qc.removeQueries({ queryKey: engagementKey(id) });
  return storeChanged(qc, { entity: "engagement", id, change: "deleted" });
}

/**
 * Pauses or resumes an exam sim's timebox (`mutate(true)` pauses). A click only, never a key, so a real exam can't be
 * paused by a stray press; locking Raven never pauses it either (owner call: an unnoticed pause is worse than a running
 * clock).
 */
export function useTimeboxPause(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) => api.engagementSetTimeboxPaused(id, paused),
    onSuccess: (saved) => void engagementSaved(qc, saved),
    onError: reportError,
  });
}
