import { describe, expect, it } from 'vitest';
import type { CredAttempt, Username } from '../../../types/credentials';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { Hop } from '../../../types/network';
import type { Service } from '../../../types/service';
import type { ReportData } from '../../../engines/report/types';
import { TEST_LIBRARY } from '../../support/library';
import {
  adSetHosts,
  daCoverChanges,
  dcFillChoice,
  dcForFill,
  domainAdminConfirmed,
  engagementFacts,
  findDc,
  hostFacts,
  isOpenService,
  isStrictlyOpen,
  openPorts,
} from '../../../engines/checklist';
import { playbookTriggers } from '../../../engines/credentials/state';
import { engagementStuck } from '../../../engines/stuck';
import { domainController } from '../../../engines/report';
import { tokenSuggestions } from '../../../features/palette/suggest';

// Synthetic hosts only (RFC 5737). `adSetEffective` is set as the store would compute it: the switch, else 88 and 389 `open`.
const host = (id: string, p: Partial<Host> = {}): Host => ({
  id, engagementId: 'e1', name: id, ip: null, os: 'windows', boardColumn: 'information-gathering', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (hostId: string, port: number, state = 'open', protocol: Service['protocol'] = 'tcp'): Service => ({
  id: `s${n++}`, hostId, port, protocol, state, nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 0, updatedAt: 0,
});
const kerberosLdap = (hostId: string, state = 'open', protocol: Service['protocol'] = 'tcp') => [
  svc(hostId, 88, state, protocol), svc(hostId, 389, state, protocol),
];
const admin = (hostId: string): CredAttempt => ({
  id: `a-${hostId}`, engagementId: 'e1', credId: 'c1', usernameId: null, hostId, service: 'smb', port: 445,
  result: 'admin', authMode: 'domain', detail: null, logEntryId: null, at: 1,
});
const engagement = { id: 'e1', kind: 'exam-sim', msfHostId: null, domain: null } as unknown as Engagement;
const byHost = (entries: [string, Service[]][]) => new Map(entries);

/** A host scanned over UDP: 88 and 389 come back `open|filtered`, so the store leaves it out of the AD set. */
const udp = host('udp', { ip: '192.0.2.20' });
const udpServices: [string, Service[]] = ['udp', kerberosLdap('udp', 'open|filtered', 'udp')];

/** The exam AD set: three machines switched in, and only DC01 has Kerberos and LDAP open. */
const dc01 = host('dc01', { ip: '192.0.2.10', adSet: true, adSetEffective: true });
const ms01 = host('ms01', { ip: '192.0.2.11', adSet: true, adSetEffective: true });
const ms02 = host('ms02', { ip: '192.0.2.12', adSet: true, adSetEffective: true });
const exam = [dc01, ms01, ms02];
const examServices = byHost([['dc01', [...kerberosLdap('dc01'), svc('dc01', 445)]], ['ms01', [svc('ms01', 445)]], ['ms02', [svc('ms02', 5985)]]]);

describe('the open test for the AD set and the DC', () => {
  it('counts only state exactly open; isOpenService keeps open|filtered', () => {
    expect(isStrictlyOpen(svc('x', 88, 'open'))).toBe(true);
    expect(isStrictlyOpen(svc('x', 88, 'open|filtered'))).toBe(false);
    expect(isStrictlyOpen(svc('x', 88, 'filtered'))).toBe(false);
    expect(isStrictlyOpen(svc('x', 88, 'closed'))).toBe(false);
    expect(isOpenService(svc('x', 88, 'open|filtered'))).toBe(true);
    expect([...openPorts(udpServices[1])].sort((a, b) => a - b)).toEqual([88, 389]);
  });
});

describe('AD set membership', () => {
  it('is the store flag, never the ports', () => {
    const switchedOut = host('out', { adSet: false, adSetEffective: false });
    expect(adSetHosts([udp, switchedOut, dc01, ms01]).map((h) => h.id)).toEqual(['dc01', 'ms01']);
    expect(engagementFacts(engagement, [udp, switchedOut]).domainJoined).toBe(false);
    expect(engagementFacts(engagement, [udp, ms01]).domainJoined).toBe(true);
  });
});

describe('the DC', () => {
  it('a host with 88 and 389 only as UDP open|filtered is not the DC, and domain admin on it covers nothing', () => {
    const hosts = [udp, host('ws', { ip: '192.0.2.21' })];
    const services = byHost([udpServices, ['ws', [svc('ws', 445)]]]);
    expect(findDc(hosts, services)).toBeNull();
    expect(domainAdminConfirmed(hosts, services, [admin('udp')])).toBe(false);
    expect(daCoverChanges({ engagement, hosts, servicesByHost: services, attempts: [admin('udp')], byOwner: new Map() }).size).toBe(0);
    // Even switched into the AD set by hand, open|filtered is not open.
    const switchedIn = { ...udp, adSet: true, adSetEffective: true };
    expect(findDc([switchedIn], services)).toBeNull();
  });

  it('a host with 88 and 389 open that is switched out of the AD set is not the DC', () => {
    const out = host('out', { adSet: false, adSetEffective: false });
    const services = byHost([['out', kerberosLdap('out')]]);
    expect(findDc([out], services)).toBeNull();
    expect(dcFillChoice([out], services).dc?.id).toBe('out'); // the fill's Kerberos fallback still finds it
  });

  it('in an exam AD set of three, the one member with 88 and 389 open is the DC; domain admin on it covers the others', () => {
    expect(findDc(exam, examServices)?.id).toBe('dc01');
    expect(dcFillChoice(exam, examServices)).toEqual({ dc: dc01, byName: false });
    expect(domainAdminConfirmed(exam, examServices, [admin('dc01')])).toBe(true);
    expect(domainAdminConfirmed(exam, examServices, [admin('ms01')])).toBe(false);
    const covered = daCoverChanges({ engagement, hosts: exam, servicesByHost: examServices, attempts: [admin('dc01')], byOwner: new Map() });
    expect([...covered.keys()].sort()).toEqual(['dc01', 'ms01', 'ms02']);
    expect(covered.get('ms02')?.['h-loot-domain']).toEqual({ status: 'na', auto: true });
    const t = playbookTriggers({ engagement, hosts: exam, servicesByHost: examServices, credentials: [], attempts: [admin('dc01')], hops: [] });
    expect(t.da).toBe(true);
    const hop = { id: 'hp', engagementId: 'e1', fromHostId: 'ms01', toHostId: 'dc01' } as Hop;
    expect(playbookTriggers({ engagement, hosts: exam, servicesByHost: examServices, credentials: [], attempts: [], hops: [hop] }).da).toBe(true);
  });

  it('two AD set members with 88 and 389 open: no DC, but the fill still picks the one named like a DC', () => {
    const a = host('a', { name: 'corp-dc1', ip: '192.0.2.30', adSetEffective: true });
    const b = host('b', { name: 'files', ip: '192.0.2.31', adSetEffective: true });
    const services = byHost([['a', kerberosLdap('a')], ['b', kerberosLdap('b')]]);
    expect(findDc([a, b], services)).toBeNull();
    expect(domainAdminConfirmed([a, b], services, [admin('a')])).toBe(false);
    expect(dcForFill([a, b], services)?.id).toBe('a');
    expect(dcFillChoice([a, b], services).byName).toBe(true);
  });
});

describe('domainJoined', () => {
  it('a Windows host with no 88 or 389 is joined when the engagement has any AD set member', () => {
    const ws = host('ws', { os: 'windows' });
    const services = byHost([['ws', [svc('ws', 445)]], ['ms01', [svc('ms01', 445)]]]);
    expect(hostFacts(ws, engagement, [ws, ms01], services).domainJoined).toBe(true);
    expect(hostFacts(ws, engagement, [ws], services).domainJoined).toBe(false);
  });

  it('an AD set member is joined, whatever its OS or ports', () => {
    const lin = host('lin', { os: 'linux', adSet: true, adSetEffective: true });
    expect(hostFacts(lin, engagement, [lin], byHost([['lin', [svc('lin', 22)]]])).domainJoined).toBe(true);
  });

  it("a non-AD host whose only 389 is open|filtered is not joined, and the host's own ports no longer count", () => {
    const ldap = host('ldap', { os: null });
    expect(hostFacts(ldap, engagement, [ldap], byHost([['ldap', [svc('ldap', 389, 'open|filtered', 'udp')]]])).domainJoined).toBe(false);
    const out = host('out', { os: 'linux', adSet: false, adSetEffective: false });
    expect(hostFacts(out, engagement, [out, ms01], byHost([['out', kerberosLdap('out')]])).domainJoined).toBe(false);
  });
});

describe('callers that ask "is there AD here" use membership', () => {
  const uname = (id: string): Username => ({ id, engagementId: 'e1', username: `u-${id}`, domain: null, sourceHostId: null, source: null, createdAt: 0 });

  it('the credentials state opens nocreds for an AD set member with no open 88 or 389, not for a UDP-only host', () => {
    const t = (hosts: Host[], services: Map<string, Service[]>) =>
      playbookTriggers({ engagement, hosts, servicesByHost: services, credentials: [], attempts: [], hops: [] }).nocreds;
    expect(t([ms01], byHost([['ms01', [svc('ms01', 445)]]]))).toBe(true);
    expect(t([udp], byHost([udpServices]))).toBe(false);
  });

  it("the Stuck check's AS-REP hint follows membership", () => {
    const stuck = (hosts: Host[], services: Map<string, Service[]>) =>
      engagementStuck({
        engagement, hosts, servicesByHost: services, byOwner: new Map(), credentials: [], attempts: [],
        usernames: [uname('u1')], tunnels: [], library: TEST_LIBRARY,
      }).filter((l) => l.text.includes('AS-REP'));
    expect(stuck([ms01], byHost([['ms01', [svc('ms01', 445)]]]))).toHaveLength(1);
    expect(stuck([udp], byHost([udpServices]))).toEqual([]);
  });

  it("⌘K's AD role lists the AD set; the DC role is the fill's DC", () => {
    const ctx = {
      engagement, hosts: [udp, ...exam], toolkit: [], credentials: [],
      services: [...udpServices[1], ...[...examServices.values()].flat()],
    };
    const dcIp = tokenSuggestions('DC_IP', ctx);
    expect(dcIp[0]).toEqual({ value: '192.0.2.10', hint: 'dc01', role: 'DC' });
    expect(dcIp.filter((s) => s.role === 'AD').map((s) => s.hint)).toEqual(['ms01', 'ms02']);
    expect(dcIp.find((s) => s.value === '192.0.2.20')?.role).toBeUndefined();
  });
});

describe('the report names the same DC as the checklist', () => {
  const data = (hosts: Host[], services: Service[], hops: Hop[] = []): ReportData =>
    ({ hosts, services, hops, grants: [], log: [] }) as unknown as ReportData;
  const hopTo = (toHostId: string, at: number) => ({ id: `hop-${toHostId}`, fromHostId: 'ms01', toHostId, logEntryId: null, at }) as unknown as Hop;

  it('uses the DC rule, not 88 and 389 in any state', () => {
    const services = [...examServices.values()].flat();
    expect(domainController(data(exam, services), ['dc01', 'ms01', 'ms02'])).toBe('dc01');
    // ms01 has 88 and 389 only closed: it is not the DC, even listed first.
    const closed = [svc('ms01', 88, 'closed'), svc('ms01', 389, 'closed'), ...services];
    expect(domainController(data(exam, closed), ['ms01', 'dc01', 'ms02'])).toBe('dc01');
    // Two members with 88 and 389 open: no DC by the rule, so the hop fallback names one.
    const two = [...services, ...kerberosLdap('ms02')];
    expect(domainController(data(exam, two, [hopTo('ms02', 5)]), ['dc01', 'ms01', 'ms02'])).toBe('ms02');
  });

  it('with no scanned DC, falls back to the last AD set host a hop reached', () => {
    expect(domainController(data(exam, [], [hopTo('ms02', 5), hopTo('dc01', 9)]), ['dc01', 'ms01', 'ms02'])).toBe('dc01');
    const udpOnly = kerberosLdap('dc01', 'open|filtered', 'udp');
    expect(domainController(data(exam, udpOnly, [hopTo('ms02', 5)]), ['dc01', 'ms01', 'ms02'])).toBe('ms02');
    expect(domainController(data(exam, [], []), ['dc01', 'ms01', 'ms02'])).toBeNull();
  });
});
