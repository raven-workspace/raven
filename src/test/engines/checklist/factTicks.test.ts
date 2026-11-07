import { describe, it, expect } from 'vitest';
import type { ChecklistState } from '../../../types/checklist';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import { factTickGoals, isFactMarked } from '../../../engines/checklist';

const host = (p: Partial<Host> = {}): Host => ({
  id: 'h1', engagementId: 'e1', name: 'h1', ip: '10.10.10.5', os: null, boardColumn: 'information-gathering', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (p: Partial<Service> = {}): Service => ({
  id: `s${n++}`, hostId: 'h1', port: 80, protocol: 'tcp', state: 'open', nmapService: 'http', nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 0, updatedAt: 0, ...p,
});
const engagement = { id: 'e1', kind: 'lab' } as Engagement;
const run = (hosts: Host[], services: Service[], byOwner: Map<string, ChecklistState> = new Map()) =>
  factTickGoals({ engagement, hosts, servicesByHost: new Map([['h1', services]]), byOwner });
const ref = (goalId: string) => ({ ownerId: 'h1', goalId });
const marked: ChecklistState = { 'h-enum-identified': { status: 'done', auto: true, completedAt: 1 } };

describe('factTickGoals', () => {
  it('identified holds with confirmed versions and not with a ? service', () => {
    const ok = [svc({ confirmedProduct: 'nginx', confirmedVersion: '1.2' }), svc({ port: 22, nmapService: 'ssh', nmapVersion: 'OpenSSH 8' })];
    expect(run([host()], ok).done).toEqual([ref('h-enum-identified')]);
    const closed = svc({ port: 23, state: 'closed', nmapService: 'telnet?' });
    expect(run([host()], [...ok, closed]).done).toEqual([ref('h-enum-identified')]);
    expect(run([host()], [...ok, svc({ port: 9, nmapService: 'unknown?', nmapVersion: '1' })]).done).toEqual([]);
    expect(run([host()], [svc({ nmapService: 'tcpwrapped', nmapVersion: '1' })]).done).toEqual([]);
    expect(run([host()], [svc({ nmapService: 'tcpwrapped', confirmedProduct: 'x', confirmedVersion: '1' })]).done).toEqual([ref('h-enum-identified')]);
    expect(run([host()], [svc({ nmapVersion: null })]).done).toEqual([]);
    expect(run([host()], []).done).toEqual([]);
    expect(run([host()], [closed]).done).toEqual([]);
  });

  it('os fact follows host.os', () => {
    expect(run([host({ os: 'linux' })], []).done).toEqual([ref('h-enum-os')]);
    expect(run([host()], []).done).toEqual([]);
    const byOwner = new Map<string, ChecklistState>([['h1', { 'h-enum-os': { status: 'done', auto: true } }]]);
    expect(run([host()], [], byOwner).revert).toEqual([ref('h-enum-os')]);
    expect(run([host({ os: 'linux' })], [], byOwner)).toEqual({ done: [], revert: [] });
  });

  it('reverts when a new unidentified service appears', () => {
    const byOwner = new Map<string, ChecklistState>([['h1', marked]]);
    const good = svc({ nmapVersion: 'Apache 2' });
    expect(run([host()], [good], byOwner)).toEqual({ done: [], revert: [] });
    expect(run([host()], [good, svc({ port: 81, nmapService: 'http?' })], byOwner).revert).toEqual([ref('h-enum-identified')]);
  });

  it('leaves hand and logged items alone', () => {
    const hand = new Map<string, ChecklistState>([['h1', { 'h-enum-identified': { status: 'todo', statusManual: true } }]]);
    expect(run([host()], [svc({ nmapVersion: '1' })], hand).done).toEqual([]);
    const logged = new Map<string, ChecklistState>([['h1', { 'h-enum-identified': { status: 'done', auto: true, evidence: [{ entryId: 'x' }] } }]]);
    expect(run([host()], [], logged).revert).toEqual([]);
    expect(isFactMarked('h-enum-identified', marked['h-enum-identified'])).toBe(true);
    expect(isFactMarked('h-enum-full-tcp', marked['h-enum-identified'])).toBe(false);
  });
});
