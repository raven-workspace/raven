import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { BoardColumn, HostInput } from "../../types/host";

export function useHosts(engagementId: string) {
  return useQuery({ queryKey: ["hosts", engagementId], queryFn: () => api.hostsList(engagementId) });
}

/** Per-engagement host and flag counts, keyed by engagement id. */
export function useProgress() {
  return useQuery({ queryKey: ["progress"], queryFn: api.engagementsProgress });
}

export function useHostMutations(engagementId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: ["hosts", engagementId] });
    void qc.invalidateQueries({ queryKey: ["progress"] });
    // Host facts (OS, IP) change applicability; a deleted host takes its checklist rows and services with it.
    void qc.invalidateQueries({ queryKey: ["checklist", engagementId] });
    void qc.invalidateQueries({ queryKey: ["services"] });
  };
  return {
    create: useMutation({ mutationFn: (input: HostInput) => api.hostCreate(engagementId, input), onSuccess }),
    update: useMutation({
      mutationFn: (v: { id: string; input: HostInput }) => api.hostUpdate(v.id, v.input),
      onSuccess,
    }),
    move: useMutation({
      mutationFn: (v: { id: string; column: BoardColumn }) => api.hostMove(v.id, v.column),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.hostDelete(id),
      onSuccess: () => {
        onSuccess();
        // Log entries lose the deleted host's link.
        void qc.invalidateQueries({ queryKey: ["log", engagementId] });
      },
    }),
  };
}
