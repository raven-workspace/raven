import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import type { HopInput, Tunnel } from "../../types/network";
import { resyncBoards } from "./ticks";
import type { ChecklistItem, ChecklistItemInput, ChecklistState, ChecklistStatus, ItemState } from "../../types/checklist";
import type { Service } from "../../types/service";

const NO_ITEMS: ChecklistItem[] = [];
const NO_SERVICES: Service[] = [];
const NO_TUNNELS: Tunnel[] = [];

export const checklistKey = (engagementId: string) => ["checklist", engagementId] as const;
export const engagementServicesKey = (engagementId: string) => ["services", "engagement", engagementId] as const;

/** A stored row as the engine's per-goal state (absent fields left out). */
export function itemToState(it: ChecklistItem): ItemState {
  const s: ItemState = { status: it.status };
  if (it.notes != null) s.notes = it.notes;
  if (it.completedAt != null) s.completedAt = it.completedAt;
  if (it.auto) s.auto = true;
  if (it.autoFrom) s.autoFrom = it.autoFrom;
  if (it.evidence.length > 0) s.evidence = it.evidence;
  return s;
}

/** The engine's per-goal state as a full upsert row: every field is sent, so an undo clears the stored values. */
export function stateToInput(ownerId: string, goalId: string, s: ItemState): ChecklistItemInput {
  return {
    ownerId,
    goalId,
    status: s.status,
    notes: s.notes ?? null,
    completedAt: s.completedAt ?? null,
    auto: s.auto ?? false,
    autoFrom: s.autoFrom ?? null,
    evidence: s.evidence ?? [],
  };
}

/** Stored rows grouped by owner (a host id, or the engagement id). */
export function byOwnerOf(items: ChecklistItem[]): Map<string, ChecklistState> {
  const out = new Map<string, ChecklistState>();
  for (const it of items) {
    let state = out.get(it.ownerId);
    if (!state) {
      state = {};
      out.set(it.ownerId, state);
    }
    state[it.goalId] = itemToState(it);
  }
  return out;
}

/** Services per host for the whole engagement, from one query. */
export function servicesByHostOf(services: Service[]): Map<string, Service[]> {
  const out = new Map<string, Service[]>();
  for (const s of services) {
    const list = out.get(s.hostId);
    if (list) list.push(s);
    else out.set(s.hostId, [s]);
  }
  return out;
}

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

export function useHopMutations(engagementId: string) {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (input: HopInput) => api.hopCreate(engagementId, input),
      onSuccess: () => void qc.invalidateQueries({ queryKey: hopsKey(engagementId) }),
    }),
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
        const next: ItemState = { ...prev, status: v.status, auto: false };
        delete next.autoFrom;
        if (v.status === "done") next.completedAt = Date.now();
        else delete next.completedAt;
        return put([stateToInput(v.ownerId, v.goalId, next)]);
      },
      onSuccess: (items: ChecklistItem[]) => {
        onSuccess(items);
        // A manual Done can move the card. Not fatal: a failure goes to the shared error path.
        void resyncBoards(engagementId).then(
          () => qc.invalidateQueries({ queryKey: ["hosts", engagementId] }),
          reportError,
        );
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
