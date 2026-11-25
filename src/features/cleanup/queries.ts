import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { CleanupInput } from "../../types/cleanup";

export const cleanupKey = (eid: string) => ["cleanup", eid] as const;
export const cleanupCountsKey = ["cleanupCounts"] as const;

registerReads(["cleanup"], ["cleanupItem"]);
registerReads(cleanupCountsKey, ["cleanupItem"]);

export function useCleanup(eid: string) {
  return useQuery({ queryKey: cleanupKey(eid), queryFn: () => api.cleanupList(eid) });
}

/** Open cleanup items per engagement id (engagements with none are absent). */
export function useCleanupCounts() {
  return useQuery({ queryKey: cleanupCountsKey, queryFn: api.cleanupCounts });
}

export function useCleanupMutations(eid: string) {
  const qc = useQueryClient();
  // Returned, so a mutation settles only after the list has refetched: a suggestion hidden while its Add or
  // Dismiss is in flight never flashes back (clickable) between the save and the refetch.
  const changed = (id: string, change: "created" | "updated" | "deleted") => storeChanged(qc, { entity: "cleanupItem", id, change });
  return {
    create: useMutation({ mutationFn: (input: CleanupInput) => api.cleanupCreate(eid, input), onSuccess: (c) => changed(c.id, "created") }),
    update: useMutation({
      mutationFn: (v: { id: string; input: CleanupInput }) => api.cleanupUpdate(v.id, v.input),
      onSuccess: (_c, v) => changed(v.id, "updated"),
    }),
    setRemoved: useMutation({
      mutationFn: (v: { id: string; removed: boolean }) => api.cleanupSetRemoved(v.id, v.removed),
      onSuccess: (_c, v) => changed(v.id, "updated"),
    }),
    // A dismissal is a cleanup row of its own, keyed by the suggestion.
    dismiss: useMutation({ mutationFn: (key: string) => api.cleanupDismiss(eid, key), onSuccess: (_r, key) => changed(key, "created") }),
    remove: useMutation({ mutationFn: (id: string) => api.cleanupDelete(id), onSuccess: (_r, id) => changed(id, "deleted") }),
  };
}
