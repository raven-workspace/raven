import { describe, it, expect } from 'vitest';
import { analyzeCommandOutput, detectOsFromScan, looksBinary, normalizeOsName } from '../../../engines/parse/commandOutput';
import { detectAndParseScan } from '../../../engines/parse/scan';

const NMAP_WINDOWS = `# Nmap 7.94 scan initiated as: nmap -sC -sV 10.10.11.5
Nmap scan report for dc01.corp.local (10.10.11.5)
Host is up (0.030s latency).
PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
88/tcp   open  kerberos-sec  Microsoft Windows Kerberos (server time: 2026-10-21)
135/tcp  open  msrpc         Microsoft Windows RPC
445/tcp  open  microsoft-ds?
Service Info: Host: DC01; OS: Windows; CPE: cpe:/o:microsoft:windows
`;

const NMAP_LINUX_BANNER = `Nmap scan report for 10.10.10.3
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.5 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    nginx 1.18.0
`;

const NMAP_OS_DETAILS = `Nmap scan report for 10.10.10.9
PORT   STATE SERVICE VERSION
80/tcp open  http    nginx
Running: Linux 4.X|5.X
OS details: Linux 4.15 - 5.8
`;

const NMAP_PORTS_ONLY = `Nmap scan report for 10.10.10.40
PORT     STATE SERVICE
3389/tcp open  ms-wbt-server
8080/tcp open  http-proxy
`;

describe('normalizeOsName', () => {
  it('maps free-form OS strings', () => {
    expect(normalizeOsName('Microsoft Windows Server 2019 Standard')).toBe('windows');
    expect(normalizeOsName('Ubuntu 22.04')).toBe('linux');
    expect(normalizeOsName('FreeBSD 13.1')).toBe('other');
    expect(normalizeOsName('Darwin')).toBe('other');
    expect(normalizeOsName('Cisco IOS')).toBeNull();
    expect(normalizeOsName(undefined)).toBeNull();
  });
});

describe('detectOsFromScan', () => {
  const detect = (text: string) => detectOsFromScan(detectAndParseScan(text)!, text);

  it('trusts nmap Service Info first', () => {
    expect(detect(NMAP_WINDOWS)).toMatchObject({ os: 'windows', evidence: expect.stringContaining('Nmap OS detection') });
  });

  it('reads OS details lines from nmap -O', () => {
    expect(detect(NMAP_OS_DETAILS)).toMatchObject({ os: 'linux' });
  });

  it('falls back to service banners', () => {
    expect(detect(NMAP_LINUX_BANNER)).toMatchObject({ os: 'linux', evidence: expect.stringContaining('Ubuntu') });
  });

  it('falls back to Windows-only services', () => {
    expect(detect(NMAP_PORTS_ONLY)).toMatchObject({ os: 'windows', evidence: expect.stringContaining('3389') });
  });

  it('returns null without a signal', () => {
    const text = 'Nmap scan report for 10.0.0.1\nPORT   STATE SERVICE\n80/tcp open  http\n';
    expect(detect(text)).toBeNull();
  });
});

describe('analyzeCommandOutput', () => {
  it('treats nmap output as a scan with OS', () => {
    const a = analyzeCommandOutput(NMAP_WINDOWS);
    expect(a.tool).toBe('nmap');
    expect(a.scan?.ports.length).toBe(4);
    expect(a.os?.os).toBe('windows');
    expect(a.hostname).toBe('dc01.corp.local');
  });

  it('extracts OS, hostname and domain from netexec', () => {
    const a = analyzeCommandOutput(
      'SMB         10.10.11.5      445    DC01             [*] Windows Server 2019 Standard 17763 x64 (name:DC01) (domain:corp.local) (signing:True) (SMBv1:False)\n' +
        'SMB         10.10.11.5      445    DC01             [+] corp.local\\guest:'
    );
    expect(a).toMatchObject({ tool: 'netexec', hostname: 'DC01', domain: 'corp.local' });
    expect(a.os?.os).toBe('windows');
    expect(a.scan).toBeUndefined();
  });

  it('reads systeminfo', () => {
    const a = analyzeCommandOutput('Host Name:                 WEB01\nOS Name:                   Microsoft Windows Server 2022 Standard\nDomain:                    orchard.com\n');
    expect(a).toMatchObject({ tool: 'systeminfo', hostname: 'WEB01', domain: 'orchard.com' });
    expect(a.os?.os).toBe('windows');
  });

  it('reads uname -a and uses the prompt line as the title', () => {
    const a = analyzeCommandOutput('$ uname -a\nLinux web02 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux');
    expect(a).toMatchObject({ tool: 'uname', title: 'uname -a', hostname: 'web02' });
    expect(a.os?.os).toBe('linux');
  });

  it('guesses OS from ping TTL', () => {
    expect(analyzeCommandOutput('64 bytes from 10.10.10.5: icmp_seq=1 ttl=127 time=31.2 ms').os?.os).toBe('windows');
    expect(analyzeCommandOutput('64 bytes from 10.10.10.6: icmp_seq=1 ttl=63 time=30.0 ms').os?.os).toBe('linux');
  });

  it('reads the domain from ldapsearch naming contexts', () => {
    const a = analyzeCommandOutput('# extended LDIF\n#\n# LDAPv3\ndn:\nnamingContexts: DC=lumen,DC=com\n');
    expect(a).toMatchObject({ tool: 'ldapsearch', domain: 'lumen.com' });
  });

  it('labels directory brute-forcers without inventing an OS', () => {
    const a = analyzeCommandOutput('Gobuster v3.6\n/admin                (Status: 301) [Size: 312]\n');
    expect(a.tool).toBe('gobuster');
    expect(a.os).toBeUndefined();
  });

  it('keeps unrecognised text as generic output', () => {
    const a = analyzeCommandOutput('some notes from a custom script\nnothing to parse here');
    expect(a).toEqual({ tool: 'text', title: 'Command output' });
  });
});

describe('looksBinary', () => {
  it('flags NUL bytes and control-heavy text only', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000')).toBe(true);
    expect(looksBinary('normal output\nwith lines\t and tabs')).toBe(false);
  });
});
