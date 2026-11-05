import type { ChecklistState, ItemState } from '../../types/checklist';
import type { CredAttempt } from '../../types/credentials';
import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { Service } from '../../types/service';
import { applicableGoals, findDcHost, hostFacts } from './facts';

type ServicesByHost = Map<string, Service[]>;

export const DA_COVER_LABEL = 'Covered by domain admin';

/** The one definition of "domain admin": an admin result on the engagement's DC. */
export function domainAdminConfirmed(hosts: Host[], servicesByHost: ServicesByHost, attempts: CredAttempt[]): boolean {
  const dc = findDcHost(hosts, servicesByHost);
  return !!dc && attempts.some((a) => a.result === 'admin' && a.hostId === dc.id);
}

/** Auto-tick never leaves an item `na` with `auto` set, so that pair marks an item the domain admin cover set. */
export function isCoverMarked(item: ItemState | undefined): boolean {
  return item?.auto === true && item.status === 'na';
}

const COVERED_STAGES = new Set(['privesc', 'loot']);
/** Privesc proof stays a real task on every host. */
const NEVER_COVERED = new Set(['h-pe-proof']);

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
      if (item && (item.status !== 'todo' || item.auto)) continue;
      next = { ...next, [goalId]: { ...(item ?? {}), status: 'na', auto: true } };
    }
    if (next !== state) out.set(ownerId, next);
  }
  return out;
}
