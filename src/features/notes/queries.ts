import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";

export const notesKey = (engagementId: string) => ["notes", engagementId] as const;
export const noteQueryKey = (engagementId: string, hostId: string | null) => ["note", engagementId, hostId] as const;
export const ruledOutKey = (engagementId: string) => ["ruledOut", engagementId] as const;

registerReads(["notes"], ["note"]);
registerReads(["note"], ["note"]);
registerReads(["ruledOut"], ["ruledOut"]);

/** Every note of an engagement (engagement note plus one per host), for thread counts. */
export function useNotes(engagementId: string) {
  return useQuery({ queryKey: notesKey(engagementId), queryFn: () => api.notesList(engagementId) });
}

/** One note: a host's, or the engagement's when `hostId` is null. */
export function useNote(engagementId: string, hostId: string | null) {
  return useQuery({
    queryKey: noteQueryKey(engagementId, hostId),
    queryFn: () => api.notesGet(engagementId, hostId),
  });
}

/** The engagement's ruled-out items, oldest first. */
export function useRuledOut(engagementId: string) {
  return useQuery({ queryKey: ruledOutKey(engagementId), queryFn: () => api.ruledOutList(engagementId) });
}

/** Deletes a hand-written ruled-out item (a verdict's own item goes when the verdict is undone). */
export function useRuledOutDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.ruledOutDelete(id),
    onSuccess: (_r, id) => void storeChanged(qc, { entity: "ruledOut", id, change: "deleted" }),
  });
}
