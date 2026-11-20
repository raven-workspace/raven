import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Hop, HopInput, InterfaceDismissal, Tunnel, TunnelInput } from "../../types/network";
import { checklistKey } from "../checklist/state";
import { engagementServicesKey } from "../services/queries";

const NO_TUNNELS: Tunnel[] = [];
const NO_HOPS: Hop[] = [];
const NO_DISMISSALS: InterfaceDismissal[] = [];

export const tunnelsKey = (engagementId: string) => ["tunnels", engagementId] as const;
export const hopsKey = (engagementId: string) => ["hops", engagementId] as const;

/** The engagement's tunnels, for filling commands behind a pivot. */
export function useTunnels(engagementId: string) {
  const query = useQuery({ queryKey: tunnelsKey(engagementId), queryFn: () => api.tunnelsList(engagementId) });
  return { tunnels: query.data ?? NO_TUNNELS, query };
}

export const interfaceDismissalsKey = (engagementId: string) => ["interfaceDismissals", engagementId] as const;

/** Host + subnet pairs the user dismissed interface nudges for. */
export function useInterfaceDismissals(engagementId: string) {
  const query = useQuery({
    queryKey: interfaceDismissalsKey(engagementId),
    queryFn: () => api.interfaceDismissalsList(engagementId),
  });
  return { dismissals: query.data ?? NO_DISMISSALS, query };
}

export function useInterfaceDismiss(engagementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { hostId: string; subnet: string }) => api.interfaceDismiss(engagementId, v.hostId, v.subnet),
    // Returned, so the mutation settles only after the refetch and a dismissed row never flashes back.
    onSuccess: () => qc.invalidateQueries({ queryKey: interfaceDismissalsKey(engagementId) }),
  });
}

/** The engagement's hops (how access moved between hosts). */
export function useHops(engagementId: string) {
  const query = useQuery({ queryKey: hopsKey(engagementId), queryFn: () => api.hopsList(engagementId) });
  return { hops: query.data ?? NO_HOPS, query };
}

export function useHopMutations(engagementId: string) {
  const qc = useQueryClient();
  const onSuccess = () => void qc.invalidateQueries({ queryKey: hopsKey(engagementId) });
  return {
    create: useMutation({ mutationFn: (input: HopInput) => api.hopCreate(engagementId, input), onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; input: HopInput }) => api.hopUpdate(v.id, v.input), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.hopDelete(id), onSuccess }),
  };
}

/** Tunnels feed command filling, so a change also refreshes the checklist-related queries. */
export function useTunnelMutations(engagementId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: tunnelsKey(engagementId) });
    void qc.invalidateQueries({ queryKey: checklistKey(engagementId) });
    void qc.invalidateQueries({ queryKey: engagementServicesKey(engagementId) });
  };
  return {
    create: useMutation({ mutationFn: (input: TunnelInput) => api.tunnelCreate(engagementId, input), onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; input: TunnelInput }) => api.tunnelUpdate(v.id, v.input), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.tunnelDelete(id), onSuccess }),
  };
}
