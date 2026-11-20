import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api";
import { resyncAndRefresh } from "./resync";
import { byOwnerOf, checklistKey, itemToState, servicesByHostOf, stateToInput } from "./state";
import type { ChecklistItem, ChecklistItemInput, ChecklistState, ChecklistStatus, ItemState } from "../../types/checklist";

const NO_ITEMS: ChecklistItem[] = [];

export { byOwnerOf, checklistKey, itemToState, servicesByHostOf, stateToInput };

export function useChecklist(engagementId: string) {
  const query = useQuery({ queryKey: checklistKey(engagementId), queryFn: () => api.checklistList(engagementId) });
  const items = query.data ?? NO_ITEMS;
  const byOwner = useMemo(() => byOwnerOf(items), [items]);
  return { byOwner, items, query };
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
