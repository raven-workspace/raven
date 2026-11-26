import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads } from "../../lib/storeChange";
import type { LogEntryInput } from "../../types/log";
import { entryChanged } from "./entryChange";

export const logKey = (engagementId: string) => ["log", engagementId] as const;

registerReads(["log"], ["logEntry"]);

export function useLog(engagementId: string, enabled = true) {
  return useQuery({ queryKey: logKey(engagementId), queryFn: () => api.logList(engagementId), enabled });
}

/**
 * An edit or delete reports its entry change, which runs the follow-ups, reports the store change and any error. The
 * delete itself is the checklist sync's: it takes the entry's ticks off, deletes it, and puts them back if that fails.
 */
export function useLogMutations(engagementId: string) {
  const qc = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (v: { id: string; input: LogEntryInput }) => {
        const entry = await api.logUpdate(v.id, v.input);
        await entryChanged({ qc, engagementId, change: { change: "edited", entry } });
        return entry;
      },
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        await entryChanged({ qc, engagementId, change: { change: "deleted", id } });
        return null;
      },
    }),
  };
}
