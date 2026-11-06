import { describe, expect, it } from 'vitest';
import type { LibraryCommand } from '../../../engines/library/types';
import { searchPalette, withoutSecrets, type PaletteContext } from '../../../features/palette/search';

const cmd = (id: string, over: Partial<LibraryCommand> = {}): LibraryCommand =>
  ({ id, title: id, tool: 'tool', template: id, os: 'any', runFrom: 'attacker', goals: [], source: 'raven', ...over }) as LibraryCommand;

const ctx = (library: LibraryCommand[], over: Partial<PaletteContext> = {}): PaletteContext => ({
  library, cards: [], generators: [], ...over,
});

describe('searchPalette', () => {
  it('every query word must prefix-match', () => {
    const lib = [
      cmd('a', { title: 'Enumerate SMB shares', tool: 'smbclient' }),
      cmd('b', { title: 'Enumerate LDAP', tool: 'ldapsearch' }),
    ];
    const ids = (q: string) => searchPalette(q, ctx(lib)).map((r) => r.id);
    expect(ids('enum smb')).toEqual(['a']);
    expect(ids('enum')).toEqual(['a', 'b']);
    expect(ids('num smb')).toEqual([]); // prefix of a word, not a substring
    expect(ids('enum zzz')).toEqual([]);
  });

  it('matches cards by title and file name and groups results', () => {
    const r = searchPalette('kerb', ctx([cmd('c1', { title: 'Kerberoast' })], {
      cards: [{ id: 'k', title: 'Kerberos notes', stage: 'x', category: 'ad', os: 'windows', file: '03-AD/kerb-cheatsheet.md' }],
      generators: [{ id: 'g1', title: 'Kerberos ticket helper' }],
      engagementItems: [{ id: 'i1', kind: 'log', title: 'kerbrute run', text: '' }],
    }));
    expect(r.map((x) => x.type)).toEqual(['command', 'generator', 'card', 'item']);
  });

  it('host OS and stage commands rank first', () => {
    const lib = [
      cmd('lin', { title: 'Run enum linux', os: 'linux', goals: ['h-pe-win-auto'] }),
      cmd('win-other', { title: 'Run enum win other', os: 'windows', goals: [] }),
      cmd('win-stage', { title: 'Run enum win stage', os: 'windows', goals: ['h-pe-win-auto'] }),
      cmd('any', { title: 'Run enum any' }),
    ];
    const ids = searchPalette('run', ctx(lib, { os: 'windows', stageId: 'privilege-escalation' })).map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(['win-stage', 'win-other']);
    expect(ids.indexOf('lin')).toBeGreaterThan(ids.indexOf('win-other'));
  });

  it('banned commands are excluded in exam-sim and msf is locked to its host', () => {
    const lib = [cmd('ok', { title: 'Run ok' }), cmd('ban', { title: 'Run ban', exam: 'banned' }), cmd('msf', { title: 'Run msf', exam: 'metasploit' })];
    const sim = (msfHostId: string | null) => searchPalette('run', ctx(lib, { exam: { kind: 'exam-sim', hostId: 'h1', msfHostId } }));
    expect(sim(null).map((r) => r.id)).toEqual(['ok', 'msf']);
    expect(sim('h2').map((r) => r.id)).toEqual(['ok']);
    expect(sim('h1').map((r) => r.id)).toContain('msf');
    expect(searchPalette('run', ctx(lib)).map((r) => r.id)).toContain('ban');
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
