import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api";
import type { Hop, HopInput, Tunnel, TunnelInput } from "../../types/network";
import { resyncAndRefresh } from "./resync";
import { byOwnerOf, checklistKey, itemToState, servicesByHostOf, stateToInput } from "./state";
import type { ChecklistItem, ChecklistItemInput, ChecklistState, ChecklistStatus, ItemState } from "../../types/checklist";
import type { Service } from "../../types/service";

const NO_ITEMS: ChecklistItem[] = [];
const NO_SERVICES: Service[] = [];
const NO_TUNNELS: Tunnel[] = [];
const NO_HOPS: Hop[] = [];

export const engagementServicesKey = (engagementId: string) => ["services", "engagement", engagementId] as const;

export { byOwnerOf, checklistKey, itemToState, servicesByHostOf, stateToInput };

export function useChecklist(engagementId: string) {
  const query = useQuery({ queryKey: checklistKey(engagementId), queryFn: () => api.checklistList(engagementId) });
  const items = query.data ?? NO_ITEMS;
  const byOwner = useMemo(() => byOwnerOf(items), [items]);
  return { byOwner, items, query };
}

/** Every service in the engagement, grouped by host (`servicesByHost` for applicability and ticks). */
export function useEngagementServices(engagementId: string) {
  const query = useQuery({
    queryKey: engagementServicesKey(engagementId),
    queryFn: () => api.servicesListEngagement(engagementId),
  });
  const services = query.data ?? NO_SERVICES;
  const servicesByHost = useMemo(() => servicesByHostOf(services), [services]);
  return { servicesByHost, services, query };
}

export const tunnelsKey = (engagementId: string) => ["tunnels", engagementId] as const;
export const hopsKey = (engagementId: string) => ["hops", engagementId] as const;

/** The engagement's tunnels, for filling commands behind a pivot. */
export function useTunnels(engagementId: string) {
  const query = useQuery({ queryKey: tunnelsKey(engagementId), queryFn: () => api.tunnelsList(engagementId) });
  return { tunnels: query.data ?? NO_TUNNELS, query };
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

export function useChecklistMutations(engagementId: string) {
  const qc = useQueryClient();
  /** Read from the store, not the cache: a stale or unloaded cache must not wipe evidence or notes. */
  const current = async (ownerId: string, goalId: string): Promise<ItemState> => {
    const items = await api.checklistList(engagementId);
    const it = items.find((i) => i.ownerId === ownerId && i.goalId === goalId);
    return it ? itemToState(it) : { status: "todo" };
  };
  const put = (items: ChecklistItemInput[]) => api.checklistPut(engagementId, items);
  const onSuccess = (items: ChecklistItem[]) => {
    qc.setQueryData(checklistKey(engagementId), items);
    void qc.invalidateQueries({ queryKey: checklistKey(engagementId) });
  };
  return {
    /** A manual status: no longer auto, no remembered status, completed now when done. Evidence and notes stay. */
    setStatus: useMutation({
      mutationFn: async (v: { ownerId: string; goalId: string; status: ChecklistStatus }) => {
        const prev = await current(v.ownerId, v.goalId);
        const next: ItemState = { ...prev, status: v.status, auto: false, statusManual: true };
        delete next.autoFrom;
        if (v.status === "done") next.completedAt = Date.now();
        else delete next.completedAt;
        return put([stateToInput(v.ownerId, v.goalId, next)]);
      },
      onSuccess: (items: ChecklistItem[]) => {
        onSuccess(items);
        // A manual Done can move the card. Not fatal: a failure goes to the shared error path.
        void resyncAndRefresh(qc, engagementId);
      },
    }),
    setNotes: useMutation({
      mutationFn: async (v: { ownerId: string; goalId: string; notes: string }) => {
        const next: ItemState = { ...(await current(v.ownerId, v.goalId)) };
        if (v.notes.trim() === "") delete next.notes;
        else next.notes = v.notes;
        return put([stateToInput(v.ownerId, v.goalId, next)]);
      },
      onSuccess,
    }),
    /** Writes every goal of each given owner state, in one batch. */
    putStates: useMutation({
      mutationFn: (changes: Map<string, ChecklistState>) =>
        put([...changes].flatMap(([ownerId, state]) => Object.entries(state).map(([goalId, s]) => stateToInput(ownerId, goalId, s)))),
      onSuccess,
    }),
  };
}
