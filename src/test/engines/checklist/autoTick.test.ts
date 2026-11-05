import { describe, it, expect } from 'vitest';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import type { LogEntry } from '../../../types/log';
import type { ChecklistState } from '../../../types/checklist';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import {
  applyTicks,
  removeEntryTicks,
  replaceEntryTicks,
  ticksForEntry,
  type Tick,
  type TickContext,
} from '../../../engines/checklist';

const engagement = (over: Partial<Engagement> = {}): Engagement => ({
  id: 'lab', name: 'Lumen', kind: 'lab', client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null,
  endsAt: null, timeboxStart: null, timeboxMinutes: null, status: 'active', createdAt: 0, updatedAt: 0,
  lastActivityAt: null, lastRanOn: null, msfHostId: null, ...over,
});
const host = (id: string, name: string, ip: string, os: Host['os']): Host => ({
  id, engagementId: 'lab', name, ip, os, boardColumn: 'enumerate', boardManual: false, access: 'none',
  createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
});
let n = 0;
const svc = (hostId: string, port: number): Service => ({
  id: `s${n++}`, hostId, port, protocol: 'tcp', state: 'open', nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 0, updatedAt: 0,
});

const dc = host('dc', 'DC01', '10.0.0.1', 'windows');
const ms01 = host('ms01', 'MS01', '10.0.0.5', 'windows');
const ms02 = host('ms02', 'MS02', '10.0.0.6', 'windows');
const web = host('web', 'WEB01', '10.0.0.50', 'linux');
const hosts = [dc, ms01, ms02, web];
const servicesByHost = new Map<string, Service[]>([
  ['dc', [53, 88, 135, 389, 445].map((p) => svc('dc', p))],
  ['ms01', [135, 445, 5985].map((p) => svc('ms01', p))],
  ['ms02', [445].map((p) => svc('ms02', p))],
  ['web', [22, 80].map((p) => svc('web', p))],
]);

const ctxFor = (eng: Engagement = engagement()): TickContext => ({ engagement: eng, hosts, servicesByHost, library: BUILTIN_LIBRARY });

const entry = (command: string, over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'log-1', engagementId: 'lab', kind: 'command', title: 't', titleEdited: false, ranOn: 'Kali', hostIds: [],
  observations: null, returnedNothing: false, private: false, content: { kind: 'command', blocks: [{ command, output: '' }] },
  at: 1, createdAt: 1, updatedAt: 1, ...over,
});
const withBlocks = (blocks: { command: string; output: string; shell?: string }[], over: Partial<LogEntry> = {}) =>
  entry('', { content: { kind: 'command', blocks }, ...over });

const ticks = (command: string, over: Partial<LogEntry> = {}, eng?: Engagement) => ticksForEntry(entry(command, over), ctxFor(eng));
const pairs = (t: Tick[]) => t.map((x) => `${x.ownerId}:${x.goalId}`).sort();

describe('ticksForEntry (commands)', () => {
  it('full port nmap ticks h-enum-full-tcp on the named host', () => {
    const t = ticks('nmap -p- -T4 10.0.0.5');
    expect(t).toContainEqual({ ownerId: 'ms01', goalId: 'h-enum-full-tcp', commandId: 'enum-nmap-full-tcp', entryId: 'log-1' });
    expect(t.every((x) => x.ownerId === 'ms01')).toBe(true);
  });

  it('top-1000 nmap ticks nothing for full tcp', () => {
    expect(ticks('nmap -sC -sV 10.0.0.5').some((x) => x.goalId === 'h-enum-full-tcp')).toBe(false);
  });

  it('ticks each host named in the line and none from a CIDR', () => {
    expect(pairs(ticks('nmap -p- 10.0.0.5 10.0.0.6').filter((x) => x.goalId === 'h-enum-full-tcp'))).toEqual([
      'ms01:h-enum-full-tcp', 'ms02:h-enum-full-tcp',
    ]);
    expect(ticks("nxc smb 10.0.0.0/24 -u '' -p ''")).toEqual([]);
    expect(ticks('nmap -p- 10.0.0.1-10')).toEqual([]);
  });

  it('an IP inside an output filename or path is not a target', () => {
    for (const line of [
      'nmap -p- -T4 10.0.0.5 -oN scans/10.0.0.6/full.nmap',
      'nmap -p- -T4 10.0.0.5 -oN 10.0.0.6_full.txt',
      'nmap -p- -T4 10.0.0.5 -oN scans/full/10.0.0.6.txt',
    ]) {
      expect(pairs(ticks(line)), line).toEqual(['ms01:h-enum-full-tcp']);
    }
  });

  it('URL, port, user@ and option forms still attribute', () => {
    const goalsOf = (c: string) => pairs(ticks(c)).map((p) => p.split(':')[0]);
    expect(goalsOf('gobuster dir -u http://10.0.0.50/path -w /usr/share/wordlists/dirb/common.txt')).toContain('web');
    expect(goalsOf('nmap -p- 10.0.0.5:445')).toContain('ms01');
    expect(goalsOf('nmap -p- 10.0.0.5,10.0.0.6').sort()).toEqual(['ms01', 'ms02']);
    expect(goalsOf('nmap -p- "10.0.0.5"')).toContain('ms01');
    expect(goalsOf('nmap -p- --target=10.0.0.5')).toContain('ms01');
  });

  it('UNC-style //IP attributes the host', () => {
    const t = ticks('smbclient -N -L //10.0.0.6');
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.ownerId === 'ms02')).toBe(true);
  });

  it('fqdn token attributes', () => {
    const corp = engagement({ domain: 'corp.local' });
    expect(pairs(ticks('nmap -p- ms01.corp.local', {}, corp))).toEqual(['ms01:h-enum-full-tcp']);
    expect(pairs(ticks('nmap -p- MS01', {}, corp))).toEqual(['ms01:h-enum-full-tcp']);
    // Without the engagement domain an FQDN is not a host name.
    expect(pairs(ticks('nmap -p- ms01.corp.local'))).toEqual([]);
  });

  it('machine account names do not attribute', () => {
    expect(pairs(ticks("impacket-secretsdump 'corp.local/MS01$@10.0.0.6' -hashes :abc")).every((p) => p.startsWith('ms02:'))).toBe(true);
    expect(pairs(ticks("impacket-secretsdump 'corp.local/MS01$@10.0.0.6' -hashes :abc"))).not.toEqual([]);
    expect(pairs(ticks("nxc smb 10.0.0.6 -u 'MS01$' -H aad3b435b51404eeaad3b435b51404ee --shares")).some((p) => p.startsWith('ms01:'))).toBe(false);
  });

  it('filenames containing a host name do not attribute', () => {
    expect(pairs(ticks('nmap -p- 10.0.0.6 -oN ms01.txt'))).toEqual(['ms02:h-enum-full-tcp']);
    expect(pairs(ticks('nmap -p- 10.0.0.6 -oA scans/ms01-full'))).toEqual(['ms02:h-enum-full-tcp']);
  });

  it('ip ranges attribute nothing', () => {
    expect(ticks('nmap -p- 10.0.0.1-10.0.0.6')).toEqual([]);
    expect(ticks('masscan -p1-65535 10.0.0.1-10.0.0.6')).toEqual([]);
  });

  it('a line with --exclude attributes nothing', () => {
    expect(ticks('nmap -p- 10.0.0.5 --exclude 10.0.0.6')).toEqual([]);
    expect(ticks('nmap -p- 10.0.0.5 --excludefile skip.txt')).toEqual([]);
    expect(ticks('masscan -p1-65535 10.0.0.5 -exclude 10.0.0.6')).toEqual([]);
  });

  it('kali prompt label never falls back to ranOn', () => {
    const viaShell = (shell: string) =>
      ticksForEntry(withBlocks([{ command: 'whoami /priv', output: '', shell }], { ranOn: 'MS01' }), ctxFor());
    expect(viaShell('(kali㉿kali)-[~]')).toEqual([]);
    expect(viaShell('kali@kali')).toEqual([]);
    expect(viaShell('root@KALI:~#')).toEqual([]);
    // A prompt naming no host still falls back to ranOn.
    expect(pairs(viaShell('PS C:\\Users\\svc> '))).toEqual(['ms01:h-pe-win-privs']);
  });

  it('10.0.0.5 does not match 10.0.0.50', () => {
    expect(pairs(ticks('nmap -p- 10.0.0.50'))).toEqual(['web:h-enum-full-tcp']);
  });

  it('only attributes hosts in the matched command, not after a pipe', () => {
    expect(pairs(ticks('nmap -p- 10.0.0.5 | tee scan-10.0.0.6.txt'))).toEqual(['ms01:h-enum-full-tcp']);
  });

  it('whoami /priv with ranOn Kali ticks nothing', () => {
    expect(ticks('whoami /priv', { ranOn: 'Kali' })).toEqual([]);
    expect(ticks('whoami /priv', { ranOn: 'kali' })).toEqual([]);
    expect(ticks('whoami /priv', { ranOn: null })).toEqual([]);
  });

  it('with shell label "evil-winrm MS01" ticks MS01 h-pe-win-privs', () => {
    const t = ticksForEntry(withBlocks([{ command: 'whoami /priv', output: '', shell: 'evil-winrm MS01' }]), ctxFor());
    expect(pairs(t)).toEqual(['ms01:h-pe-win-privs']);
  });

  it('target lines fall back to ranOn, by name or IP', () => {
    expect(pairs(ticks('whoami /priv', { ranOn: 'MS02' }))).toEqual(['ms02:h-pe-win-privs']);
    expect(pairs(ticks('whoami /priv', { ranOn: '10.0.0.6' }))).toEqual(['ms02:h-pe-win-privs']);
  });

  it('ambiguous ranOn ticks nothing', () => {
    expect(ticks('whoami /priv', { ranOn: 'MS01 then MS02' })).toEqual([]);
    expect(ticks('whoami /priv', { ranOn: 'some-box' })).toEqual([]);
  });

  it('goal not applicable to the host never ticks', () => {
    expect(ticks('sudo -l', { ranOn: 'MS01' })).toEqual([]);
    expect(pairs(ticks('sudo -l', { ranOn: 'WEB01' }))).toEqual(['web:h-pe-lin-sudo']);
  });

  it('kerberoast command ticks the engagement goal, not the DC', () => {
    const t = ticks('impacket-GetUserSPNs corp.local/bob:Passw0rd -dc-ip 10.0.0.1 -request');
    expect(pairs(t)).toEqual(['lab:e-ad-user-kerberoast']);
  });

  it('null session against a non-DC does not tick the no-creds playbook', () => {
    expect(pairs(ticks('impacket-samrdump 10.0.0.5'))).toEqual(['ms01:h-enum-rpc']);
    expect(pairs(ticks("nxc smb 10.0.0.5 -u '' -p '' --shares"))).toEqual(['ms01:h-enum-smb']);
  });

  it('null session against the DC ticks both the host goal and the playbook goal', () => {
    expect(pairs(ticks('impacket-samrdump 10.0.0.1'))).toEqual(['dc:h-enum-rpc', 'lab:e-ad-nocreds-rpc']);
    expect(pairs(ticks("nxc smb dc01 -u '' -p ''"))).toEqual(['dc:h-enum-smb', 'lab:e-ad-nocreds-smb-null']);
  });

  it('target-side AD commands need a shell host', () => {
    expect(ticks('SharpHound.exe -c All --domaincontroller 10.0.0.1', { ranOn: 'Kali' })).toEqual([]);
    expect(pairs(ticks('SharpHound.exe -c All --domaincontroller 10.0.0.1', { ranOn: 'MS01' }))).toEqual(['lab:e-ad-user-bloodhound']);
    expect(ticks('SharpHound.exe -c All', { ranOn: 'MS01' })).toEqual([]);
    expect(pairs(ticks('SharpHound.exe -c All', { ranOn: 'DC01' }))).toEqual(['lab:e-ad-user-bloodhound']);
  });

  it('an AD goal on a line naming no host ticks nothing', () => {
    expect(ticks('kerbrute userenum -d corp.local users.txt')).toEqual([]);
  });

  it('setup goals tick on any engagement line', () => {
    expect(pairs(ticks('sudo ntpdate 10.0.0.1'))).toEqual(['lab:e-setup-clock']);
    expect(pairs(ticks('nxc smb 10.0.0.0/24 --generate-hosts-file hosts'))).toEqual(['lab:e-setup-hosts']);
  });

  it('matches a multi-line block line by line and de-duplicates by owner and goal', () => {
    const t = ticks('nmap -p- 10.0.0.5\nrustscan -a 10.0.0.5\nnmap -p- 10.0.0.6');
    expect(pairs(t)).toEqual(['ms01:h-enum-full-tcp', 'ms02:h-enum-full-tcp']);
    expect(t.find((x) => x.ownerId === 'ms01')?.commandId).toBe('enum-nmap-full-tcp');
  });

  it('a login attempt does not tick the credential-login goal', () => {
    const foot = (line: string) => ticks(line).filter((x) => x.goalId.startsWith('h-foot-'));
    expect(foot("evil-winrm -i 10.0.0.5 -u jace -p 'Pw1!'")).toEqual([]);
    expect(foot('evil-winrm -i 10.0.0.5 -u jace -H abc')).toEqual([]);
    expect(foot("impacket-psexec corp.local/jace:'Pw1!'@10.0.0.6")).toEqual([]);
    expect(foot('impacket-wmiexec -hashes :abc corp.local/jace@10.0.0.6')).toEqual([]);
    expect(foot('ssh jace@10.0.0.50')).toEqual([]);
    // payloads and listeners name no target
    expect(ticks('msfvenom -p windows/x64/shell_reverse_tcp LHOST=10.10.14.2 LPORT=443 -f exe -o shell.exe')).toEqual([]);
    expect(ticks('penelope -p 443')).toEqual([]);
    expect(ticks('rlwrap nc -lvnp 443')).toEqual([]);
  });

  it('other entry kinds tick nothing', () => {
    const note = entry('', { kind: 'note', content: { kind: 'note', text: 'nmap -p- 10.0.0.5' }, hostIds: ['ms01'] });
    expect(ticksForEntry(note, ctxFor())).toEqual([]);
  });
});

describe('ticksForEntry (line names no host)', () => {
  it('a Kali command naming no host ticks the hosts the entry is tagged with', () => {
    const t = ticks('searchsploit --nmap nmap_svc.xml', { hostIds: ['web'] });
    expect(pairs(t)).toContain('web:h-enum-exploits');
  });

  it('a line that names a host still ticks only that host, not the tags', () => {
    const t = ticks('nmap -p- -T4 10.0.0.5', { hostIds: ['web'] });
    expect(pairs(t)).toContain('ms01:h-enum-full-tcp');
    expect(pairs(t)).not.toContain('web:h-enum-full-tcp');
  });

  it('a line that excludes hosts never falls back to the tags', () => {
    const t = ticks('nmap -p- 10.0.0.0/24 --exclude 10.0.0.1', { hostIds: ['web'] });
    expect(pairs(t)).not.toContain('web:h-enum-full-tcp');
  });

  it('no tags, no host named: nothing ticks', () => {
    expect(ticks('searchsploit --nmap nmap_svc.xml')).toEqual([]);
  });
});

describe('ticksForEntry (flags)', () => {
  const flag = (flagKind: 'local' | 'proof', hostIds: string[]) =>
    entry('', { kind: 'flag', hostIds, content: { kind: 'flag', flagKind, value: 'abc' } });

  it('flag local ticks h-orient-proof on its host; proof ticks h-pe-proof', () => {
    expect(ticksForEntry(flag('local', ['ms01']), ctxFor())).toEqual([
      { ownerId: 'ms01', goalId: 'h-orient-proof', commandId: 'flag', entryId: 'log-1' },
    ]);
    expect(ticksForEntry(flag('proof', ['ms01', 'web']), ctxFor())).toEqual([
      { ownerId: 'ms01', goalId: 'h-pe-proof', commandId: 'flag', entryId: 'log-1' },
      { ownerId: 'web', goalId: 'h-pe-proof', commandId: 'flag', entryId: 'log-1' },
    ]);
  });

  it('a flag ticks on a host with unknown OS, without an applicability check; unknown host ids tick nothing', () => {
    const unknownOs = host('x', 'X', '10.0.0.9', null);
    const ctx = { ...ctxFor(), hosts: [...hosts, unknownOs] };
    expect(pairs(ticksForEntry(flag('proof', ['x']), ctx))).toEqual(['x:h-pe-proof']);
    expect(pairs(ticksForEntry(flag('local', ['x']), ctx))).toEqual(['x:h-orient-proof']);
    expect(ticksForEntry(flag('local', ['nope']), ctx)).toEqual([]);
  });
});

describe('ticksForEntry (pasted scan output)', () => {
  it('pasted nmap output with an "as:" header ticks the scan goal for the scanned host', () => {
    const output = [
      '# Nmap 7.94 scan initiated Mon Nov  2 10:00:00 2026 as: nmap -p- -T4 -oN full.nmap 10.0.0.5',
      'Nmap scan report for 10.0.0.5',
      'PORT    STATE SERVICE',
      '445/tcp open  microsoft-ds',
    ].join('\n');
    const t = ticksForEntry(withBlocks([{ command: '', output }]), ctxFor());
    expect(pairs(t)).toEqual(['ms01:h-enum-full-tcp']);
  });

  it('output of cat run.sh containing an nmap line ticks nothing', () => {
    const t = ticksForEntry(withBlocks([{ command: 'cat run.sh', output: 'nmap -p- 10.0.0.6' }]), ctxFor());
    expect(t).toEqual([]);
  });

  it('output lines never tick target-side or engagement goals', () => {
    const t = ticksForEntry(withBlocks([{ command: '', output: 'whoami /priv\nsudo ntpdate 10.0.0.1' }], { ranOn: 'MS01' }), ctxFor());
    expect(t).toEqual([]);
  });
});

const tick = (over: Partial<Tick> = {}): Tick => ({
  ownerId: 'ms01', goalId: 'h-enum-full-tcp', commandId: 'enum-nmap-full-tcp', entryId: 'log-1', ...over,
});
const NOW = 1_800_000_000_000;
const LATER = NOW + 86_400_000;

describe('applyTicks / removeEntryTicks', () => {
  it('ticks a todo goal as auto done with evidence', () => {
    const s = applyTicks(undefined, [tick()], NOW);
    expect(s['h-enum-full-tcp']).toEqual({
      status: 'done', completedAt: NOW, auto: true,
      evidence: [{ entryId: 'log-1', commandId: 'enum-nmap-full-tcp' }],
    });
  });

  it('applyTicks keeps a hand-ticked done and adds evidence', () => {
    const before: ChecklistState = { 'h-enum-full-tcp': { status: 'done', completedAt: 5, notes: 'by hand' } };
    const s = applyTicks(before, [tick()], NOW);
    expect(s['h-enum-full-tcp']).toEqual({
      status: 'done', completedAt: 5, notes: 'by hand', evidence: [{ entryId: 'log-1', commandId: 'enum-nmap-full-tcp' }],
    });
  });

  it('applying the same tick twice adds evidence once and returns the same state', () => {
    const once = applyTicks(undefined, [tick()], NOW);
    expect(applyTicks(once, [tick()], NOW)).toBe(once);
  });

  it('removeEntryTicks reverts auto goals with no evidence left', () => {
    const s = removeEntryTicks(applyTicks({ 'h-enum-full-tcp': { status: 'todo', notes: 'n' } }, [tick()], NOW), 'log-1');
    expect(s['h-enum-full-tcp']).toEqual({ status: 'todo', notes: 'n' });
  });

  it('removeEntryTicks keeps auto goals that still have other evidence', () => {
    const both = applyTicks(undefined, [tick(), tick({ entryId: 'log-2' })], NOW);
    const s = removeEntryTicks(both, 'log-1');
    expect(s['h-enum-full-tcp']).toMatchObject({ status: 'done', auto: true, evidence: [{ entryId: 'log-2' }] });
  });

  it('removeEntryTicks keeps a hand-ticked goal done and drops only its evidence', () => {
    const before: ChecklistState = { 'h-enum-full-tcp': { status: 'done', completedAt: 5 } };
    const s = removeEntryTicks(applyTicks(before, [tick()], NOW), 'log-1');
    expect(s['h-enum-full-tcp']).toEqual({ status: 'done', completedAt: 5 });
  });

  it('removeEntryTicks returns the same state when the entry left no evidence', () => {
    const s: ChecklistState = { 'h-enum-full-tcp': { status: 'done' } };
    expect(removeEntryTicks(s, 'log-9')).toBe(s);
  });

  it('N/A goal auto-ticked then entry removed returns to N/A', () => {
    const before: ChecklistState = { 'h-enum-full-tcp': { status: 'na', notes: 'filtered' } };
    const ticked = applyTicks(before, [tick()], NOW);
    expect(ticked['h-enum-full-tcp']).toMatchObject({ status: 'done', auto: true, autoFrom: 'na' });
    expect(removeEntryTicks(ticked, 'log-1')['h-enum-full-tcp']).toEqual({ status: 'na', notes: 'filtered' });
    expect(replaceEntryTicks(ticked, 'log-1', [], NOW)['h-enum-full-tcp']).toEqual({ status: 'na', notes: 'filtered' });
  });

  it('undo restores in progress', () => {
    const before: ChecklistState = { 'h-enum-full-tcp': { status: 'in_progress' } };
    const ticked = applyTicks(before, [tick()], NOW);
    expect(ticked['h-enum-full-tcp']).toMatchObject({ status: 'done', auto: true, autoFrom: 'in_progress' });
    expect(removeEntryTicks(ticked, 'log-1')['h-enum-full-tcp']).toEqual({ status: 'in_progress' });
  });

  it('a todo goal records no autoFrom', () => {
    expect(applyTicks(undefined, [tick()], NOW)['h-enum-full-tcp'].autoFrom).toBeUndefined();
  });
});

describe('replaceEntryTicks', () => {
  it('replaceEntryTicks keeps completedAt for goals still ticked and drops evidence for goals no longer ticked', () => {
    const versions = { goalId: 'h-enum-versions', commandId: 'enum-nmap-versions' };
    const before = applyTicks(undefined, [tick(), tick(versions)], NOW);
    // Same ticks: nothing changes at all.
    expect(replaceEntryTicks(before, 'log-1', [tick(), tick(versions)], LATER)).toBe(before);
    // One goal still ticked (new command id), the other no longer ticked.
    const s = replaceEntryTicks(before, 'log-1', [tick({ commandId: 'enum-rustscan-full' })], LATER);
    expect(s['h-enum-full-tcp']).toEqual({
      status: 'done', completedAt: NOW, auto: true, evidence: [{ entryId: 'log-1', commandId: 'enum-rustscan-full' }],
    });
    expect(s['h-enum-versions']).toEqual({ status: 'todo' });
  });

  it('a newly ticked goal gets the current time', () => {
    const before = applyTicks(undefined, [tick()], NOW);
    const s = replaceEntryTicks(before, 'log-1', [tick(), tick({ goalId: 'h-enum-versions', commandId: 'enum-nmap-versions' })], LATER);
    expect(s['h-enum-full-tcp'].completedAt).toBe(NOW);
    expect(s['h-enum-versions'].completedAt).toBe(LATER);
  });
});
