import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { Hop, HopInput, InterfaceDismissal, Tunnel, TunnelInput } from "../../types/network";

const NO_TUNNELS: Tunnel[] = [];
const NO_HOPS: Hop[] = [];
const NO_DISMISSALS: InterfaceDismissal[] = [];

export const tunnelsKey = (engagementId: string) => ["tunnels", engagementId] as const;
export const hopsKey = (engagementId: string) => ["hops", engagementId] as const;
export const interfaceDismissalsKey = (engagementId: string) => ["interfaceDismissals", engagementId] as const;

registerReads(["tunnels"], ["tunnel"]);
registerReads(["hops"], ["hop"]);
registerReads(["interfaceDismissals"], ["interfaceDismissal"]);

/** The engagement's tunnels, for filling commands behind a pivot. */
export function useTunnels(engagementId: string, enabled = true) {
  const query = useQuery({ queryKey: tunnelsKey(engagementId), queryFn: () => api.tunnelsList(engagementId), enabled });
  return { tunnels: query.data ?? NO_TUNNELS, query };
}

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
    onSuccess: (_r, v) => storeChanged(qc, { entity: "interfaceDismissal", id: `${v.hostId}:${v.subnet}`, change: "created" }),
  });
}

/** The engagement's hops (how access moved between hosts). */
export function useHops(engagementId: string) {
  const query = useQuery({ queryKey: hopsKey(engagementId), queryFn: () => api.hopsList(engagementId) });
  return { hops: query.data ?? NO_HOPS, query };
}

export function useHopMutations(engagementId: string) {
  const qc = useQueryClient();
  const changed = (id: string, change: "created" | "updated" | "deleted") => void storeChanged(qc, { entity: "hop", id, change });
  return {
    create: useMutation({ mutationFn: (input: HopInput) => api.hopCreate(engagementId, input), onSuccess: (h) => changed(h.id, "created") }),
    update: useMutation({ mutationFn: (v: { id: string; input: HopInput }) => api.hopUpdate(v.id, v.input), onSuccess: (_h, v) => changed(v.id, "updated") }),
    remove: useMutation({ mutationFn: (id: string) => api.hopDelete(id), onSuccess: (_r, id) => changed(id, "deleted") }),
  };
}

/** Tunnels feed command filling, which reads them through `useTunnels`. */
export function useTunnelMutations(engagementId: string) {
  const qc = useQueryClient();
  const changed = (id: string, change: "created" | "updated" | "deleted") => void storeChanged(qc, { entity: "tunnel", id, change });
  return {
    create: useMutation({ mutationFn: (input: TunnelInput) => api.tunnelCreate(engagementId, input), onSuccess: (t) => changed(t.id, "created") }),
    update: useMutation({ mutationFn: (v: { id: string; input: TunnelInput }) => api.tunnelUpdate(v.id, v.input), onSuccess: (_t, v) => changed(v.id, "updated") }),
    remove: useMutation({ mutationFn: (id: string) => api.tunnelDelete(id), onSuccess: (_r, id) => changed(id, "deleted") }),
  };
}
