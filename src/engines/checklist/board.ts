import type { BoardColumn, Host } from '../../types/host';
import type { ChecklistState } from '../../types/checklist';
import type { ChecklistGoal, ChecklistStage } from './types';

type Applicable = { stage: ChecklistStage; goals: ChecklistGoal[] }[];

const FOOTHOLD_GOALS = ['h-foot-shell', 'h-foot-creds', 'h-foot-arrived', 'h-orient-proof'];
const LATE_STAGES = ['loot', 'pivot', 'closeout'];

const isDone = (state: ChecklistState, goalId: string) => state[goalId]?.status === 'done';
const isClosed = (state: ChecklistState, goalId: string) => {
  const s = state[goalId]?.status;
  return s === 'done' || s === 'na';
};

/**
 * The board column a host's checklist implies. Proof decides the late columns, access goals decide privesc,
 * and Foothold means enumeration is finished (every applicable enumerate goal done or N/A, and at least one).
 */
export function derivedColumn(_host: Host, state: ChecklistState, applicable: Applicable): BoardColumn {
  if (isDone(state, 'h-pe-proof')) {
    const late = applicable.filter((a) => LATE_STAGES.includes(a.stage.id)).flatMap((a) => a.goals);
    return late.every((g) => isClosed(state, g.id)) ? 'done' : 'loot';
  }
  if (FOOTHOLD_GOALS.some((id) => isDone(state, id))) return 'privesc';
  const enumerate = applicable.filter((a) => a.stage.id === 'enumerate').flatMap((a) => a.goals);
  if (enumerate.length > 0 && enumerate.every((g) => isClosed(state, g.id))) return 'foothold';
  return 'enumerate';
}

/** The first applicable stage with an open goal, or null when everything applicable is closed. */
export function currentStage(state: ChecklistState, applicable: Applicable): ChecklistStage | null {
  for (const a of applicable) {
    if (a.goals.some((g) => !isClosed(state, g.id))) return a.stage;
  }
  return null;
}
