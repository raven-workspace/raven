import type { ChecklistItem, ChecklistItemInput, ChecklistState, ItemState } from "../../types/checklist";
import type { Service } from "../../types/service";

// Pure checklist helpers, apart from `queries.ts` so `ticks.ts` and `sync.ts` do not import the query hooks.

export const checklistKey = (engagementId: string) => ["checklist", engagementId] as const;

/** A stored row as the engine's per-goal state (absent fields left out). */
export function itemToState(it: ChecklistItem): ItemState {
  const s: ItemState = { status: it.status };
  if (it.notes != null) s.notes = it.notes;
  if (it.completedAt != null) s.completedAt = it.completedAt;
  if (it.auto) s.auto = true;
  if (it.autoFrom) s.autoFrom = it.autoFrom;
  if (it.statusManual) s.statusManual = true;
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
    statusManual: s.statusManual ?? false,
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
