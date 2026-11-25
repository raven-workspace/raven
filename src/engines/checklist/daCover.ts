import type { ChecklistState, ItemState } from '../../types/checklist';
import type { CredAttempt } from '../../types/credentials';
import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { Service } from '../../types/service';
import { applicableGoals, findDc, hostFacts } from './facts';

type ServicesByHost = Map<string, Service[]>;

export const DA_COVER_LABEL = 'Covered by domain admin';

/** The one definition of "domain admin": an admin result on the engagement's DC. */
export function domainAdminConfirmed(hosts: Host[], servicesByHost: ServicesByHost, attempts: CredAttempt[]): boolean {
  const dc = findDc(hosts, servicesByHost);
  return !!dc && attempts.some((a) => a.result === 'admin' && a.hostId === dc.id);
}

/**
 * Auto-tick never leaves an item `na` with `auto` set, so that pair, on an item not set by hand, marks an item the
 * domain admin cover set (as the store's revert reads it).
 */
export function isCoverMarked(item: ItemState | undefined): boolean {
  return item?.auto === true && item.status === 'na' && !item.statusManual;
}

const COVERED_STAGES = new Set(['privilege-escalation', 'post-exploitation']);
/** Privesc proof stays a real task on every host, and the network facts are about the host, not the domain. */
const NEVER_COVERED = new Set(['h-pe-proof', 'h-orient-network', 'h-post-neighbours']);

function revert(item: ItemState): ItemState {
  const next: ItemState = { ...item, status: 'todo' };
  delete next.auto;
  delete next.autoFrom;
  delete next.completedAt;
  return next;
}

/**
 * Domain admin on the DC covers privesc and loot on every domain-joined host: untouched `todo` items there become
 * `na` with `auto` set (see `isCoverMarked`). Anything the user set by hand is left alone, and cover-marked items
 * go back to `todo` once the trigger (or the host's applicability) is gone. Returns only the owners whose state
 * changes, each with its full new state.
 */
export function daCoverChanges(input: {
  engagement: Engagement;
  hosts: Host[];
  servicesByHost: ServicesByHost;
  attempts: CredAttempt[];
  byOwner: Map<string, ChecklistState>;
}): Map<string, ChecklistState> {
  const { engagement, hosts, servicesByHost, attempts, byOwner } = input;
  const confirmed = domainAdminConfirmed(hosts, servicesByHost, attempts);
  const targets = new Map<string, Set<string>>();
  if (confirmed) {
    for (const host of hosts) {
      if (!hostFacts(host, engagement, hosts, servicesByHost).domainJoined) continue;
      const ids = new Set<string>();
      for (const { stage, goals } of applicableGoals(host, engagement, hosts, servicesByHost)) {
        if (!COVERED_STAGES.has(stage.id)) continue;
        for (const g of goals) if (!NEVER_COVERED.has(g.id)) ids.add(g.id);
      }
      targets.set(host.id, ids);
    }
  }

  const out = new Map<string, ChecklistState>();
  const owners = new Set([...byOwner.keys(), ...targets.keys()]);
  for (const ownerId of owners) {
    const state = byOwner.get(ownerId) ?? {};
    const wanted = targets.get(ownerId);
    let next = state;
    for (const [goalId, item] of Object.entries(state)) {
      if (isCoverMarked(item) && !wanted?.has(goalId)) next = { ...next, [goalId]: revert(item) };
    }
    for (const goalId of wanted ?? []) {
      const item = next[goalId];
      if (item && (item.status !== 'todo' || item.auto || item.statusManual)) continue;
      next = { ...next, [goalId]: { ...(item ?? {}), status: 'na', auto: true } };
    }
    if (next !== state) out.set(ownerId, next);
  }
  return out;
}

export interface GoalRef {
  ownerId: string;
  goalId: string;
}

/**
 * `daCoverChanges` as two goal lists for the store's conditional write: `cover` (untouched items to set `na`/auto) and
 * `revert` (cover-marked items to put back to `todo`). The store re-checks each row, so a status set by hand after
 * this was computed is never overwritten.
 */
export function daCoverGoals(input: Parameters<typeof daCoverChanges>[0]): { cover: GoalRef[]; revert: GoalRef[] } {
  const cover: GoalRef[] = [];
  const revertList: GoalRef[] = [];
  for (const [ownerId, state] of daCoverChanges(input)) {
    const before = input.byOwner.get(ownerId) ?? {};
    for (const [goalId, item] of Object.entries(state)) {
      const old = before[goalId];
      if (isCoverMarked(item) && !isCoverMarked(old)) cover.push({ ownerId, goalId });
      else if (isCoverMarked(old) && !isCoverMarked(item)) revertList.push({ ownerId, goalId });
    }
  }
  return { cover, revert: revertList };
}
