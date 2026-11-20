import { describe, it, expect } from 'vitest';
import { detectOsFromScan, normalizeOsName } from '../../../engines/parse/commandOutput';
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
