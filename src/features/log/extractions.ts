import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads } from "../../lib/storeChange";
import { entryChanged } from "./entryChange";

export const extractionsKey = (engagementId: string) => ["extractions", engagementId] as const;

registerReads(["extractions"], ["extraction"]);

/** What each saved entry filed, indexed by entry id. */
export function useExtractions(engagementId: string) {
  return useQuery({
    queryKey: extractionsKey(engagementId),
    queryFn: async () => new Map((await api.extractionsList(engagementId)).map((x) => [x.logEntryId, x])),
  });
}

/**
 * Reverses what one save filed, then reports the entry change. The ticks follow: an entry whose extraction is undone
 * ticks nothing, so the checklist sync removes its ticks and the fact ticks revert on their own.
 */
export async function undoExtraction(qc: QueryClient, entryId: string): Promise<void> {
  const { engagementId } = await api.extractionUndo(entryId);
  await entryChanged({ qc, engagementId, change: { change: "undone", id: entryId } });
}
