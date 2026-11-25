import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { LogEntry, LogEntryInput } from "../../types/log";
import { syncChecklist } from "../checklist/sync";
import { lockMetasploit } from "../checklist/ticks";

export const logKey = (engagementId: string) => ["log", engagementId] as const;

registerReads(["log"], ["logEntry"]);

export function useLog(engagementId: string, enabled = true) {
  return useQuery({ queryKey: logKey(engagementId), queryFn: () => api.logList(engagementId), enabled });
}

/**
 * An edited entry's follow-up: the checklist sync, then the exam-sim Metasploit lock, which runs even when the sync
 * failed. The first failure is thrown; a `locked` cause still reaches the vault gate.
 */
async function followUp(qc: QueryClient, engagementId: string, entry: LogEntry) {
  let failure: unknown = null;
  try {
    await syncChecklist({ engagementId, change: { entity: "logEntry", id: entry.id, change: "updated", entry }, qc });
  } catch (e) {
    failure = e;
  }
  try {
    await lockMetasploit(engagementId, entry);
  } catch (e) {
    failure ??= e;
  }
  if (failure) {
    reportError(failure);
    throw failure;
  }
}

export function useLogMutations(engagementId: string) {
  const qc = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (v: { id: string; input: LogEntryInput }) => {
        const entry = await api.logUpdate(v.id, v.input);
        await followUp(qc, engagementId, entry);
        return entry;
      },
      // Settled, not success: the entry is saved even when its checklist follow-up failed.
      onSettled: (_e, _err, v) => void storeChanged(qc, { entity: "logEntry", id: v.id, change: "updated" }),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        // The sync deletes the entry once its ticks are off, and puts them back if the delete fails.
        try {
          await syncChecklist({ engagementId, change: { entity: "logEntry", id, change: "deleted" }, qc });
        } catch (e) {
          reportError(e);
          throw e;
        }
        return null;
      },
      onSettled: (_r, _err, id) => void storeChanged(qc, { entity: "logEntry", id, change: "deleted" }),
    }),
  };
}
