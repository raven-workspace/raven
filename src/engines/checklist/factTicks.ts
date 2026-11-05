import type { ChecklistState, ItemState } from '../../types/checklist';
import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { Service } from '../../types/service';
import type { GoalRef } from './daCover';
import { FACT_GOALS } from './data/hostChecklist';

type ServicesByHost = Map<string, Service[]>;

/** A fact tick is `done` and `auto` with no evidence: no log entry produced it, the host's own data did. */
export function isFactMarked(goalId: string, item: ItemState | undefined): boolean {
  return (FACT_GOALS as readonly string[]).includes(goalId) && item?.auto === true && item.status === 'done' && !item.evidence?.length;
}

const isOpen = (s: Service) => {
  const st = (s.state ?? '').toLowerCase();
  return !st.startsWith('closed') && !st.startsWith('filtered');
};

const nonEmpty = (v: string | null) => !!v && v.trim() !== '';

function identified(s: Service): boolean {
  const confirmed = nonEmpty(s.confirmedProduct);
  if (!nonEmpty(s.confirmedVersion) && !nonEmpty(s.nmapVersion)) return false;
  if (confirmed) return true;
  const name = (s.nmapService ?? '').trim().toLowerCase();
  return !name.endsWith('?') && name !== 'tcpwrapped';
}

function holds(goalId: string, host: Host, services: Service[]): boolean {
  if (goalId === 'h-enum-os') return host.os !== null;
  const open = services.filter(isOpen);
  return open.length > 0 && open.every(identified);
}

/**
 * The goals the host's own data decides: `done` (untouched items whose fact holds) and `revert` (fact-marked items
 * whose fact no longer holds). The store re-checks every row, so a status set by hand is never overwritten.
 */
export function factTickGoals(input: {
  engagement: Engagement;
  hosts: Host[];
  servicesByHost: ServicesByHost;
  byOwner: Map<string, ChecklistState>;
}): { done: GoalRef[]; revert: GoalRef[] } {
  const done: GoalRef[] = [];
  const revert: GoalRef[] = [];
  for (const host of input.hosts) {
    const state = input.byOwner.get(host.id) ?? {};
    const services = input.servicesByHost.get(host.id) ?? [];
    for (const goalId of FACT_GOALS) {
      const item = state[goalId];
      const ref = { ownerId: host.id, goalId };
      if (holds(goalId, host, services)) {
        if (!item || (item.status === 'todo' && !item.auto && !item.statusManual)) done.push(ref);
      } else if (isFactMarked(goalId, item) && !item?.statusManual) {
        revert.push(ref);
      }
    }
  }
  return { done, revert };
}
