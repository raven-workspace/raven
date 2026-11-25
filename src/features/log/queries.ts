import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { LogEntry, LogEntryInput } from "../../types/log";
import { afterEntrySaved, deleteEntryWithTicks, FollowUpError } from "../checklist/ticks";

export const logKey = (engagementId: string) => ["log", engagementId] as const;

registerReads(["log"], ["logEntry"]);

export function useLog(engagementId: string, enabled = true) {
  return useQuery({ queryKey: logKey(engagementId), queryFn: () => api.logList(engagementId), enabled });
}

/** Runs the checklist and Metasploit follow-up; a `locked` cause still reaches the vault gate. */
async function followUp(engagementId: string, entry: LogEntry | null, entryId: string) {
  try {
    await afterEntrySaved(engagementId, entry, entryId);
  } catch (e) {
    if (e instanceof FollowUpError) reportError(e.reason);
    throw e;
  }
}

export function useLogMutations(engagementId: string) {
  const qc = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (v: { id: string; input: LogEntryInput }) => {
        const entry = await api.logUpdate(v.id, v.input);
        await followUp(engagementId, entry, entry.id);
        return entry;
      },
      // Settled, not success: the entry is saved even when its checklist follow-up failed.
      onSettled: (_e, _err, v) => void storeChanged(qc, { entity: "logEntry", id: v.id, change: "updated" }),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        try {
          await deleteEntryWithTicks(engagementId, id);
        } catch (e) {
          if (e instanceof FollowUpError) reportError(e.reason);
          throw e;
        }
        return null;
      },
      onSettled: (_r, _err, id) => void storeChanged(qc, { entity: "logEntry", id, change: "deleted" }),
    }),
  };
}
