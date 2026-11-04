import { describe, it, expect } from 'vitest';
import { buildDraft, detectKind, httpParts, httpTitle, noteTitle, screenshotFileName, commandTitle, flagTitle } from '../../../engines/capture';

const vega = { id: 'h1', name: 'Vega', ip: '172.31.166.143', column: 'enumerate' as const };
const base = {
  image: null,
  hosts: [vega],
  scope: ['172.31.166.0/24'],
  domain: '',
  machines: ['Kali (VM)', 'Docker build', 'Mac'],
  lastRanOn: null,
};

describe('capture draft', () => {
  it('nmap -p- full scan gets library title with target IP', () => {
    const d = buildDraft({ ...base, text: 'sudo nmap -p- -Pn 172.31.166.143' });
    expect(d.kind).toBe('command');
    expect(d.title).toBe('Scan every TCP port · 172.31.166.143');
    expect(d.hostIds).toEqual(['h1']);
  });

  it('unmatched command keeps the full first line', () => {
    const line = './exploit.py --target 172.31.166.143 --lport 4444';
    const blocks = [{ command: line, output: '' }];
    expect(commandTitle(blocks, [vega], '')).toBe(line);
  });

  it('prompt shell attributes target host and ranOn', () => {
    const d = buildDraft({ ...base, text: 'vega@vega:~$ id\nuid=1000(vega)' });
    expect(d.hostIds).toEqual(['h1']);
    expect(d.ranOn).toBe('Vega');
  });

  it('prompt naming no host falls back to the command line', () => {
    const d = buildDraft({ ...base, text: '*Evil-WinRM* PS C:\\Users\\x> whoami\nx', lastRanOn: 'Kali (VM)' });
    expect(d.hostIds).toEqual([]);
    expect(d.ranOn).toBe('Kali (VM)');
  });

  it('kali prompt sets ranOn to the kali machine', () => {
    const d = buildDraft({ ...base, text: 'kali@kali:~$ ls', lastRanOn: 'Mac' });
    expect(d.ranOn).toBe('Kali (VM)');
  });

  it('capture draft ignores out-of-scope IPs', () => {
    const d = buildDraft({ ...base, text: 'ping 8.8.8.8' });
    expect(d.unknownScopeIps).toEqual([]);
  });

  it('unknown in-scope IP is offered', () => {
    const d = buildDraft({ ...base, text: 'ping 172.31.166.150' });
    expect(d.unknownScopeIps).toEqual(['172.31.166.150']);
  });

  it('http title GET :81/', () => {
    const text = 'GET / HTTP/1.1\nHost: 172.31.166.143:81\n\nHTTP/1.1 200 OK\n\nhi';
    const parts = httpParts(text);
    expect(parts.response).toBe('HTTP/1.1 200 OK\n\nhi');
    expect(httpTitle(parts, vega)).toBe('GET :81/');
    expect(httpTitle(parts, null)).toBe('GET 172.31.166.143:81/');
    expect(buildDraft({ ...base, text }).title).toBe('GET :81/');
  });

  it('screenshot file name 172.31.166.143_enum_port81', () => {
    const args = { ip: '172.31.166.143', hostName: 'Vega', column: 'enumerate' as const, mime: 'image/png' };
    expect(screenshotFileName({ ...args, caption: 'web on :81' })).toBe('172.31.166.143_enum_port81.png');
    expect(screenshotFileName({ ...args, caption: 'Login Page Admin Panel Extra', column: null })).toBe('172.31.166.143_enum_login-page-admin.png');
    expect(screenshotFileName({ ...args, ip: null, hostName: null, caption: '', mime: 'image/jpeg', column: 'loot' })).toBe('engagement_loot_shot.jpg');
  });

  it('32-hex paste is a flag', () => {
    const v = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(detectKind(v, false)).toBe('flag');
    expect(buildDraft({ ...base, text: v }).content).toMatchObject({ kind: 'flag', flagKind: 'local', value: v, attachmentId: '' });
    expect(flagTitle('local', vega)).toBe('local.txt · Vega');
    expect(flagTitle('proof', null)).toBe('proof.txt');
    expect(detectKind('x', true)).toBe('screenshot');
  });

  it('note title strips heading marks', () => {
    expect(noteTitle('\n## Found creds  \nmore')).toBe('Found creds');
    expect(buildDraft({ ...base, text: '## remember to check the vhost' }).kind).toBe('note');
  });

  it('scan output yields services for the single attributed host', () => {
    const out = [
      'Starting Nmap 7.94',
      'Nmap scan report for 172.31.166.143',
      'PORT   STATE SERVICE VERSION',
      '22/tcp open  ssh     OpenSSH 8.9',
      '80/tcp open  http    Apache httpd 2.4.52',
      'Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel',
    ].join('\n');
    const d = buildDraft({ ...base, text: `kali@kali:~$ nmap -sC -sV 172.31.166.143\n${out}` });
    expect(d.scan?.hostId).toBe('h1');
    expect(d.scan?.ports.map((p) => p.port)).toEqual([22, 80]);
    expect(d.scan?.ports[0]).toMatchObject({ protocol: 'tcp', state: 'open', service: 'ssh' });
    expect(d.scan?.os).toBe('linux');
  });
});
