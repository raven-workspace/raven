import { describe, it, expect } from 'vitest';
import type { Host } from '../../../types/host';
import type { ChecklistState } from '../../../types/checklist';
import { HOST_STAGES, currentStage, derivedColumn } from '../../../engines/checklist';

const host: Host = {
  id: 'h', engagementId: 'e', name: 'ms01', ip: '10.0.0.5', os: 'windows', boardColumn: 'information-gathering', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
};
/** Every goal of every stage: the loosest "all applicable" set. */
const all = HOST_STAGES.map((stage) => ({ stage, goals: stage.goals }));
const ids = (stageId: string) => HOST_STAGES.find((s) => s.id === stageId)!.goals.map((g) => g.id);
const done = (...goalIds: string[]): ChecklistState => Object.fromEntries(goalIds.map((id) => [id, { status: 'done' as const }]));
const closeAll = (...stageIds: string[]): ChecklistState =>
  Object.fromEntries(stageIds.flatMap(ids).map((id) => [id, { status: 'na' as const }]));

describe('derivedColumn', () => {
  it('enumerate by default and while any enumerate goal is open', () => {
    expect(derivedColumn(host, {}, all)).toBe('information-gathering');
    const partial = done(...ids('enumerate').slice(1));
    expect(derivedColumn(host, partial, all)).toBe('information-gathering');
  });

  it('foothold once every applicable enumerate goal is closed (done or na)', () => {
    const state = { ...done(ids('enumerate')[0]), ...Object.fromEntries(ids('enumerate').slice(1).map((id) => [id, { status: 'na' as const }])) };
    expect(derivedColumn(host, state, all)).toBe('vulnerability-detection');
  });

  it('no applicable enumerate goal stays enumerate', () => {
    expect(derivedColumn(host, {}, all.filter((a) => a.stage.id !== 'enumerate'))).toBe('information-gathering');
  });

  it('privesc once a foothold goal or local.txt is done', () => {
    for (const g of ['h-foot-shell', 'h-foot-creds', 'h-foot-arrived', 'h-orient-proof']) {
      expect(derivedColumn(host, done(g), all), g).toBe('privilege-escalation');
    }
    expect(derivedColumn(host, done('h-foot-exploit'), all)).toBe('information-gathering');
  });

  it('local.txt alone moves to privesc even with enumeration open', () => {
    expect(derivedColumn(host, done('h-orient-proof'), all)).toBe('privilege-escalation');
  });

  it('loot once proof is done but loot/pivot/closeout goals are open', () => {
    expect(derivedColumn(host, done('h-pe-proof'), all)).toBe('post-exploitation');
  });

  it('done when proof is done and every loot, pivot and closeout goal is closed', () => {
    const state = { ...done('h-pe-proof'), ...closeAll('loot', 'pivot', 'closeout') };
    expect(derivedColumn(host, state, all)).toBe('reporting');
    const oneOpen = { ...state, [ids('closeout')[0]]: { status: 'todo' as const } };
    expect(derivedColumn(host, oneOpen, all)).toBe('post-exploitation');
  });

  it('done when proof is done and no loot, pivot or closeout goals apply', () => {
    const only = all.filter((a) => !['loot', 'pivot', 'closeout'].includes(a.stage.id));
    expect(derivedColumn(host, done('h-pe-proof'), only)).toBe('reporting');
  });
});

describe('currentStage', () => {
  it('is the first applicable stage with an open goal', () => {
    expect(currentStage({}, all)?.id).toBe('enumerate');
    expect(currentStage(closeAll('enumerate'), all)?.id).toBe('foothold');
  });

  it('skips stages with no applicable goals and returns null when everything is closed', () => {
    const empty = [{ stage: HOST_STAGES[0], goals: [] }, ...all.slice(1)];
    expect(currentStage({}, empty)?.id).toBe('foothold');
    expect(currentStage(closeAll(...HOST_STAGES.map((s) => s.id)), all)).toBeNull();
  });
});
