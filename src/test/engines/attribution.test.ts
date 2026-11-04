import { describe, it, expect } from 'vitest';
import { HOST_IP, ipsIn, isKaliLabel, namedHostsInLine, shellHost, type HostRef } from '../../engines/attribution';

const host = (id: string, name: string, ip: string | null): HostRef => ({ id, name, ip });
const dc = host('dc', 'DC01', '10.0.0.1');
const ms01 = host('ms01', 'MS01', '10.0.0.5');
const ms02 = host('ms02', 'MS02', '10.0.0.6');
const web = host('web', 'WEB01', '10.0.0.50');
const hosts = [dc, ms01, ms02, web];

const named = (line: string, domain = '') => namedHostsInLine(line, hosts, domain).map((h) => h.id).sort();

describe('HOST_IP / ipsIn', () => {
  it('finds whole IPv4 tokens only', () => {
    expect([...ipsIn('nmap 10.0.0.5 10.0.0.50')]).toEqual(['10.0.0.5', '10.0.0.50']);
    expect(ipsIn('nmap 10.0.0.0/24').size).toBe(0);
    expect(ipsIn('nmap 10.0.0.1-10').size).toBe(0);
    expect(new RegExp(HOST_IP.source, 'g').test('x 10.0.0.5')).toBe(true);
  });
});

describe('namedHostsInLine', () => {
  it('names the host and nothing from a CIDR', () => {
    expect(named('nmap -p- -T4 10.0.0.5')).toEqual(['ms01']);
    expect(named('nmap -p- 10.0.0.5 10.0.0.6')).toEqual(['ms01', 'ms02']);
    expect(named("nxc smb 10.0.0.0/24 -u '' -p ''")).toEqual([]);
    expect(named('nmap -p- 10.0.0.1-10')).toEqual([]);
  });

  it('an IP inside an output filename or path is not a target', () => {
    for (const line of [
      'nmap -p- -T4 10.0.0.5 -oN scans/10.0.0.6/full.nmap',
      'nmap -p- -T4 10.0.0.5 -oN 10.0.0.6_full.txt',
      'nmap -p- -T4 10.0.0.5 -oN scans/full/10.0.0.6.txt',
    ]) {
      expect(named(line), line).toEqual(['ms01']);
    }
  });

  it('URL, port, user@ and option forms still attribute', () => {
    expect(named('gobuster dir -u http://10.0.0.50/path -w /usr/share/wordlists/dirb/common.txt')).toContain('web');
    expect(named('nmap -p- 10.0.0.5:445')).toContain('ms01');
    expect(named('nmap -p- 10.0.0.5,10.0.0.6')).toEqual(['ms01', 'ms02']);
    expect(named('nmap -p- "10.0.0.5"')).toContain('ms01');
    expect(named('nmap -p- --target=10.0.0.5')).toContain('ms01');
  });

  it('UNC-style //IP attributes the host', () => {
    expect(named('smbclient -N -L //10.0.0.6')).toEqual(['ms02']);
  });

  it('fqdn token attributes only with the engagement domain', () => {
    expect(named('nmap -p- ms01.corp.local', 'corp.local')).toEqual(['ms01']);
    expect(named('nmap -p- MS01', 'corp.local')).toEqual(['ms01']);
    expect(named('nmap -p- ms01.corp.local')).toEqual([]);
  });

  it('machine account names do not attribute', () => {
    expect(named("impacket-secretsdump 'corp.local/MS01$@10.0.0.6' -hashes :abc")).toEqual(['ms02']);
    expect(named("nxc smb 10.0.0.6 -u 'MS01$' -H aad3b435b51404eeaad3b435b51404ee --shares")).toEqual(['ms02']);
  });

  it('filenames containing a host name do not attribute', () => {
    expect(named('nmap -p- 10.0.0.6 -oN ms01.txt')).toEqual(['ms02']);
    expect(named('nmap -p- 10.0.0.6 -oA scans/ms01-full')).toEqual(['ms02']);
  });

  it('ip ranges attribute nothing', () => {
    expect(named('nmap -p- 10.0.0.1-10.0.0.6')).toEqual([]);
    expect(named('masscan -p1-65535 10.0.0.1-10.0.0.6')).toEqual([]);
  });

  it('a line with --exclude attributes nothing', () => {
    expect(named('nmap -p- 10.0.0.5 --exclude 10.0.0.6')).toEqual([]);
    expect(named('nmap -p- 10.0.0.5 --excludefile skip.txt')).toEqual([]);
    expect(named('masscan -p1-65535 10.0.0.5 -exclude 10.0.0.6')).toEqual([]);
  });

  it('10.0.0.5 does not match 10.0.0.50', () => {
    expect(named('nmap -p- 10.0.0.50')).toEqual(['web']);
  });

  it('only attributes hosts in the first segment, not after a pipe', () => {
    expect(named('nmap -p- 10.0.0.5 | tee scan-10.0.0.6.txt')).toEqual(['ms01']);
  });

  it('a host with no IP is matched by name only', () => {
    const noIp = [host('x', 'BOX', null)];
    expect(namedHostsInLine('nmap box', noIp, '').map((h) => h.id)).toEqual(['x']);
    expect(namedHostsInLine('nmap 10.0.0.5', noIp, '')).toEqual([]);
  });
});

describe('shellHost', () => {
  const shell = (label: string | undefined, ranOn?: string) => shellHost(label, ranOn, hosts, '')?.id ?? null;

  it('a kali prompt label never falls back to ranOn', () => {
    expect(shell('(kali㉿kali)-[~]', 'MS01')).toBeNull();
    expect(shell('kali@kali', 'MS01')).toBeNull();
    expect(shell('root@KALI:~#', 'MS01')).toBeNull();
  });

  it('a prompt naming no host falls back to ranOn', () => {
    expect(shell('PS C:\\Users\\svc> ', 'MS01')).toBe('ms01');
  });

  it('shell label "evil-winrm MS01" names MS01', () => {
    expect(shell('evil-winrm MS01', undefined)).toBe('ms01');
  });

  it('ranOn Kali or missing names nothing', () => {
    expect(shell(undefined, 'Kali')).toBeNull();
    expect(shell(undefined, 'kali')).toBeNull();
    expect(shell(undefined, undefined)).toBeNull();
  });

  it('falls back to ranOn by name or IP', () => {
    expect(shell(undefined, 'MS02')).toBe('ms02');
    expect(shell(undefined, '10.0.0.6')).toBe('ms02');
  });

  it('ambiguous ranOn names nothing', () => {
    expect(shell(undefined, 'MS01 then MS02')).toBeNull();
    expect(shell(undefined, 'some-box')).toBeNull();
  });
});

describe('isKaliLabel', () => {
  it('matches the whole word kali, case-insensitive', () => {
    for (const l of ['Kali (VM)', 'kali', 'root@KALI:~#', 'my-kali-box']) expect(isKaliLabel(l), l).toBe(true);
    for (const l of ['Docker build', 'Mac', 'kalimba', 'MS01', '']) expect(isKaliLabel(l), l).toBe(false);
  });
});
