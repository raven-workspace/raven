import { describe, it, expect } from 'vitest';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import {
  AD_PLAYBOOKS,
  ENGAGEMENT_SETUP,
  HOST_GOALS,
  HOST_STAGES,
  adHosts,
  applicableGoals,
  engagementFacts,
  findDcHost,
  goalApplies,
  hostViewStages,
  hostFacts,
  openPorts,
  serviceNames,
} from '../../../engines/checklist';

const host = (p: Partial<Host> = {}): Host => ({
  id: 'h1', engagementId: 'e1', name: 'ms01', ip: '10.10.10.5', os: null, boardColumn: 'information-gathering', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});

let n = 0;
const svc = (port: number, nmapService: string | null = null, extra: Partial<Service> = {}): Service => ({
  id: `s${n++}`, hostId: 'h1', port, protocol: 'tcp', state: 'open', nmapService, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 0, updatedAt: 0, ...extra,
});
const onPorts = (...ports: number[]) => ports.map((p) => svc(p));

/** Applicable goals for one host with the given scanned services, as the only host unless `others` are given. */
const goalsFor = (h: Host, services: Service[] = [], engagement: { kind: 'exam-sim' | 'lab' | 'client' } | null = null) =>
  applicableGoals(h, engagement, [h], new Map([[h.id, services]]));

type Result = ReturnType<typeof goalsFor>;
const ids = (r: Result, stage: string) => r.find((x) => x.stage.id === stage)?.goals.map((g) => g.id) ?? [];
const all = (r: Result) => r.flatMap((x) => x.goals.map((g) => g.id));

describe('applicableGoals', () => {
  it('unknown ports show only scan goals with the import hint', () => {
    const r = goalsFor(host());
    expect(ids(r, 'information-gathering')).toEqual(['h-enum-full-tcp', 'h-enum-versions', 'h-enum-udp']);
    expect(r.find((x) => x.stage.id === 'information-gathering')?.hint).toBe('Import a scan to see service steps');
  });

  it('windows host with 445 and 5985 gets smb and remote goals and windows privesc only', () => {
    const r = goalsFor(host({ os: 'windows' }), onPorts(445, 5985));
    const enumIds = ids(r, 'information-gathering');
    expect(enumIds).toContain('h-enum-smb');
    expect(enumIds).toContain('h-enum-remote');
    expect(enumIds.some((i) => i.startsWith('h-enum-web-'))).toBe(false);
    const pe = ids(r, 'privilege-escalation');
    expect(pe.some((i) => i.startsWith('h-pe-lin-'))).toBe(false);
    expect(pe[0]).toBe('h-pe-win-manual');
    // kernel is the last check; capturing proof.txt closes the stage
    expect(pe.slice(-2)).toEqual(['h-pe-win-kernel', 'h-pe-proof']);
  });

  it('proof.txt is the last privesc goal on linux too, and hidden with the stage when the OS is unknown', () => {
    const pe = ids(goalsFor(host({ os: 'linux' }), onPorts(22)), 'privilege-escalation');
    expect(pe.slice(-2)).toEqual(['h-pe-lin-kernel', 'h-pe-proof']);
    const unknown = goalsFor(host(), onPorts(22));
    expect(ids(unknown, 'privilege-escalation')).toEqual([]);
    expect(unknown.find((x) => x.stage.id === 'privilege-escalation')?.hint).toBe('Set the OS to see privesc steps');
  });

  it('local.txt proof follows the shell upgrade in initial-foothold; reporting has no flag goal', () => {
    const r = goalsFor(host({ os: 'linux' }), onPorts(22));
    const foot = ids(r, 'initial-foothold');
    expect(foot.indexOf('h-stab-shell')).toBeLessThan(foot.indexOf('h-orient-proof'));
    expect(ids(r, 'reporting')).toEqual(['h-close-notes']);
    expect(HOST_GOALS.some((g) => g.id === 'h-close-flags')).toBe(false);
    expect(HOST_GOALS.find((g) => g.id === 'h-orient-proof')?.title).toBe('Capture local.txt with proof in one frame');
    expect(HOST_GOALS.find((g) => g.id === 'h-pe-proof')?.title).toBe('Capture proof.txt as root/SYSTEM in one frame');
  });

  it('initial-foothold stage lists goals in order', () => {
    const r = goalsFor(host({ os: 'windows' }), onPorts(445, 5985, 1433));
    expect(ids(r, 'initial-foothold')).toEqual([
      'h-foot-listener', 'h-foot-payload', 'h-foot-port', 'h-foot-exploit', 'h-foot-shell', 'h-foot-service', 'h-foot-creds',
      'h-foot-client', 'h-stab-shell', 'h-orient-identity', 'h-orient-proof', 'h-foot-arrived',
    ]);
  });

  it('linux web host gets the web steps in vulnerability-detection and a web-shell upgrade', () => {
    const r = goalsFor(host({ os: 'linux' }), onPorts(22, 80));
    expect(ids(r, 'vulnerability-detection')).toEqual([
      'h-enum-exploits', 'h-vuln-websearch', 'h-vuln-version-gate', 'h-foot-web-auth', 'h-vuln-nse', 'h-foot-web-vulns',
      'h-vuln-spray', 'h-vuln-crack', 'h-foot-brute', 'h-vuln-rank',
    ]);
    expect(ids(r, 'initial-foothold')).toContain('h-foot-webshell');
    expect(ids(r, 'initial-foothold')).not.toContain('h-foot-service');
  });

  it('new per-service goals follow their ports and services', () => {
    const at = (...ports: number[]) => ids(goalsFor(host({ os: 'linux' }), onPorts(...ports)), 'information-gathering');
    expect(at(22)).toContain('h-enum-ssh');
    expect(at(88)).toContain('h-enum-kerberos');
    expect(at(143)).toContain('h-enum-mail');
    expect(at(69)).toContain('h-enum-tftp');
    expect(at(873)).toContain('h-enum-rsync');
    expect(at(2375)).toContain('h-enum-docker');
    expect(at(8080)).toContain('h-enum-tomcat');
    expect(ids(goalsFor(host({ os: 'linux' }), [svc(9999, 'jenkins')]), 'information-gathering')).toContain('h-enum-tomcat');
    expect(at(445)).not.toContain('h-enum-ssh');
  });

  it('domain steps appear only on a domain-joined host', () => {
    const joined = ids(goalsFor(host({ os: 'windows' }), onPorts(88, 389)), 'information-gathering');
    expect(joined).toContain('h-enum-ad-users');
    expect(ids(goalsFor(host({ os: 'windows' }), onPorts(445)), 'information-gathering')).not.toContain('h-enum-ad-users');
  });

  it('an unscanned host shows no vulnerability-detection steps, and reporting lists notes before cleanup', () => {
    const r = goalsFor(host(), [], { kind: 'client' });
    expect(ids(r, 'vulnerability-detection')).toEqual(['h-vuln-crack']);
    expect(ids(r, 'reporting')).toEqual(['h-close-notes', 'h-close-cleanup']);
  });

  it('exam-only Metasploit step appears only in exam-sim', () => {
    const vd = (e: { kind: 'exam-sim' | 'lab' | 'client' }) => ids(goalsFor(host(), onPorts(80), e), 'vulnerability-detection');
    expect(vd({ kind: 'exam-sim' })).toContain('h-vuln-msf');
    expect(vd({ kind: 'lab' })).not.toContain('h-vuln-msf');
  });

  it('rpcbind alone does not show service abuse', () => {
    const foot = ids(goalsFor(host({ os: 'linux' }), onPorts(22, 80, 111)), 'initial-foothold');
    expect(foot).not.toContain('h-foot-service');
  });

  it('nfs on 2049 shows service abuse', () => {
    expect(ids(goalsFor(host({ os: 'linux' }), onPorts(22, 111, 2049)), 'initial-foothold')).toContain('h-foot-service');
  });

  it('service abuse follows mssql, postgresql, redis and mysql only among databases', () => {
    for (const port of [1433, 5432, 6379, 3306]) {
      expect(ids(goalsFor(host({ os: 'linux' }), onPorts(port)), 'initial-foothold'), String(port)).toContain('h-foot-service');
    }
    for (const port of [1521, 27017, 5984, 9200]) {
      expect(ids(goalsFor(host({ os: 'linux' }), onPorts(port)), 'initial-foothold'), String(port)).not.toContain('h-foot-service');
    }
  });

  it('foothold goals follow scanned services and need a scan for service routes', () => {
    const odd = goalsFor(host({ os: 'linux' }), [svc(2222, 'ssh'), svc(63790, 'redis')]);
    const foot = ids(odd, 'initial-foothold');
    expect(foot).toContain('h-foot-creds');
    expect(foot).toContain('h-foot-service');
    expect(ids(odd, 'vulnerability-detection')).toContain('h-foot-brute');
    expect(ids(goalsFor(host()), 'initial-foothold')).not.toContain('h-foot-service');
  });

  it('matches services from the scan, including smb and http aliases', () => {
    const r = all(goalsFor(host({ os: 'linux' }), [svc(8081, 'ssl/http'), svc(4455, 'microsoft-ds')]));
    expect(r).toContain('h-enum-web-stack');
    expect(r).toContain('h-enum-smb');
    expect(r).toContain('h-enum-exploits');
  });

  it('winrm and rpc-over-http do not count as web', () => {
    const dc = goalsFor(host({ os: 'windows' }), [
      svc(593, 'ncacn_http'),
      svc(5985, 'http', { nmapVersion: 'Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)' }),
      svc(47001, 'http', { nmapVersion: 'Microsoft HTTPAPI httpd 2.0' }),
      svc(445, 'microsoft-ds'), svc(88, 'kerberos-sec'), svc(389, 'ldap'),
    ]);
    expect(all(dc).filter((i) => i.startsWith('h-enum-web-') || i.startsWith('h-foot-web-'))).toEqual([]);
    const web = goalsFor(host({ os: 'linux' }), [svc(8081, 'http', { nmapVersion: 'Apache httpd 2.4.58' })]);
    expect(all(web)).toContain('h-enum-web-stack');
  });

  it('ignores filtered service rows', () => {
    const r = goalsFor(host({ os: 'linux' }), [svc(8080, 'http', { state: 'filtered' })]);
    expect(all(r).filter((i) => i.includes('-web-'))).toEqual([]);
  });

  it('confirmed identity drives applicability', () => {
    // nmap guessed "ppp" but the operator confirmed Apache: the web goals apply.
    const confirmedWeb = goalsFor(host({ os: 'linux' }), [svc(8080, 'ppp', { confirmedProduct: 'Apache httpd' })]);
    expect(all(confirmedWeb)).toContain('h-enum-web-stack');
    // nmap said http but the operator confirmed it is something else: the web goals do not apply.
    const notWeb = goalsFor(host({ os: 'linux' }), [svc(80, 'http', { confirmedProduct: 'CouchDB' })]);
    expect(all(notWeb)).not.toContain('h-enum-web-stack');
  });

  it('confirmed non-web product on a web port does not trigger web goals', () => {
    const r = all(goalsFor(host({ os: 'linux' }), [svc(3000, 'ppp', { confirmedProduct: 'CouchDB' })]));
    expect(r).not.toContain('h-enum-web-stack');
    expect(r).toContain('h-enum-exploits');
  });

  it('confirmed Microsoft HTTPAPI on 5985 is not web', () => {
    const r = all(goalsFor(host({ os: 'windows' }), [svc(5985, 'http', { confirmedProduct: 'Microsoft HTTPAPI httpd 2.0' })]));
    expect(r.filter((i) => i.startsWith('h-enum-web-') || i.startsWith('h-foot-web-'))).toEqual([]);
    expect([...serviceNames([svc(47001, 'http', { confirmedProduct: 'nginx' })])]).toEqual([]);
  });

  it('unknown OS hides privesc with a set-the-OS hint', () => {
    const r = goalsFor(host(), onPorts(22));
    const pe = r.find((x) => x.stage.id === 'privilege-escalation');
    expect(pe?.goals).toEqual([]);
    expect(pe?.hint).toBe('Set the OS to see privesc steps');
  });

  it('maps a linux host to linux privesc and an other OS to none', () => {
    expect(ids(goalsFor(host({ os: 'linux' })), 'privilege-escalation')[0]).toBe('h-pe-lin-manual');
    expect(ids(goalsFor(host({ os: 'other' })), 'privilege-escalation')).toEqual([]);
  });

  it('lateral-movement stage appears only when dual-homed, and the host view drops it', () => {
    expect(goalsFor(host()).some((x) => x.stage.id === 'lateral-movement')).toBe(false);
    const r = goalsFor(host({ dualHomed: true }));
    expect(hostViewStages(r).some((x) => x.stage.id === 'lateral-movement')).toBe(false);
    expect(hostViewStages(r).length).toBe(r.length - 1);
    expect(ids(r, 'lateral-movement')).toEqual(['h-pivot-tunnel', 'h-pivot-sweep']);
  });

  it('domain goal h-loot-domain only on domain-joined Windows', () => {
    const win = goalsFor(host({ os: 'windows' }), onPorts(88, 389));
    expect(ids(win, 'post-exploitation')).toContain('h-loot-domain');
    const lin = goalsFor(host({ os: 'linux' }), onPorts(88, 389));
    expect(ids(lin, 'post-exploitation')).not.toContain('h-loot-domain');
    expect(ids(goalsFor(host({ os: 'windows' }), onPorts(445)), 'post-exploitation')).not.toContain('h-loot-domain');
  });

  it('a Windows member server is domain-joined when the engagement has a DC', () => {
    const dc = host({ id: 'dc', os: 'windows' });
    const member = host({ id: 'm', os: 'windows' });
    const map = new Map([['dc', onPorts(88, 389)], ['m', onPorts(445)]]);
    expect(hostFacts(member, null, [dc, member], map).domainJoined).toBe(true);
    expect(hostFacts(member, null, [member], map).domainJoined).toBe(false);
  });

  it('two DCs: no single DC, but a Windows member server is still domain-joined', () => {
    const dc1 = host({ id: 'dc1', os: 'windows' });
    const dc2 = host({ id: 'dc2', os: 'windows' });
    const member = host({ id: 'm', os: 'windows' });
    const lin = host({ id: 'l', os: 'linux' });
    const map = new Map([['dc1', onPorts(88, 389, 445)], ['dc2', onPorts(88, 389, 445)], ['m', onPorts(445)], ['l', onPorts(22)]]);
    expect(findDcHost([dc1, dc2, member], map)).toBeNull();
    expect(hostFacts(member, null, [dc1, dc2, member], map).domainJoined).toBe(true);
    expect(ids(applicableGoals(member, null, [dc1, dc2, member], map), 'post-exploitation')).toContain('h-loot-domain');
    // a Linux host next to them is not joined
    expect(hostFacts(lin, null, [dc1, dc2, lin], map).domainJoined).toBe(false);
  });

  it('cleanup only in client engagements', () => {
    const closeout = (e: { kind: 'exam-sim' | 'lab' | 'client' } | null) => ids(goalsFor(host(), [], e), 'reporting');
    expect(closeout(null)).not.toContain('h-close-cleanup');
    expect(closeout({ kind: 'lab' })).not.toContain('h-close-cleanup');
    expect(closeout({ kind: 'exam-sim' })).not.toContain('h-close-cleanup');
    expect(closeout({ kind: 'client' })).toContain('h-close-cleanup');
  });

  it('changing OS hides goals and restores them', () => {
    const win = host({ os: 'windows' });
    expect(all(goalsFor({ ...win, os: 'other' }))).not.toContain('h-pe-win-privs');
    expect(all(goalsFor(win))).toContain('h-pe-win-privs');
  });
});

describe('findDcHost', () => {
  const dc = host({ id: 'dc' });
  const other = host({ id: 'o' });
  const x = host({ id: 'x' });
  it('returns the only 88+389 host, else null', () => {
    const map = new Map([['dc', onPorts(88, 389)], ['o', onPorts(88, 389)], ['x', onPorts(80)]]);
    expect(findDcHost([dc, x], map)?.id).toBe('dc');
    expect(findDcHost([dc, other], map)).toBeNull();
    expect(findDcHost([x], map)).toBeNull();
    expect(adHosts([dc, other, x], map).map((h) => h.id)).toEqual(['dc', 'o']);
  });
});

describe('facts', () => {
  it('openPorts skips closed and filtered rows', () => {
    const rows = [svc(22), svc(80, 'http', { state: 'filtered' }), svc(81, 'http', { state: 'closed' }), svc(53, 'domain', { state: 'open|filtered' })];
    expect([...openPorts(rows)].sort((a, b) => a - b)).toEqual([22, 53]);
  });

  it('serviceNames: an unknown confirmed product adds nothing, not even the nmap name', () => {
    expect([...serviceNames([svc(80, 'http', { confirmedProduct: 'CouchDB' })])]).toEqual([]);
    expect([...serviceNames([svc(5432, 'ppp', { confirmedProduct: 'PostgreSQL 15' })])]).toEqual(['postgresql']);
  });

  it('engagementFacts has no OS and is domain-joined when any host is AD', () => {
    const dc = host({ id: 'dc' });
    const map = new Map([['dc', onPorts(88, 389)]]);
    const f = engagementFacts({ kind: 'client' }, [dc], map);
    expect(f.os).toBeNull();
    expect(f.domainJoined).toBe(true);
    expect(f.kind).toBe('client');
    expect(engagementFacts({ kind: 'lab' }, [], new Map()).domainJoined).toBe(false);
  });
});

describe('definitions', () => {
  const engagementGoals = [...ENGAGEMENT_SETUP, ...AD_PLAYBOOKS.flatMap((p) => p.goals)];

  it('has the seven host stages and the mandated engagement ids', () => {
    expect(HOST_STAGES.map((s) => s.id)).toEqual([
      'information-gathering', 'vulnerability-detection', 'initial-foothold', 'privilege-escalation', 'post-exploitation', 'reporting', 'lateral-movement',
    ]);
    const eng = engagementGoals.map((g) => g.id);
    for (const id of [
      'e-setup-kind', 'e-setup-scope', 'e-setup-hosts', 'e-setup-clock', 'e-ad-user-bloodhound', 'e-ad-user-kerberoast',
      'e-ad-user-asrep', 'e-ad-user-users', 'e-ad-nocreds-rid', 'e-ad-user-relay', 'e-ad-da-dcsync', 'e-ad-da-proof',
    ]) expect(eng).toContain(id);
    for (const g of HOST_GOALS) expect(g.why, g.id).toBeTruthy();
    expect(AD_PLAYBOOKS.map((p) => p.id)).toEqual(['nocreds', 'user', 'da']);
    expect(engagementGoals.find((g) => g.id === 'e-setup-clock')?.applies).toEqual({ domainJoined: true });
  });

  it('goalApplies treats goals without criteria as always applicable', () => {
    const h = host();
    const facts = hostFacts(h, null, [], new Map());
    expect(goalApplies(HOST_GOALS.find((g) => g.id === 'h-foot-shell')!, facts)).toBe(true);
  });
});
