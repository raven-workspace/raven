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
  };
  return {
    update: useMutation({
      mutationFn: (v: { id: string; input: LogEntryInput }) => api.logUpdate(v.id, v.input),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.logDelete(id), onSuccess }),
  };
}
