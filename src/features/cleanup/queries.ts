import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { CleanupInput } from "../../types/cleanup";

export const cleanupKey = (eid: string) => ["cleanup", eid] as const;
export const cleanupCountsKey = ["cleanupCounts"] as const;

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
  const onSuccess = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: cleanupKey(eid) }),
      qc.invalidateQueries({ queryKey: cleanupCountsKey }),
    ]);
  return {
    create: useMutation({ mutationFn: (input: CleanupInput) => api.cleanupCreate(eid, input), onSuccess }),
    update: useMutation({
      mutationFn: (v: { id: string; input: CleanupInput }) => api.cleanupUpdate(v.id, v.input),
      onSuccess,
    }),
    setRemoved: useMutation({
      mutationFn: (v: { id: string; removed: boolean }) => api.cleanupSetRemoved(v.id, v.removed),
      onSuccess,
    }),
    dismiss: useMutation({ mutationFn: (key: string) => api.cleanupDismiss(eid, key), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.cleanupDelete(id), onSuccess }),
  };
}
