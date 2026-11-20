import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { credAttemptsKey, credentialsKey, triedPairsKey, usernamesKey } from "../credentials/queries";
import { afterEntrySaved } from "../checklist/ticks";
import type { LogEntry } from "../../types/log";
import { engagementKey, engagementsKey } from "../engagements/queries";
import { hostsKey } from "../hosts/queries";
import { logKey } from "./queries";

export const extractionsKey = (engagementId: string) => ["extractions", engagementId] as const;

/** Everything a save (or an undo of one) can change: refetch it all, including what each entry filed. */
export function invalidateAfterSave(qc: QueryClient, id: string): void {
  for (const key of [logKey(id), hostsKey(id), ["services"], ["services", "engagement", id], ["checklist", id], ["progress"], engagementKey(id), engagementsKey, credentialsKey(id), usernamesKey(id), credAttemptsKey(id), triedPairsKey(id), ["hostIdentity"], ["vectors"], extractionsKey(id)]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

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
    invalidateAfterSave(qc, id);
  }
}
