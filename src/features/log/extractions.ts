import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import { afterEntrySaved } from "../checklist/ticks";
import type { LogEntry } from "../../types/log";
import { logKey } from "./queries";

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
 * Reverses what one save filed. The ticks follow: an entry whose extraction is undone writes none, so the
 * follow-up removes its output ticks and the fact ticks revert on their own.
 */
export async function undoExtraction(qc: QueryClient, entryId: string): Promise<void> {
  const { engagementId: id } = await api.extractionUndo(entryId);
  try {
    const entry = qc.getQueryData<LogEntry[]>(logKey(id))?.find((e) => e.id === entryId) ?? null;
    await afterEntrySaved(id, entry, entryId);
  } finally {
    void storeChanged(qc, { entity: "extraction", id: entryId, change: "undone" });
  }
}
