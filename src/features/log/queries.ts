import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import type { LogEntry, LogEntryInput } from "../../types/log";
import { cleanupKey } from "../cleanup/queries";
import { accessGrantsKey, credAttemptsKey } from "../credentials/queries";
import { afterEntrySaved, deleteEntryWithTicks, FollowUpError } from "../checklist/ticks";
import { engagementKey } from "../engagements/queries";
import { hostsKey } from "../hosts/queries";
import { failedAttemptsKey, findingsKey } from "../findings/queries";

export const logKey = (engagementId: string) => ["log", engagementId] as const;

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
  // Settled, not success: the entry is saved even when its checklist follow-up failed.
  const onSettled = () => {
    void qc.invalidateQueries({ queryKey: logKey(engagementId) });
    void qc.invalidateQueries({ queryKey: ["progress"] });
    // A service's confirmation can cite an entry; editing or deleting the entry changes that.
    void qc.invalidateQueries({ queryKey: ["services"] });
    void qc.invalidateQueries({ queryKey: ["services", "engagement", engagementId] });
    void qc.invalidateQueries({ queryKey: ["checklist", engagementId] });
    void qc.invalidateQueries({ queryKey: hostsKey(engagementId) });
    void qc.invalidateQueries({ queryKey: engagementKey(engagementId) });
    // A deleted entry leaves the reproduction steps of any finding that used it.
    void qc.invalidateQueries({ queryKey: findingsKey(engagementId) });
    // An attempt that linked the entry loses the link.
    void qc.invalidateQueries({ queryKey: failedAttemptsKey(engagementId) });
    // Credential test results and access grants that cited it as proof lose the link.
    void qc.invalidateQueries({ queryKey: credAttemptsKey(engagementId) });
    void qc.invalidateQueries({ queryKey: accessGrantsKey(engagementId) });
    // A cleanup item that came from it loses the link.
    void qc.invalidateQueries({ queryKey: cleanupKey(engagementId) });
  };
  return {
    update: useMutation({
      mutationFn: async (v: { id: string; input: LogEntryInput }) => {
        const entry = await api.logUpdate(v.id, v.input);
        await followUp(engagementId, entry, entry.id);
        return entry;
      },
      onSettled,
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
      onSettled,
    }),
  };
}
