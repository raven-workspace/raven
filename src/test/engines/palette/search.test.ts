import { describe, expect, it } from 'vitest';
import type { LibraryCommand } from '../../../engines/library/types';
import { parseNote } from '../../../engines/manual';
import { searchPalette, withoutSecrets, type PaletteContext } from '../../../features/palette/search';

const cmd = (id: string, over: Partial<LibraryCommand> = {}): LibraryCommand =>
  ({ id, title: id, tool: 'tool', template: id, os: 'any', runFrom: 'attacker', goals: [], source: 'raven', ...over }) as LibraryCommand;

const ctx = (library: LibraryCommand[], over: Partial<PaletteContext> = {}): PaletteContext => ({
  library, cards: [], generators: [], ...over,
});

describe('searchPalette', () => {
  it('Manual notes come back on their own, title hits first, with the matching line and section', () => {
    // Synthetic notes only.
    const body = parseNote('04-Foundations/Zz Codes.md', '# Zz Codes\n## Status\n| `ZZ_LOGON_FAILED` | wrong password |\n')!;
    const titled = parseNote('04-Foundations/Logon Failed Zz.md', '# Logon Failed Zz\n')!;
    const r = searchPalette('logon failed', ctx([cmd('c1', { title: 'Logon failed check' })], { notes: [body, titled] }));
    expect(r.groups.flatMap((g) => g.hits).map((h) => h.id)).toEqual(['c1']);
    expect(r.manual).toEqual([
      { type: 'manual', id: titled.id, title: 'Logon Failed Zz', noteId: titled.id, line: '' },
      { type: 'manual', id: body.id, title: 'Zz Codes', noteId: body.id, anchor: 'status', line: 'ZZ_LOGON_FAILED  wrong password' },
    ]);
    expect(searchPalette('logon failed', ctx([])).manual).toEqual([]);
  });

  it('every query word must prefix-match', () => {
    const lib = [
      cmd('a', { title: 'Enumerate SMB shares', tool: 'smbclient' }),
      cmd('b', { title: 'Enumerate LDAP', tool: 'ldapsearch' }),
    ];
    const ids = (q: string) => searchPalette(q, ctx(lib)).groups.flatMap((g) => g.hits).map((r) => r.id);
    expect(ids('enum smb')).toEqual(['a']);
    expect(ids('enum')).toEqual(['b', 'a']);
    expect(ids('num smb')).toEqual([]); // prefix of a word, not a substring
    expect(ids('enum zzz')).toEqual([]);
  });

  it('matches cards by title and file name and groups results', () => {
    const r = searchPalette('kerb', ctx([cmd('c1', { title: 'Kerberoast' })], {
      cards: [{ id: 'k', title: 'Kerberos notes', stage: 'x', category: 'ad', os: 'windows', file: '03-AD/kerb-cheatsheet.md' }],
      generators: [{ id: 'g1', title: 'Kerberos ticket helper', category: 'Active-Directory' }],
      engagementItems: [{ id: 'i1', kind: 'log', title: 'kerbrute run', text: '' }],
    }));
    expect(r.groups.flatMap((g) => g.hits).map((x) => x.type).sort()).toEqual(['card', 'command', 'generator']);
    expect(r.items.map((x) => x.type)).toEqual(['item']);
  });

  it('hosts are found by name and IP', () => {
    const items = [{ id: 'h1', kind: 'host' as const, title: 'fs01', text: '10.10.20.21' }];
    expect(searchPalette('10.10.20.21', ctx([], { engagementItems: items })).items[0]!.id).toBe('h1');
    expect(searchPalette('fs0', ctx([], { engagementItems: items })).items[0]!.id).toBe('h1');
  });

  it('banned commands are excluded in exam-sim and msf is locked to its host', () => {
    const lib = [cmd('ok', { title: 'Run ok' }), cmd('ban', { title: 'Run ban', exam: 'banned' }), cmd('msf', { title: 'Run msf', exam: 'metasploit' })];
    const sim = (msfHostId: string | null) => searchPalette('run', ctx(lib, { exam: { kind: 'exam-sim', hostId: 'h1', msfHostId } })).groups.flatMap((g) => g.hits);
    expect(sim(null).map((r) => r.id)).toEqual(['msf', 'ok']);
    expect(sim('h2').map((r) => r.id)).toEqual(['ok']);
    expect(sim('h1').map((r) => r.id)).toContain('msf');
    expect(searchPalette('run', ctx(lib)).groups.flatMap((g) => g.hits).map((r) => r.id)).toContain('ban');
  });
});

describe('withoutSecrets', () => {
  it('cuts out each secret, whole and per LM:NT half, in any case', () => {
    const lm = 'aad3b435b51404eeaad3b435b51404ee';
    const nt = '31d6cfe0d16ae931b73c59d7e0c089c0';
    const out = withoutSecrets(`-p 'P@ss.w0rd(1)' -H ${nt.toUpperCase()} ${lm}:${nt}`, ['P@ss.w0rd(1)', `${lm}:${nt}`, '  ']);
    expect(out).not.toMatch(/P@ss|31d6|aad3/i);
    expect(out).toContain('-p');
    expect(withoutSecrets('nothing here', [])).toBe('nothing here');
  });
});
