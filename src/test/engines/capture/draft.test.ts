import { describe, it, expect } from 'vitest';
import { buildDraft, detectKind, httpParts, httpTitle, noteTitle, proofShotFlag, screenshotFileName, commandTitle, flagTitle } from '../../../engines/capture';
import { libraryCommand, TEST_LIBRARY } from '../../support/library';

const srv11 = { id: 'h1', name: 'Srv11', ip: '10.10.61.143', column: 'information-gathering' as const };
const base = {
  image: null,
  hosts: [srv11],
  scope: ['10.10.61.0/24'],
  domain: '',
  machines: ['Kali (VM)', 'Docker build', 'Mac'],
  lastRanOn: null,
  library: TEST_LIBRARY,
};

describe('capture draft', () => {
  it('nmap -p- full scan gets library title without the target', () => {
    const d = buildDraft({ ...base, text: 'sudo nmap -p- -Pn 10.10.61.143' });
    expect(d.kind).toBe('command');
    expect(d.title).toBe('Scan every TCP port');
    expect(d.hostIds).toEqual(['h1']);
  });

  it('unmatched command keeps the full first line', () => {
    const line = './exploit.py --target 10.10.61.143 --lport 4444';
    const blocks = [{ command: line, output: '' }];
    expect(commandTitle(blocks, TEST_LIBRARY)).toBe(line);
  });

  it('the title and the kind come from the library passed in', () => {
    const zz = libraryCommand('zz', { title: 'Run zz', match: { bins: ['zzscan'] } });
    const blocks = [{ command: 'zzscan --all', output: '' }];
    expect(commandTitle(blocks, [zz])).toBe('Run zz');
    expect(commandTitle(blocks, [])).toBe('zzscan --all');
    expect(detectKind('zzscan --all', false, [zz])).toBe('command');
    expect(detectKind('zzscan --all', false, [])).toBe('note');
  });

  it('prompt shell attributes target host and ranOn', () => {
    const d = buildDraft({ ...base, text: 'srv11@srv11:~$ id\nuid=1000(srv11)' });
    expect(d.hostIds).toEqual(['h1']);
    expect(d.ranOn).toBe('Srv11');
  });

  it('prompt naming no host falls back to the command line', () => {
    const d = buildDraft({ ...base, text: '*Evil-WinRM* PS C:\\Users\\x> whoami\nx', lastRanOn: 'Kali (VM)' });
    expect(d.hostIds).toEqual([]);
    expect(d.ranOn).toBe('Kali (VM)');
  });

  it('kali prompt sets ranOn to the kali machine', () => {
    const d = buildDraft({ ...base, text: 'kali@kali:~$ ls', lastRanOn: 'Mac' });
    expect(d.ranOn).toBe('Kali (VM)');
    expect(d.hostIds).toEqual([]);
    const none = buildDraft({ ...base, machines: ['Docker build', 'Mac'], text: 'kali@kali:~$ ls', lastRanOn: null });
    expect(none.ranOn).toBe('Docker build');
    expect(buildDraft({ ...base, machines: ['Mac'], text: 'kali@kali:~$ ls', lastRanOn: 'Mac' }).ranOn).toBe('Mac');
  });

  it('kali ssh then target prompt prefers the target host', () => {
    const d = buildDraft({ ...base, text: 'kali@kali:~$ ssh srv11@10.10.61.143\nsrv11@srv11:~$ id\nuid=1000' });
    expect(d.ranOn).toBe('Srv11');
  });

  it('common binary without prompt is a command', () => {
    expect(detectKind('ping -c1 10.0.0.1', false, TEST_LIBRARY)).toBe('command');
    expect(detectKind('./exploit.py --target 1.2.3.4', false, TEST_LIBRARY)).toBe('command');
    expect(detectKind('remember to ping later', false, TEST_LIBRARY)).toBe('note');
  });

  it('http attribution ignores the response body', () => {
    const text = 'GET / HTTP/1.1\nHost: example.com\n\nHTTP/1.1 200 OK\n\nsee 10.10.61.143';
    expect(buildDraft({ ...base, text }).hostIds).toEqual([]);
  });

  it('out-of-output and known IPs are not offered', () => {
    const t = 'kali@kali:~$ ping -c1 10.10.61.150\n64 bytes from 10.10.61.151';
    expect(buildDraft({ ...base, text: t }).unknownScopeIps).toEqual(['10.10.61.150']);
    expect(buildDraft({ ...base, text: 'kali@kali:~$ ping -c1 10.10.61.143' }).unknownScopeIps).toEqual([]);
  });

  it('capture draft ignores out-of-scope IPs', () => {
    const d = buildDraft({ ...base, text: 'kali@kali:~$ ping -c1 8.8.8.8' });
    expect(d.unknownScopeIps).toEqual([]);
  });

  it('unknown in-scope IP is offered', () => {
    const d = buildDraft({ ...base, text: 'kali@kali:~$ ping -c1 10.10.61.150' });
    expect(d.unknownScopeIps).toEqual(['10.10.61.150']);
  });

  it('http title GET :81/', () => {
    const text = 'GET / HTTP/1.1\nHost: 10.10.61.143:81\n\nHTTP/1.1 200 OK\n\nhi';
    const parts = httpParts(text);
    expect(parts.response).toBe('HTTP/1.1 200 OK\n\nhi');
    expect(httpTitle(parts, srv11)).toBe('GET :81/');
    expect(httpTitle(parts, null)).toBe('GET 10.10.61.143:81/');
    expect(buildDraft({ ...base, text }).title).toBe('GET :81/');
  });

  it('screenshot file name 10.10.61.143_info_port81', () => {
    const args = { ip: '10.10.61.143', hostName: 'Srv11', column: 'information-gathering' as const, mime: 'image/png' };
    expect(screenshotFileName({ ...args, caption: 'web on :81' })).toBe('10.10.61.143_info_port81.png');
    expect(screenshotFileName({ ...args, caption: 'Login Page Admin Panel Extra', column: null })).toBe('10.10.61.143_info_login-page-admin.png');
    expect(screenshotFileName({ ...args, ip: null, hostName: null, caption: '', mime: 'image/jpeg', column: 'post-exploitation' })).toBe('engagement_post-ex_shot.jpg');
  });

  it('a proof shot is named for its flag, not the board column', () => {
    const args = { ip: '172.31.148.151', hostName: 'ms01', column: 'privilege-escalation' as const, mime: 'image/png' };
    expect(screenshotFileName({ ...args, caption: '', flag: 'local' })).toBe('172.31.148.151_local-txt.png');
    expect(screenshotFileName({ ...args, caption: 'proof.txt as SYSTEM' })).toBe('172.31.148.151_proof-txt.png');
    expect(screenshotFileName({ ...args, caption: 'Local.txt', flag: null })).toBe('172.31.148.151_local-txt.png');
  });

  it('no two screenshots share a name', () => {
    const args = { ip: '172.31.148.151', hostName: 'ms01', column: 'privilege-escalation' as const, mime: 'image/png', caption: '' };
    const taken = new Set(['172.31.148.151_privesc_shot.png', '172.31.148.151_privesc_shot_2.png', '172.31.148.151_local-txt.png']);
    expect(screenshotFileName({ ...args, taken })).toBe('172.31.148.151_privesc_shot_3.png');
    expect(screenshotFileName({ ...args, flag: 'local', taken })).toBe('172.31.148.151_local-txt_2.png');
  });

  it('proofShotFlag: the host\'s last non-screenshot entry is a recent flag', () => {
    const min = 60_000;
    const flag = (at: number, flagKind: 'local' | 'proof', hostIds = ['h']) => ({ kind: 'flag', hostIds, at, content: { kind: 'flag', flagKind } });
    const cmd = (at: number) => ({ kind: 'command', hostIds: ['h'], at, content: { kind: 'command' } });
    const shot = (at: number) => ({ kind: 'screenshot', hostIds: ['h'], at, content: { kind: 'screenshot' } });
    const now = 100 * min;
    expect(proofShotFlag([cmd(now - 10 * min), flag(now - 2 * min, 'local')], 'h', now)).toBe('local');
    // A second shot of the same proof still counts.
    expect(proofShotFlag([flag(now - 2 * min, 'proof'), shot(now - min)], 'h', now)).toBe('proof');
    expect(proofShotFlag([flag(now - 6 * min, 'local')], 'h', now)).toBeNull();
    expect(proofShotFlag([flag(now - 3 * min, 'local'), cmd(now - min)], 'h', now)).toBeNull();
    expect(proofShotFlag([flag(now - min, 'local', ['other'])], 'h', now)).toBeNull();
    expect(proofShotFlag([flag(now - min, 'local')], null, now)).toBeNull();
  });

  it('32-hex paste is a flag', () => {
    const v = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(detectKind(v, false, TEST_LIBRARY)).toBe('flag');
    expect(buildDraft({ ...base, text: v }).content).toMatchObject({ kind: 'flag', flagKind: 'local', value: v, attachmentId: '' });
    expect(flagTitle('local')).toBe('local.txt');
    expect(flagTitle('proof')).toBe('proof.txt');
    expect(detectKind('x', true, TEST_LIBRARY)).toBe('screenshot');
  });

  it('note title strips heading marks', () => {
    expect(noteTitle('\n## Found creds  \nmore')).toBe('Found creds');
    expect(buildDraft({ ...base, text: '## remember to check the vhost' }).kind).toBe('note');
  });

  it('scan output yields services for the single attributed host', () => {
    const out = [
      'Starting Nmap 7.94',
      'Nmap scan report for 10.10.61.143',
      'PORT   STATE SERVICE VERSION',
      '22/tcp open  ssh     OpenSSH 8.9',
      '80/tcp open  http    Apache httpd 2.4.52',
      'Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel',
    ].join('\n');
    const d = buildDraft({ ...base, text: `kali@kali:~$ nmap -sC -sV 10.10.61.143\n${out}` });
    expect(d.scan?.hostId).toBe('h1');
    expect(d.scan?.ports.map((p) => p.port)).toEqual([22, 80]);
    expect(d.scan?.ports[0]).toMatchObject({ protocol: 'tcp', state: 'open', service: 'ssh' });
    expect(d.scan?.os).toBe('linux');
  });

  describe('scan belongs to the attributed host (C1)', () => {
    const five = { id: 'h5', name: 'web01', ip: '10.0.0.5', column: 'information-gathering' as const };
    const lab = { ...base, hosts: [five], scope: ['10.0.0.0/24'] };
    const multi = [
      'kali@kali:~$ nmap -sV 10.0.0.5 10.0.0.6',
      'Nmap scan report for 10.0.0.5',
      'PORT   STATE SERVICE VERSION',
      '22/tcp open  ssh     OpenSSH 8.9',
      '',
      'Nmap scan report for 10.0.0.6',
      'PORT     STATE SERVICE       VERSION',
      '135/tcp  open  msrpc         Microsoft Windows RPC',
      '445/tcp  open  microsoft-ds',
      'Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows',
    ].join('\n');

    it('multi-host paste keeps only the attributed host\'s ports and no OS from the other host', () => {
      const d = buildDraft({ ...lab, text: multi });
      expect(d.hostIds).toEqual(['h5']);
      expect(d.scan?.hostId).toBe('h5');
      expect(d.scan?.ports.map((p) => p.port)).toEqual([22]);
      expect(d.scan?.os).toBeNull();
    });

    it('multi-host paste with the target listed second takes its own section and OS', () => {
      const six = { id: 'h6', name: 'dc01', ip: '10.0.0.6', column: 'information-gathering' as const };
      const d = buildDraft({ ...lab, hosts: [six], text: multi.replace('10.0.0.5 10.0.0.6', '10.0.0.6') });
      expect(d.scan?.hostId).toBe('h6');
      expect(d.scan?.ports.map((p) => p.port)).toEqual([135, 445]);
      expect(d.scan?.os).toBe('windows');
    });

    it('single-host scan of a different IP than the attributed host gives no scan', () => {
      const text = [
        'kali@kali:~$ nmap -sV 10.0.0.5',
        'Nmap scan report for 10.0.0.7',
        'PORT   STATE SERVICE VERSION',
        '80/tcp open  http    nginx',
      ].join('\n');
      expect(buildDraft({ ...lab, text }).scan).toBeNull();
    });

    it('single-host scan reported by hostname matches the host name', () => {
      const text = [
        'kali@kali:~$ nmap -sV 10.0.0.5',
        'Nmap scan report for web01.corp.local',
        'PORT   STATE SERVICE VERSION',
        '80/tcp open  http    nginx',
      ].join('\n');
      expect(buildDraft({ ...lab, domain: 'corp.local', text }).scan?.ports.map((p) => p.port)).toEqual([80]);
    });
  });

  it('-p- output without versions yields an empty version, not a placeholder (I1)', () => {
    const text = [
      'kali@kali:~$ nmap -p- 10.10.61.143',
      'Nmap scan report for 10.10.61.143',
      'PORT   STATE SERVICE',
      '22/tcp open  ssh',
      '80/tcp open  http',
    ].join('\n');
    const d = buildDraft({ ...base, text });
    expect(d.scan?.ports.map((p) => p.version)).toEqual(['', '']);
  });

  it('kali two-line zsh prompt is a command run on the kali machine (I3)', () => {
    const text = '┌──(kali㉿kali)-[~]\n└─$ whoami\nkali';
    expect(detectKind(text, false, TEST_LIBRARY)).toBe('command');
    const d = buildDraft({ ...base, text, lastRanOn: 'Mac' });
    expect(d.kind).toBe('command');
    expect(d.ranOn).toBe('Kali (VM)');
    expect(d.content).toEqual({ kind: 'command', blocks: [{ shell: 'kali@kali', command: 'whoami', output: 'kali' }] });
  });

  it('rustscan Open ip:port lines yield a blank service, never the parser placeholder (I1)', () => {
    const text = 'kali@kali:~$ rustscan -a 10.10.61.143\nOpen 10.10.61.143:22\nOpen 10.10.61.143:80';
    const d = buildDraft({ ...base, text });
    expect(d.scan?.ports.map((p) => [p.port, p.service, p.version])).toEqual([[22, '', ''], [80, '', '']]);
  });
});

describe('proof pastes and chained commands', () => {
  const proof = [
    'whoami; hostname; ip a',
    'srv11',
    'web01-ubuntu',
    '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
    '    inet 127.0.0.1/8 scope host lo',
    '2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1384 qdisc fq_codel state UP group default qlen 1000',
    '    inet 10.10.61.143/24 brd 10.10.61.255 scope global ens3',
    '',
    'cat /home/srv11/local.txt',
    '22222222222222222222222222222222',
  ].join('\n');

  it('a `;`-chained whoami line is a command', () => {
    expect(detectKind('whoami; hostname; ip a\nsrv11', false, TEST_LIBRARY)).toBe('command');
    expect(detectKind('hostname && id', false, TEST_LIBRARY)).toBe('command');
  });

  it('a block that cats local.txt into a 32-hex line is a flag on the box it ran on', () => {
    expect(detectKind(proof, false, TEST_LIBRARY)).toBe('flag');
    const d = buildDraft({ ...base, text: proof });
    expect(d.content).toMatchObject({ kind: 'flag', flagKind: 'local', value: '22222222222222222222222222222222', proof });
    expect(d.title).toBe('local.txt');
    expect(d.hostIds).toEqual(['h1']);
    expect(d.ranOn).toBe('Srv11');
    // The broadcast address is in scope but is not a box to add.
    expect(d.unknownScopeIps).toEqual([]);
  });

  it('proof.txt read on Windows after a prompt is a proof flag', () => {
    const text = 'PS C:\\Users\\Administrator\\Desktop> type proof.txt\r\nABABABABABABABABABABABABABABABAB \r\n';
    const d = buildDraft({ ...base, text });
    expect(d.kind).toBe('flag');
    expect(d.content).toMatchObject({ flagKind: 'proof', value: 'ABABABABABABABABABABABABABABABAB' });
  });

  it('a bare value has no proof text', () => {
    const v = '22222222222222222222222222222222';
    expect(buildDraft({ ...base, text: v }).content).toMatchObject({ value: v, proof: null });
  });

  it('cat of another file followed by a hash stays a command', () => {
    expect(detectKind('cat /etc/hash.txt\n22222222222222222222222222222222', false, TEST_LIBRARY)).toBe('command');
  });
});
