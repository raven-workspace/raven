import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { LogEntry } from '../../types/log';
import type { Service } from '../../types/service';
import { excludesHosts, namedHostsInLine, shellHost, type HostRef } from '../attribution';
import type { LibraryCommand } from '../library/types';
import { matchLine } from '../library/matcher';
import { HOST_GOALS } from './data/hostChecklist';
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP, LATERAL_MOVEMENT_GOALS } from './data/engagementChecklist';
import { adSetHosts, engagementFacts, goalApplies, hostFacts, type HostFacts } from './facts';
import { scanProvenanceLines } from './scanImport';
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
  [...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => [g.id, g]),
);

/** Flag entries tick the proof goal of their kind on each tagged host, with this command id. */
const FLAG_GOAL = { local: 'h-orient-proof', proof: 'h-pe-proof' } as const;
export const FLAG_COMMAND_ID = 'flag';

/**
 * The goals a log entry achieved, attributed conservatively (foundation spec §6.4): attacker commands tick the hosts named in
 * that line; target commands tick the host the shell is on. `e-ad-*` goals tick on the engagement only when the
 * line is attributed to an AD set member (GLOSSARY.md); `e-setup-*` goals tick on any line.
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
    // A captured flag is a fact: it ticks on every known tagged host without an applicability check.
    const goalId = FLAG_GOAL[entry.content.flagKind];
    for (const id of entry.hostIds) if (hostById.has(id)) push(id, goalId, FLAG_COMMAND_ID);
    return out;
  }
  if (entry.content.kind !== 'command') return out;

  const domain = (engagement.domain ?? '').trim().toLowerCase();
  const adHostIds = new Set(adSetHosts(hosts).map((h) => h.id));
  const engFacts = engagementFacts(engagement, hosts);
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
      } else if (named.length === 0 && !scanLine && !excludesHosts(line)) {
        // A Kali command naming no host (`searchsploit --nmap nmap_svc.xml`) is about the hosts the
        // entry is tagged with: the host it was logged on, or the chips the user picked.
        attributed = entry.hostIds.map((id) => hostById.get(id)).filter((h): h is NonNullable<typeof h> => !!h);
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
    // A pasted scan names the command it came from (nmap `as:` header, XML args); other output lines never count.
    for (const line of scanProvenanceLines(block.output ?? '')) tickLine(line, block.shell, true, shellCache);
  }
  return out;
}
