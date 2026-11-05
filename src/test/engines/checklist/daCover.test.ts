import { describe, it, expect } from 'vitest';
import type { ChecklistState } from '../../../types/checklist';
import type { CredAttempt } from '../../../types/credentials';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import {
  AD_PLAYBOOKS,
  DA_COVER_LABEL,
  applicableGoals,
  applyTicks,
  daCoverChanges,
  daCoverGoals,
  domainAdminConfirmed,
  isCoverMarked,
  removeEntryTicks,
} from '../../../engines/checklist';

const host = (id: string, os: Host['os'], p: Partial<Host> = {}): Host => ({
  id, engagementId: 'e1', name: id, ip: '10.10.10.5', os, boardColumn: 'information-gathering', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (hostId: string, port: number): Service => ({
  id: `s${n++}`, hostId, port, protocol: 'tcp', state: 'open', nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 0, updatedAt: 0,
});
const attempt = (hostId: string, result: CredAttempt['result']): CredAttempt => ({
  id: `a-${hostId}-${result}`, engagementId: 'e1', credId: 'c1', usernameId: null, hostId, service: 'smb', port: 445,
  result, authMode: 'domain', detail: null, logEntryId: null, at: 1,
});
const engagement = { id: 'e1', kind: 'lab' } as Engagement;

const DC = host('DC', 'windows');
const WS01 = host('WS01', 'windows');
const LIN01 = host('LIN01', 'linux');
const WS02 = host('WS02', 'windows');
const servicesOf = (hosts: Host[]) =>
  new Map(hosts.map((h) => [h.id, h.id === 'DC' ? [svc('DC', 88), svc('DC', 389)] : []]));

const run = (hosts: Host[], attempts: CredAttempt[], byOwner: Map<string, ChecklistState> = new Map()) =>
  daCoverChanges({ engagement, hosts, servicesByHost: servicesOf(hosts), attempts, byOwner });

const coverable = (h: Host, hosts: Host[]) =>
  applicableGoals(h, engagement, hosts, servicesOf(hosts))
    .filter((g) => g.stage.id === 'privesc' || g.stage.id === 'loot')
    .flatMap((g) => g.goals.map((x) => x.id))
    .filter((id) => id !== 'h-pe-proof');

describe('domain admin cover', () => {
  const hosts = [DC, WS01, LIN01];

  it('no admin result on the DC means no cover', () => {
    expect(run(hosts, [attempt('DC', 'valid')]).size).toBe(0);
    expect(run(hosts, [attempt('WS01', 'admin')]).size).toBe(0);
    expect(domainAdminConfirmed(hosts, servicesOf(hosts), [attempt('DC', 'admin')])).toBe(true);
  });

  it('admin on the DC covers todo privesc and loot on DC and WS01', () => {
    const out = run(hosts, [attempt('DC', 'admin')]);
    const ws = out.get('WS01')!;
    const ids = coverable(WS01, hosts);
    expect(ids).toContain('h-loot-hashes');
    expect(ids).toContain('h-pe-win-privs');
    for (const id of ids) expect(ws[id]).toEqual({ status: 'na', auto: true });
    expect(ws['h-pe-proof']).toBeUndefined();
    expect(Object.keys(ws).every((id) => id.startsWith('h-pe-') || id.startsWith('h-loot-'))).toBe(true);
    expect(Object.keys(ws).sort()).toEqual([...ids].sort());
    expect(out.get('DC')!['h-loot-hashes']).toEqual({ status: 'na', auto: true });
    expect(isCoverMarked(ws['h-loot-hashes'])).toBe(true);
    expect(DA_COVER_LABEL).toBe('Covered by domain admin');
  });

  it('Linux hosts are not covered', () => {
    expect(run(hosts, [attempt('DC', 'admin')]).has('LIN01')).toBe(false);
  });

  it('the cover is applied to a state set by an earlier run only once', () => {
    const first = run(hosts, [attempt('DC', 'admin')]);
    expect(run(hosts, [attempt('DC', 'admin')], first).size).toBe(0);
  });

  const manual: ChecklistState = {
    'h-pe-win-privs': { status: 'done', auto: false },
    'h-pe-win-groups': { status: 'na', auto: false },
    'h-loot-sweep': { status: 'in_progress' },
    'h-loot-hashes': { status: 'todo', notes: 'check SAM' },
  };

  it('manual statuses and notes are never changed', () => {
    const out = run(hosts, [attempt('DC', 'admin')], new Map([['WS01', manual]])).get('WS01')!;
    expect(out['h-pe-win-privs']).toEqual({ status: 'done', auto: false });
    expect(out['h-pe-win-groups']).toEqual({ status: 'na', auto: false });
    expect(out['h-loot-sweep']).toEqual({ status: 'in_progress' });
    expect(out['h-loot-hashes']).toEqual({ status: 'na', auto: true, notes: 'check SAM' });
  });

  it('a hand-set To do on a covered goal is never re-covered', () => {
    const state: ChecklistState = {
      'h-pe-win-privs': { status: 'todo', auto: false, statusManual: true },
      'h-pe-win-groups': { status: 'todo' },
    };
    const out = run(hosts, [attempt('DC', 'admin')], new Map([['WS01', state]])).get('WS01')!;
    expect(out['h-pe-win-privs']).toEqual({ status: 'todo', auto: false, statusManual: true });
    expect(out['h-pe-win-groups']).toEqual({ status: 'na', auto: true });
    // Nothing else to change once the rest is covered.
    expect(run(hosts, [attempt('DC', 'admin')], new Map([['WS01', out]])).has('WS01')).toBe(false);
  });

  it('revert touches only cover-marked items', () => {
    const covered = run(hosts, [attempt('DC', 'admin')], new Map([['WS01', manual]])).get('WS01')!;
    const out = run(hosts, [], new Map([['WS01', covered]])).get('WS01')!;
    expect(out['h-loot-hashes']).toEqual({ status: 'todo', notes: 'check SAM' });
    expect(out['h-pe-win-services']).toEqual({ status: 'todo' });
    expect(out['h-pe-win-groups']).toEqual({ status: 'na', auto: false });
    expect(out['h-pe-win-privs']).toEqual({ status: 'done', auto: false });
    expect(out['h-loot-sweep']).toEqual({ status: 'in_progress' });
  });

  it('a host added later is covered', () => {
    const first = run(hosts, [attempt('DC', 'admin')]);
    const more = [...hosts, WS02];
    const out = run(more, [attempt('DC', 'admin')], first);
    expect([...out.keys()]).toEqual(['WS02']);
  });

  it('auto-tick on a covered item then evidence removal returns to todo', () => {
    const covered = run(hosts, [attempt('DC', 'admin')]).get('WS01')!;
    const ticked = applyTicks(covered, [{ ownerId: 'WS01', goalId: 'h-loot-hashes', entryId: 'x1', commandId: 'c' }], 5);
    expect(ticked['h-loot-hashes']).toMatchObject({ status: 'done', auto: true });
    expect(ticked['h-loot-hashes']!.autoFrom).toBeUndefined();
    const back = removeEntryTicks(ticked, 'x1');
    expect(back['h-loot-hashes']).toEqual({ status: 'todo' });
  });

  it('the Domain admin stage has no loot-all goal', () => {
    const ids = AD_PLAYBOOKS.flatMap((p) => p.goals.map((g) => g.id));
    expect(ids).not.toContain('e-ad-da-loot-all');
    expect(ids).toContain('e-ad-da-proof');
  });

  it('daCoverGoals lists the goals to cover and to revert, for the conditional store write', () => {
    const goals = (attempts: CredAttempt[], byOwner: Map<string, ChecklistState>) =>
      daCoverGoals({ engagement, hosts, servicesByHost: servicesOf(hosts), attempts, byOwner });
    const first = goals([attempt('DC', 'admin')], new Map([['WS01', manual]]));
    const ids = coverable(WS01, hosts);
    // Hand-set and worked items are not in the list; the untouched ones are, including the one with notes.
    expect(first.revert).toEqual([]);
    const ws = first.cover.filter((g) => g.ownerId === 'WS01').map((g) => g.goalId);
    expect(ws).toContain('h-loot-hashes');
    expect(ws).not.toContain('h-pe-win-privs');
    expect(ws).not.toContain('h-loot-sweep');
    expect(ws).not.toContain('h-pe-proof');
    expect(ws.length).toBe(ids.length - 3);
    expect(first.cover.some((g) => g.ownerId === 'LIN01')).toBe(false);
    // Once covered, nothing is left to cover; without the trigger the cover-marked items revert.
    const covered = run(hosts, [attempt('DC', 'admin')], new Map([['WS01', manual]]));
    const state = new Map([['WS01', covered.get('WS01')!]]);
    expect(goals([attempt('DC', 'admin')], state).cover.filter((g) => g.ownerId === 'WS01')).toEqual([]);
    const back = goals([], state);
    expect(back.cover).toEqual([]);
    expect(back.revert.map((g) => g.goalId)).toContain('h-loot-hashes');
    expect(back.revert.map((g) => g.goalId)).not.toContain('h-pe-win-groups');
  });
});
