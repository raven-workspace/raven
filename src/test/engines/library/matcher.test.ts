import { describe, it, expect } from 'vitest';
import { firstBinary, matchesCommand, matchLine } from '../../../engines/library/matcher';
import type { LibraryCommand } from '../../../engines/library/types';

describe('firstBinary', () => {
  it('takes the basename on a Windows path and drops .exe', () => {
    expect(firstBinary('C:\\Tools\\winPEASx64.exe')).toBe('winpeasx64');
    expect(firstBinary('.\\winPEASx64.exe quiet')).toBe('winpeasx64');
    expect(firstBinary('whoami.exe /priv')).toBe('whoami');
    expect(firstBinary('/usr/bin/nmap -p- x')).toBe('nmap');
    // a matcher listing `x.exe` or `.\\x.exe` still matches
    expect(matchesCommand('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -ep bypass', { bins: ['powershell.exe'] })).toBe(true);
    expect(matchesCommand('.\\winPEASx64.exe', { bins: ['winpeasx64'] })).toBe(true);
  });

  it('strips sudo, proxychains, env and time before the binary', () => {
    expect(firstBinary('sudo proxychains -q nmap -p- x')).toBe('nmap');
    expect(firstBinary('proxychains4 -q nmap x')).toBe('nmap');
    expect(firstBinary('env FOO=1 time nxc smb x')).toBe('nxc');
    expect(firstBinary('/usr/bin/impacket-secretsdump a')).toBe('impacket-secretsdump');
    expect(firstBinary('sudo -u bob -E nmap x')).toBe('nmap');
    expect(firstBinary('FOO=1 nohup Gobuster dir')).toBe('gobuster');
    expect(firstBinary('')).toBeNull();
  });
  it('a wrapper with nothing after its flags is the binary itself', () => {
    expect(firstBinary('sudo -l')).toBe('sudo');
    expect(firstBinary('sudo -ll')).toBe('sudo');
    expect(firstBinary('env')).toBe('env');
    expect(firstBinary('sudo -u root /bin/bash')).toBe('bash');
  });
});

describe('matchesCommand', () => {
  const m = { bins: ['nmap'], any: ['(^|\\s)-p-(\\s|$)', '-p\\s*0?-?1?-65535'] };
  it('requires all, any and none', () => {
    expect(matchesCommand('nmap -p- 10.0.0.5', m)).toBe(true);
    expect(matchesCommand('nmap -p 1-65535 x', m)).toBe(true);
    expect(matchesCommand('nmap -sC -sV 10.0.0.5', m)).toBe(false);
    expect(matchesCommand('nmap --top-ports 1000 x', m)).toBe(false);
    expect(matchesCommand('nmap -p- --top-ports 10', { ...m, none: ['--top-ports'] })).toBe(false);
    expect(matchesCommand('nmap -p- -sV x', { bins: ['nmap'], all: ['-sV'] })).toBe(true);
    expect(matchesCommand('nmap -p- x', { bins: ['nmap'], all: ['-sV'] })).toBe(false);
  });
  it('bins compare case-insensitively and invalid regex never matches', () => {
    expect(matchesCommand('NMAP x', { bins: ['Nmap'] })).toBe(true);
    expect(matchesCommand('nmap x', { bins: ['nmap'], all: ['('] })).toBe(false);
    expect(matchesCommand('nmap x', { bins: ['nmap'], any: ['('] })).toBe(false);
  });
});

describe('matchesCommand line scoping', () => {
  const full = { bins: ['nmap'], any: ['(^|\\s)-p-(\\s|$)'] };
  it('invalid none pattern blocks the match', () => {
    expect(matchesCommand('nmap -p- x', { ...full, none: ['('] })).toBe(false);
  });
  it('ignores flags after a command separator', () => {
    expect(matchesCommand('nmap -sV 10.0.0.5; echo -p-', full)).toBe(false);
    expect(matchesCommand('nmap -sV x && echo -p-', full)).toBe(false);
    expect(matchesCommand('nmap -sV x | grep -p- y', full)).toBe(false);
  });
  it('ignores flags in a trailing comment', () => {
    expect(matchesCommand('nmap -sV x # -p-', full)).toBe(false);
  });
  it('keeps quoted separators', () => {
    expect(matchesCommand("nmap -p- 'a;b'", full)).toBe(true);
    expect(matchesCommand('nmap "a#b" -p-', full)).toBe(true);
  });
});

describe('matchLine', () => {
  const base: Omit<LibraryCommand, 'id'> = { title: 't', tool: 't', template: 't', os: 'any', runFrom: 'attacker', goals: [], source: 'raven' };
  it('returns only commands with a matcher that fits', () => {
    const lib: LibraryCommand[] = [
      { ...base, id: 'a', match: { bins: ['nmap'] } },
      { ...base, id: 'b', match: { bins: ['nxc'] } },
      { ...base, id: 'c' },
    ];
    expect(matchLine('sudo nmap x', lib).map((c) => c.id)).toEqual(['a']);
  });
});
