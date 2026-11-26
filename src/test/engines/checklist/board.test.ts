import { describe, it, expect } from 'vitest';
import type { Host } from '../../../types/host';
import type { ChecklistState } from '../../../types/checklist';
import type { AccessGrant, AccessLevel } from '../../../types/credentials';
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

const cols = HOST_STAGES.map((s) => s.id);

const grant = (level: AccessLevel, hostId = 'h'): AccessGrant =>
  ({ id: `g-${level}-${hostId}`, engagementId: 'e', usernameId: 'u', hostId, level, via: 'ssh', logEntryId: null, at: 0 });
const footholdDone = () => done(...ids('initial-foothold'));

describe('derivedColumn', () => {
  it('information-gathering by default and while any goal there is open', () => {
    expect(derivedColumn(host, {}, all)).toBe('information-gathering');
    const partial = done(...ids('information-gathering').slice(1));
    expect(derivedColumn(host, partial, all)).toBe('information-gathering');
  });

  it('all detection steps closed stays in vulnerability-detection', () => {
    const state = {
      ...done(ids('information-gathering')[0]),
      ...Object.fromEntries(ids('information-gathering').slice(1).map((id) => [id, { status: 'na' as const }])),
      ...done(...ids('vulnerability-detection')),
    };
    expect(derivedColumn(host, state, all)).toBe('vulnerability-detection');
  });

  it('every information-gathering goal closed (done or na) moves to vulnerability-detection', () => {
    const state = { ...done(ids('information-gathering')[0]), ...closeAll('information-gathering') };
    expect(derivedColumn(host, state, all)).toBe('vulnerability-detection');
  });

  it('no applicable information-gathering goal stays information-gathering', () => {
    expect(derivedColumn(host, {}, all.filter((a) => a.stage.id !== 'information-gathering'))).toBe('information-gathering');
  });

  it('listener ticked moves to initial-foothold', () => {
    expect(derivedColumn(host, done('h-foot-listener'), all)).toBe('initial-foothold');
    expect(derivedColumn(host, done('h-foot-exploit'), all)).toBe('initial-foothold');
  });

  it('access user with nothing ticked is initial-foothold', () => {
    expect(derivedColumn({ ...host, access: 'user' }, {}, all)).toBe('initial-foothold');
  });

  it('root access with no proof ticked is post-exploitation, not initial-foothold', () => {
    expect(derivedColumn({ ...host, access: 'root' }, {}, all)).toBe('post-exploitation');
    expect(derivedColumn({ ...host, access: 'root' }, done('h-foot-shell'), all)).toBe('post-exploitation');
  });

  it('root access with proof and every late goal closed is reporting; late goals open stays post-exploitation', () => {
    const root = { ...host, access: 'root' as const };
    const closed = { ...closeAll('post-exploitation', 'reporting'), ...done('h-pe-proof') };
    expect(derivedColumn(root, closed, all)).toBe('reporting');
    expect(derivedColumn(root, done('h-pe-proof'), all)).toBe('post-exploitation');
  });

  it('user access is unchanged by the root rule', () => {
    expect(derivedColumn({ ...host, access: 'user' }, {}, all)).toBe('initial-foothold');
    expect(derivedColumn({ ...host, access: 'user' }, done('h-foot-shell'), all)).toBe('privilege-escalation');
  });

  it('a shell goal or local.txt moves to privilege-escalation', () => {
    for (const g of ['h-foot-shell', 'h-foot-creds', 'h-stab-shell', 'h-foot-arrived', 'h-orient-proof']) {
      expect(derivedColumn(host, done(g), all), g).toBe('privilege-escalation');
    }
  });

  it('h-stab-shell done is privilege-escalation even with foothold steps open', () => {
    expect(derivedColumn(host, done('h-stab-shell'), all)).toBe('privilege-escalation');
    expect(derivedColumn({ ...host, access: 'user' }, done('h-stab-shell'), all)).toBe('privilege-escalation');
  });

  it('proof done with post-exploitation open is post-exploitation', () => {
    expect(derivedColumn(host, done('h-pe-proof'), all)).toBe('post-exploitation');
  });

  it('proof done, post-exploitation and reporting closed is reporting', () => {
    const state = { ...done('h-pe-proof'), ...closeAll('post-exploitation', 'reporting') };
    expect(derivedColumn(host, state, all)).toBe('reporting');
    const oneOpen = { ...state, [ids('reporting')[0]]: { status: 'todo' as const } };
    expect(derivedColumn(host, oneOpen, all)).toBe('post-exploitation');
  });

  it('open pivot goals do not block reporting', () => {
    const state = { ...done('h-pe-proof'), ...closeAll('post-exploitation', 'reporting') };
    expect(ids('lateral-movement').length).toBeGreaterThan(0);
    expect(derivedColumn(host, state, all)).toBe('reporting');
  });

  it('a root, SYSTEM or admin grant with only foothold goals done is post-exploitation', () => {
    for (const level of ['admin', 'system'] as const) {
      expect(derivedColumn(host, footholdDone(), all, [grant(level)]), level).toBe('post-exploitation');
    }
    expect(derivedColumn(host, {}, all, [grant('admin')])).toBe('post-exploitation');
  });

  it('an elevated grant with every goal done is reporting', () => {
    expect(derivedColumn(host, done(...HOST_STAGES.flatMap((s) => s.goals.map((g) => g.id))), all, [grant('system')])).toBe('reporting');
  });

  it('a user grant derives as without one', () => {
    for (const state of [{}, footholdDone(), done('h-foot-shell')]) {
      expect(derivedColumn(host, state, all, [grant('user')])).toBe(derivedColumn(host, state, all));
    }
    expect(derivedColumn(host, footholdDone(), all, [grant('user')])).toBe('privilege-escalation');
  });

  it("another host's elevated grant does not move this host", () => {
    expect(derivedColumn(host, footholdDone(), all, [grant('admin', 'other')])).toBe('privilege-escalation');
  });

  it('proof done and no post-exploitation or reporting goals apply is reporting', () => {
    const only = all.filter((a) => !['post-exploitation', 'reporting'].includes(a.stage.id));
    expect(derivedColumn(host, done('h-pe-proof'), only)).toBe('reporting');
  });
});

describe('currentStage', () => {
  it('is the first applicable stage with an open goal', () => {
    expect(currentStage({}, all)?.id).toBe('information-gathering');
    expect(currentStage(closeAll('information-gathering'), all)?.id).toBe('vulnerability-detection');
  });

  it('skips stages with no applicable goals and returns null when everything is closed', () => {
    const empty = [{ stage: HOST_STAGES[0], goals: [] }, ...all.slice(1)];
    expect(currentStage({}, empty)?.id).toBe('vulnerability-detection');
    expect(currentStage(closeAll(...cols), all)).toBeNull();
  });

  it('skips engagement-placed stages', () => {
    const state = closeAll(...cols.filter((c) => c !== 'lateral-movement'));
    expect(currentStage(state, all)).toBeNull();
  });
});
