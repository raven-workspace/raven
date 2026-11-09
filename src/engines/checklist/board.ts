import type { BoardColumn, Host } from '../../types/host';
import type { ChecklistState } from '../../types/checklist';
import type { ChecklistGoal, ChecklistStage } from './types';

type Applicable = { stage: ChecklistStage; goals: ChecklistGoal[] }[];

const SHELL_GOALS = ['h-foot-shell', 'h-foot-creds', 'h-stab-shell', 'h-foot-arrived', 'h-orient-proof'];

const isDone = (state: ChecklistState, goalId: string) => state[goalId]?.status === 'done';
const isClosed = (state: ChecklistState, goalId: string) => {
  const s = state[goalId]?.status;
  return s === 'done' || s === 'na';
};

/**
 * The board column a host's checklist implies. Proof decides the late columns, shell goals decide privilege
 * escalation, recorded root access is at least Post-exploitation, any foothold work (or user access) is Initial foothold, and Vulnerability detection means
 * information gathering is finished (every applicable goal done or N/A, and at least one). Vulnerability
 * detection and lateral movement goals never move a host.
 */
export function derivedColumn(host: Host, state: ChecklistState, applicable: Applicable): BoardColumn {
  const goalsOf = (stageId: string) => applicable.filter((a) => a.stage.id === stageId).flatMap((a) => a.goals);
  if (isDone(state, 'h-pe-proof')) {
    const late = [...goalsOf('post-exploitation'), ...goalsOf('reporting')];
    return late.every((g) => isClosed(state, g.id)) ? 'reporting' : 'post-exploitation';
  }
  // Root access means privilege escalation is over, whatever the ticks say; only proof and closed late goals reach Reporting.
  if (host.access === 'root') return 'post-exploitation';
  if (SHELL_GOALS.some((id) => isDone(state, id))) return 'privilege-escalation';
  if (goalsOf('initial-foothold').some((g) => isDone(state, g.id)) || host.access !== 'none') return 'initial-foothold';
  const gathering = goalsOf('information-gathering');
  if (gathering.length > 0 && gathering.every((g) => isClosed(state, g.id))) return 'vulnerability-detection';
  return 'information-gathering';
}

/** The first applicable stage with an open goal, or null when everything applicable is closed. */
export function currentStage(state: ChecklistState, applicable: Applicable): ChecklistStage | null {
  for (const a of applicable) {
    if (a.stage.placement === 'engagement') continue;
    if (a.goals.some((g) => !isClosed(state, g.id))) return a.stage;
  }
  return null;
}
