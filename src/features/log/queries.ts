import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { LogEntryInput } from "../../types/log";

export function useLog(engagementId: string) {
  return useQuery({ queryKey: ["log", engagementId], queryFn: () => api.logList(engagementId) });
}

export function useLogMutations(engagementId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: ["log", engagementId] });
    void qc.invalidateQueries({ queryKey: ["progress"] });
    // A service's confirmation can cite an entry; editing or deleting the entry changes that.
    void qc.invalidateQueries({ queryKey: ["services"] });
  };
  return {
    update: useMutation({
      mutationFn: (v: { id: string; input: LogEntryInput }) => api.logUpdate(v.id, v.input),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.logDelete(id), onSuccess }),
  };
}
