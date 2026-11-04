import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** Every note of an engagement (engagement note plus one per host), for thread counts. */
export function useNotes(engagementId: string) {
  return useQuery({ queryKey: ["notes", engagementId], queryFn: () => api.notesList(engagementId) });
}

/** One note: a host's, or the engagement's when `hostId` is null. */
export function useNote(engagementId: string, hostId: string | null) {
  return useQuery({
    queryKey: ["note", engagementId, hostId],
    queryFn: () => api.notesGet(engagementId, hostId),
  });
}
