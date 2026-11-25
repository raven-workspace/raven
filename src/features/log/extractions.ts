import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import { syncChecklist } from "../checklist/sync";

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
 * Reverses what one save filed. The ticks follow: an entry whose extraction is undone ticks nothing, so the checklist
 * sync removes its ticks and the fact ticks revert on their own.
 */
export async function undoExtraction(qc: QueryClient, entryId: string): Promise<void> {
  const { engagementId } = await api.extractionUndo(entryId);
  try {
    await syncChecklist({ engagementId, change: { entity: "extraction", id: entryId, change: "undone" }, qc });
  } finally {
    void storeChanged(qc, { entity: "extraction", id: entryId, change: "undone" });
  }
}
