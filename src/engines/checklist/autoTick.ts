import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { ChecklistState, Evidence, ItemState } from '../../types/checklist';
import type { LogEntry } from '../../types/log';
import type { Service } from '../../types/service';
import { namedHostsInLine, shellHost, type HostRef } from '../attribution';
import type { LibraryCommand } from '../library/types';
import { matchLine } from '../library/matcher';
import { HOST_GOALS } from './data/hostChecklist';
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP } from './data/engagementChecklist';
import { adHosts, engagementFacts, goalApplies, hostFacts, type HostFacts } from './facts';
import { scanCommandLines } from './scanImport';
import type { ChecklistGoal } from './types';

/** One goal a log entry achieved on one owner (a host, or the engagement for `e-` goals). */
export interface Tick {
  ownerId: string;
  goalId: string;
  commandId: string;
  entryId: string;
}

export interface TickContext {
  engagement: Engagement;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  library: LibraryCommand[];
}

const HOST_GOAL_BY_ID = new Map<string, ChecklistGoal>(HOST_GOALS.map((g) => [g.id, g]));
const ENGAGEMENT_GOAL_BY_ID = new Map<string, ChecklistGoal>(
  [...ENGAGEMENT_SETUP, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => [g.id, g]),
);

/** Flag entries tick the proof goal of their kind on each tagged host, with this command id. */
const FLAG_GOAL = { local: 'h-orient-proof', proof: 'h-pe-proof' } as const;
export const FLAG_COMMAND_ID = 'flag';

/**
 * The goals a log entry achieved, attributed conservatively (spec §4): attacker commands tick the hosts named in
 * that line; target commands tick the host the shell is on. `e-ad-*` goals tick on the engagement only when the
 * line is attributed to an AD host (the DC, or any host with 88 and 389 open); `e-setup-*` goals tick on any line.
 * Goals that don't apply to the owner never tick. De-duplicated by owner and goal (first command wins).
 * Flag entries tick `h-orient-proof` / `h-pe-proof` on their hosts; other kinds tick nothing.
 */
export function ticksForEntry(entry: LogEntry, ctx: TickContext): Tick[] {
  const { engagement, hosts, servicesByHost, library } = ctx;
  const out: Tick[] = [];
  const seen = new Set<string>();
  const factsCache = new Map<string, HostFacts>();
  const factsOf = (h: Host) => {
    let f = factsCache.get(h.id);
    if (!f) {
      f = hostFacts(h, engagement, hosts, servicesByHost);
      factsCache.set(h.id, f);
    }
    return f;
  };
  const push = (ownerId: string, goalId: string, commandId: string) => {
    const key = `${ownerId}\u0000${goalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ownerId, goalId, commandId, entryId: entry.id });
  };
  const hostById = new Map(hosts.map((h) => [h.id, h]));

  if (entry.content.kind === 'flag') {
    const goal = HOST_GOAL_BY_ID.get(FLAG_GOAL[entry.content.flagKind]);
    if (!goal) return out;
    for (const id of entry.hostIds) {
      const h = hostById.get(id);
      if (h && goalApplies(goal, factsOf(h))) push(h.id, goal.id, FLAG_COMMAND_ID);
    }
    return out;
  }
  if (entry.content.kind !== 'command') return out;

  const domain = (engagement.domain ?? '').trim().toLowerCase();
  const adHostIds = new Set(adHosts(hosts, servicesByHost).map((h) => h.id));
  const engFacts = engagementFacts(engagement, hosts, servicesByHost);
  const refOf = (r: HostRef) => hostById.get(r.id)!;

  /** `scanLine`: a command read from pasted output; no shell context, so only attacker commands, only host goals. */
  const tickLine = (line: string, shell: string | undefined, scanLine: boolean, shellCache: { v?: HostRef | null }) => {
    const commands = matchLine(line, library);
    if (commands.length === 0) return;
    const named = namedHostsInLine(line, hosts, domain);
    for (const cmd of commands) {
      let attributed: HostRef[];
      if (cmd.runFrom === 'target') {
        if (scanLine) continue;
        if (shellCache.v === undefined) shellCache.v = shellHost(shell, entry.ranOn ?? undefined, hosts, domain);
        attributed = shellCache.v ? [shellCache.v] : [];
      } else {
        attributed = named;
      }
      for (const goalId of cmd.goals) {
        const engagementGoal = ENGAGEMENT_GOAL_BY_ID.get(goalId);
        if (engagementGoal) {
          if (scanLine || !goalApplies(engagementGoal, engFacts)) continue;
          if (goalId.startsWith('e-ad-')) {
            // A target-side line needs a resolved shell host; from there, naming the DC (`/dc:DC01`) also counts
            // as aimed at AD. With no shell host (Kali, empty, ambiguous) it ticks nothing.
            const aimed = cmd.runFrom === 'target' ? (attributed.length ? [...attributed, ...named] : []) : attributed;
            if (!aimed.some((h) => adHostIds.has(h.id))) continue;
          }
          push(engagement.id, goalId, cmd.id);
          continue;
        }
        const hostGoal = HOST_GOAL_BY_ID.get(goalId);
        if (!hostGoal) continue;
        for (const ref of attributed) {
          const h = refOf(ref);
          if (goalApplies(hostGoal, factsOf(h))) push(h.id, goalId, cmd.id);
        }
      }
    }
  };

  for (const block of entry.content.blocks) {
    const shellCache: { v?: HostRef | null } = {};
    for (const rawLine of (block.command ?? '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line) tickLine(line, block.shell, false, shellCache);
    }
    // A pasted scan names the command it came from (nmap `as:` header, XML args, typed prompt lines).
    for (const line of scanCommandLines(block.output ?? '')) tickLine(line, block.shell, true, shellCache);
  }
  return out;
}

/**
 * Applies ticks to one owner's checklist. A goal not yet done becomes done with `auto: true` (an 'na' or
 * 'in_progress' status is remembered in `autoFrom`); a goal already done keeps its status and gains the evidence
 * link. Returns `state` itself when nothing changes.
 */
export function applyTicks(state: ChecklistState | undefined, ticks: Tick[], now: number): ChecklistState {
  const base: ChecklistState = state ?? {};
  let next = base;
  let changed = false;
  for (const t of ticks) {
    const item: ItemState = next[t.goalId] ?? { status: 'todo' };
    const evidence = item.evidence ?? [];
    if (evidence.some((e) => e.entryId === t.entryId)) continue;
    const link: Evidence = { entryId: t.entryId, commandId: t.commandId };
    const updated: ItemState = { ...item, evidence: [...evidence, link] };
    if (item.status !== 'done') {
      if (item.status === 'na' || item.status === 'in_progress') updated.autoFrom = item.status;
      else delete updated.autoFrom;
      updated.status = 'done';
      updated.completedAt = now;
      updated.auto = true;
    }
    next = { ...next, [t.goalId]: updated };
    changed = true;
  }
  return changed ? next : (state ?? base);
}

/**
 * Removes the evidence one log entry left. A goal whose status came from auto-tick and has no evidence left goes
 * back to its `autoFrom` status (else 'todo') without `completedAt`. Returns `state` itself when the entry left nothing.
 */
export function removeEntryTicks(state: ChecklistState | undefined, entryId: string): ChecklistState {
  const base: ChecklistState = state ?? {};
  let next = base;
  let changed = false;
  for (const [goalId, item] of Object.entries(base)) {
    const evidence = item.evidence;
    if (!evidence || !evidence.some((e) => e.entryId === entryId)) continue;
    const kept = evidence.filter((e) => e.entryId !== entryId);
    const updated: ItemState = { ...item };
    if (kept.length > 0) updated.evidence = kept;
    else delete updated.evidence;
    if (updated.auto && kept.length === 0) {
      updated.status = updated.autoFrom === 'na' || updated.autoFrom === 'in_progress' ? updated.autoFrom : 'todo';
      delete updated.completedAt;
      delete updated.auto;
      delete updated.autoFrom;
    }
    next = { ...next, [goalId]: updated };
    changed = true;
  }
  return changed ? next : (state ?? base);
}

/**
 * Re-applies one log entry's ticks after it was added or edited: `removeEntryTicks` then `applyTicks`, except that a
 * goal this entry still ticks keeps its link in place (with the current command id) and its `completedAt`, so editing
 * a title or output does not move completion times. Returns `state` itself when nothing changes.
 */
export function replaceEntryTicks(state: ChecklistState | undefined, entryId: string, ticks: Tick[], now: number): ChecklistState {
  const base: ChecklistState = state ?? {};
  const wanted = new Map(ticks.filter((t) => t.entryId === entryId).map((t) => [t.goalId, t]));

  const stillLinked: ChecklistState = {};
  const others: ChecklistState = {};
  let relinked = false;
  for (const [goalId, item] of Object.entries(base)) {
    const tick = wanted.get(goalId);
    const idx = tick ? (item.evidence ?? []).findIndex((e) => e.entryId === entryId) : -1;
    if (!tick || idx === -1) {
      others[goalId] = item;
      continue;
    }
    if (item.evidence![idx].commandId === tick.commandId) {
      stillLinked[goalId] = item;
    } else {
      const evidence = [...item.evidence!];
      evidence[idx] = { ...evidence[idx], commandId: tick.commandId };
      stillLinked[goalId] = { ...item, evidence };
      relinked = true;
    }
  }
  const pruned = removeEntryTicks(others, entryId);
  const input: ChecklistState = { ...pruned, ...stillLinked };
  const merged = applyTicks(input, ticks, now);
  if (pruned === others && !relinked && merged === input) return state ?? base;
  return merged;
}
