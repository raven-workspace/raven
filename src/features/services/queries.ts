import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { resyncBoards } from "../checklist/ticks";
import type { ConfirmInput, ServiceInput } from "../../types/service";

export function useServices(hostId: string) {
  return useQuery({ queryKey: ["services", hostId], queryFn: () => api.servicesList(hostId) });
}

export function useServiceMutations(engagementId: string, hostId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: ["services", hostId] });
    // The engagement-wide list (`useEngagementServices`) holds this host's services too.
    void qc.invalidateQueries({ queryKey: ["services", "engagement"] });
    // A service (above all a confirmed identity) changes which goals apply, so the derived column can move.
    // Not fatal: a failure goes to the shared error path (a locked vault reaches the gate).
    void resyncBoards(engagementId).then(
      () => qc.invalidateQueries({ queryKey: ["hosts", engagementId] }),
      reportError,
    );
  };
  return {
    create: useMutation({ mutationFn: (input: ServiceInput) => api.serviceCreate(hostId, input), onSuccess }),
    update: useMutation({
      mutationFn: (v: { id: string; input: ServiceInput }) => api.serviceUpdate(v.id, v.input),
      onSuccess,
    }),
    confirm: useMutation({
      mutationFn: (v: { id: string; input: ConfirmInput }) => api.serviceConfirm(v.id, v.input),
      onSuccess,
    }),
    unconfirm: useMutation({ mutationFn: (id: string) => api.serviceUnconfirm(id), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.serviceDelete(id), onSuccess }),
  };
}
