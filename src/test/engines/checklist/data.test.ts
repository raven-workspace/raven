import { describe, it, expect } from 'vitest';
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP, HOST_GOALS, HOST_STAGES } from '../../../engines/checklist';

const ENGAGEMENT_GOALS = [...ENGAGEMENT_SETUP, ...AD_PLAYBOOKS.flatMap((p) => p.goals)];
const SPEC_ORDER = ['enumerate', 'foothold', 'stabilize', 'orient', 'privesc', 'loot', 'pivot', 'closeout'];

describe('checklist data', () => {
  it('goal ids are unique across host and engagement data', () => {
    const ids = [...HOST_GOALS, ...ENGAGEMENT_GOALS].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every stage id is in the spec order', () => {
    const stageIds = HOST_STAGES.map((s) => s.id);
    for (const id of stageIds) expect(SPEC_ORDER, id).toContain(id);
    expect(stageIds).toEqual(SPEC_ORDER.filter((id) => stageIds.includes(id)));
    for (const g of HOST_GOALS) expect(SPEC_ORDER, g.id).toContain(g.stage);
  });

  it('no kinds names challenge-lab or real', () => {
    const kinds = [...HOST_GOALS, ...ENGAGEMENT_GOALS].flatMap((g) => g.applies?.kinds ?? []) as string[];
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain('challenge-lab');
    expect(kinds).not.toContain('real');
    for (const k of kinds) expect(['exam-sim', 'lab', 'client']).toContain(k);
  });
});
