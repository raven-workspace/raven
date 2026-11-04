import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { ConfirmInput, ServiceInput } from "../../types/service";

export function useServices(hostId: string) {
  return useQuery({ queryKey: ["services", hostId], queryFn: () => api.servicesList(hostId) });
}

export function useServiceMutations(hostId: string) {
  const qc = useQueryClient();
  const onSuccess = () => void qc.invalidateQueries({ queryKey: ["services", hostId] });
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
