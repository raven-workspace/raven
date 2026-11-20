import { describe, it, expect } from 'vitest';
import { parseMultiHostScan } from '../../../engines/parse/scan';

// Characterization tests: they pin what parseMultiHostScan returns today, format by format.

describe('parseMultiHostScan', () => {
  it('returns nothing for empty input', () => {
    expect(parseMultiHostScan('')).toEqual([]);
    expect(parseMultiHostScan('   \n ')).toEqual([]);
  });

  describe('nmap XML', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE nmaprun [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<nmaprun scanner="nmap">
  <host>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <address addr="AA:BB:CC:DD:EE:FF" addrtype="mac"/>
    <hostnames><hostname name="dc01.corp.local"/><hostname name="dc01"/><hostname name="dc01.corp.local"/></hostnames>
    <ports>
      <port protocol="tcp" portid="53"><state state="open"/><service name="domain" product="Simple DNS Plus"/></port>
      <port protocol="TCP" portid="88"><state state="open|filtered"/><service name="Kerberos-Sec" product="Microsoft Windows Kerberos" version="5" extrainfo="server time"/></port>
      <port protocol="tcp" portid="135"><state state="closed"/><service name="msrpc"/></port>
      <port protocol="tcp" portid="445"><state state="filtered"/></port>
      <port protocol="tcp" portid="3389"><state state="open"/></port>
    </ports>
    <os><osmatch name="Windows Server 2019"/><osmatch name="Windows 10"/></os>
  </host>
  <host>
    <address addr="fe80::1" addrtype="ipv6"/>
    <ports><port protocol="udp" portid="161"><state state="open"/><service name="snmp"/></port></ports>
  </host>
  <host>
    <hostnames><hostname name="ghost"/></hostnames>
    <ports><port protocol="tcp" portid="8080"><state state="open"/><service name="http-proxy"/></port></ports>
  </host>
  <host>
    <status state="down"/>
  </host>
  <host>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <hostnames><hostname name="dc01-alt"/></hostnames>
    <ports><port protocol="tcp" portid="636"><state state="open"/><service name="ldaps"/></port></ports>
    <os><osmatch name="Ignored OS"/></os>
  </host>
</nmaprun>`;

    it('keeps every host, merging a repeated ip and keeping a host with no address', () => {
      expect(parseMultiHostScan(xml)).toEqual([
        {
          ip: '10.0.0.1',
          hostnames: ['dc01.corp.local', 'dc01', 'dc01-alt'],
          os: 'Windows Server 2019',
          ports: [
            { port: 53, protocol: 'tcp', state: 'open', service: 'domain', version: 'Simple DNS Plus' },
            { port: 88, protocol: 'tcp', state: 'open|filtered', service: 'kerberos-sec', version: 'Microsoft Windows Kerberos 5 server time' },
            { port: 3389, protocol: 'tcp', state: 'open', service: 'unknown', version: 'Unknown Version' },
            { port: 636, protocol: 'tcp', state: 'open', service: 'ldaps', version: 'Unknown Version' },
          ],
        },
        {
          ip: 'fe80::1',
          hostnames: [],
          os: undefined,
          ports: [{ port: 161, protocol: 'udp', state: 'open', service: 'snmp', version: 'Unknown Version' }],
        },
        {
          ip: '',
          hostnames: ['ghost'],
          os: undefined,
          ports: [{ port: 8080, protocol: 'tcp', state: 'open', service: 'http-proxy', version: 'Unknown Version' }],
        },
      ]);
    });

    it('reads a bare <host> fragment only inside an nmaprun', () => {
      expect(parseMultiHostScan('<host><address addr="10.0.0.9"/></host>')).toEqual([]);
      expect(parseMultiHostScan('<nmaprun><host><address addr="10.0.0.9"/></host></nmaprun>')).toEqual([
        { ip: '10.0.0.9', hostnames: [], os: undefined, ports: [] },
      ]);
    });

    it('returns nothing for malformed XML', () => {
      expect(parseMultiHostScan('<?xml version="1.0"?><nmaprun><host>')).toEqual([]);
    });

    it('caps ports per host at 512 and hosts at 256', () => {
      const ports = Array.from({ length: 600 }, (_, i) => `<port protocol="tcp" portid="${i + 1}"><state state="open"/></port>`).join('');
      const one = parseMultiHostScan(`<nmaprun><host><address addr="10.0.0.1"/><ports>${ports}</ports></host></nmaprun>`);
      expect(one[0].ports).toHaveLength(512);
      expect(one[0].ports[511].port).toBe(512);
      const hosts = Array.from({ length: 300 }, (_, i) => `<host><address addr="10.1.${i >> 8}.${i & 255}"/></host>`).join('');
      const many = parseMultiHostScan(`<nmaprun>${hosts}</nmaprun>`);
      expect(many).toHaveLength(256);
      expect(many[255].ip).toBe('10.1.0.255');
    });
  });

  describe('gnmap', () => {
    it('reads each Host line, merging a repeated ip', () => {
      const gnmap = [
        '# Nmap 7.94 scan initiated',
        'Host: 10.0.0.1 (dc01.corp.local)\tStatus: Up',
        'Host: 10.0.0.1 (dc01.corp.local)\tPorts: 22/open/tcp//ssh//OpenSSH 8.2/, 80/closed/tcp//http///, 161/open|filtered/UDP//SNMP///, 99999/open/tcp//bad///, 443/open/tcp//https/x/\tOS: Linux 5.x\tSeq Index: 1',
        'Host: 10.0.0.2 ()\tPorts: 3389/open/tcp//ms-wbt-server///',
        'Host: 10.0.0.1 (other-name)\tPorts: 8080/open/tcp//http-proxy///\tOS: Ignored',
        'Host: not-an-ip (x)\tPorts: 21/open/tcp//ftp///',
        '# Nmap done',
      ].join('\n');
      expect(parseMultiHostScan(gnmap)).toEqual([
        {
          ip: '10.0.0.1',
          hostnames: ['dc01.corp.local', 'other-name'],
          os: 'Linux 5.x',
          ports: [
            { port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'OpenSSH 8.2' },
            { port: 161, protocol: 'udp', state: 'open|filtered', service: 'snmp', version: 'Unknown Version' },
            // The last port entry runs on to the end of the line, so its version picks up the fields after it.
            { port: 443, protocol: 'tcp', state: 'open', service: 'https', version: 'OS: Linux 5.x\tSeq Index: 1' },
            { port: 8080, protocol: 'tcp', state: 'open', service: 'http-proxy', version: 'Unknown Version' },
          ],
        },
        {
          ip: '10.0.0.2',
          hostnames: [],
          os: undefined,
          ports: [{ port: 3389, protocol: 'tcp', state: 'open', service: 'ms-wbt-server', version: 'Unknown Version' }],
        },
      ]);
    });

    it('caps hosts at 256 and ports per host at 512', () => {
      const ports = Array.from({ length: 600 }, (_, i) => `${i + 1}/open/tcp//svc///`).join(', ');
      const one = parseMultiHostScan(`Host: 10.0.0.1 ()\tPorts: ${ports}`);
      expect(one[0].ports).toHaveLength(512);
      const lines = Array.from({ length: 300 }, (_, i) => `Host: 10.1.${i >> 8}.${i & 255} ()\tPorts: 22/open/tcp//ssh///`).join('\n');
      expect(parseMultiHostScan(lines)).toHaveLength(256);
    });
  });

  describe('nmap text', () => {
    it('reads each scan report, with and without a hostname, IPv4 and IPv6', () => {
      const text = `Starting Nmap 7.94
Nmap scan report for dc01.corp.local (10.0.0.1)
Host is up (0.01s latency).
PORT     STATE         SERVICE VERSION
22/tcp   open          ssh     OpenSSH 8.2p1 Ubuntu
80/tcp   closed        http
161/UDP  open|filtered SNMP
| ssh-hostkey:
|_  3072 aa:bb (RSA)
Service Info: Host: dc01; OSs: Linux, Windows; CPE: cpe:/o:linux

Nmap scan report for 10.0.0.2
PORT    STATE SERVICE
445/tcp open  microsoft-ds

Nmap scan report for web (fe80::1%eth0)
443/tcp open https

Nmap scan report for 10.0.0.2
8080/tcp open http-proxy Jetty
Service Info: OS: Windows

Nmap scan report for down.host (10.0.0.3)
Host seems down.

Nmap scan report for nameonly
21/tcp open ftp
`;
      expect(parseMultiHostScan(text)).toEqual([
        {
          ip: '10.0.0.1',
          hostnames: ['dc01.corp.local'],
          os: 'Linux, Windows',
          ports: [
            { port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'OpenSSH 8.2p1 Ubuntu' },
            { port: 161, protocol: 'udp', state: 'open|filtered', service: 'snmp', version: 'Unknown Version' },
          ],
        },
        {
          ip: '10.0.0.2',
          hostnames: [],
          os: 'Windows',
          ports: [
            { port: 445, protocol: 'tcp', state: 'open', service: 'microsoft-ds', version: 'Unknown Version' },
            { port: 8080, protocol: 'tcp', state: 'open', service: 'http-proxy', version: 'Jetty' },
          ],
        },
        {
          ip: 'fe80::1%eth0',
          hostnames: ['web'],
          os: undefined,
          ports: [{ port: 443, protocol: 'tcp', state: 'open', service: 'https', version: 'Unknown Version' }],
        },
        { ip: '10.0.0.3', hostnames: ['down.host'], os: undefined, ports: [] },
        {
          ip: '',
          hostnames: [],
          os: undefined,
          ports: [{ port: 21, protocol: 'tcp', state: 'open', service: 'ftp', version: 'Unknown Version' }],
        },
      ]);
    });

    it('reads headerless port lines as one host, taking the first IPv4 address it sees', () => {
      expect(parseMultiHostScan('scan of 10.0.0.7 and 10.0.0.8\n22/tcp open ssh OpenSSH\n80/tcp closed http\n53/udp open domain')).toEqual([
        {
          ip: '10.0.0.7',
          hostnames: [],
          os: undefined,
          ports: [
            { port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'OpenSSH' },
            { port: 53, protocol: 'udp', state: 'open', service: 'domain', version: 'Unknown Version' },
          ],
        },
      ]);
      expect(parseMultiHostScan('22/tcp open ssh')).toEqual([
        { ip: '', hostnames: [], os: undefined, ports: [{ port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'Unknown Version' }] },
      ]);
    });

    it('returns nothing for text with no report and no open port line', () => {
      expect(parseMultiHostScan('hello 10.0.0.1 world\n80/tcp closed http')).toEqual([]);
    });

    it('caps ports per host at 512 and hosts at 256', () => {
      const lines = Array.from({ length: 600 }, (_, i) => `${i + 1}/tcp open svc`).join('\n');
      expect(parseMultiHostScan(`Nmap scan report for 10.0.0.1\n${lines}`)[0].ports).toHaveLength(512);
      expect(parseMultiHostScan(lines)[0].ports).toHaveLength(512);
      const reports = Array.from({ length: 300 }, (_, i) => `Nmap scan report for 10.1.${i >> 8}.${i & 255}\n22/tcp open ssh`).join('\n');
      expect(parseMultiHostScan(reports)).toHaveLength(256);
    });
  });

  describe('JSON', () => {
    it('reads an array of host objects', () => {
      const json = JSON.stringify([
        { ip: '10.0.0.1', hostnames: ['a', 'b', ''], os: 'Linux', ports: [22, '80', { port: 443, proto: 'TCP', name: 'HTTPS', banner: 'nginx' }, { port: 25, state: 'closed' }, 70000, null] },
        { address: '10.0.0.2', name: 'named', osName: 'Windows', ports: [{ portid: 3389, status: 'open|filtered', serviceName: 'rdp', product: 'MS' }] },
        { host: '10.0.0.1', hostname: 'c', os: 'Ignored', ports: [8080] },
        { ports: [21] },
        { ports: [21] },
        { names: ['noports'] },
        'not an object',
      ]);
      expect(parseMultiHostScan(json)).toEqual([
        {
          ip: '10.0.0.1',
          hostnames: ['a', 'b', 'c'],
          os: 'Linux',
          ports: [
            { port: 22, protocol: 'tcp', state: 'open', service: 'unknown', version: 'Unknown Version' },
            { port: 80, protocol: 'tcp', state: 'open', service: 'unknown', version: 'Unknown Version' },
            { port: 443, protocol: 'tcp', state: 'open', service: 'https', version: 'nginx' },
            { port: 8080, protocol: 'tcp', state: 'open', service: 'unknown', version: 'Unknown Version' },
          ],
        },
        {
          ip: '10.0.0.2',
          hostnames: ['named'],
          os: 'Windows',
          ports: [{ port: 3389, protocol: 'tcp', state: 'open|filtered', service: 'rdp', version: 'MS' }],
        },
        { ip: '', hostnames: [], os: undefined, ports: [{ port: 21, protocol: 'tcp', state: 'open', service: 'unknown', version: 'Unknown Version' }] },
        { ip: '', hostnames: [], os: undefined, ports: [{ port: 21, protocol: 'tcp', state: 'open', service: 'unknown', version: 'Unknown Version' }] },
      ]);
    });

    it('reads an object keyed by ip, ignoring a bare name there', () => {
      const json = JSON.stringify({
        '10.0.0.5': { name: 'not-a-hostname', ports: [{ port: 22, service: 'ssh' }] },
        '10.0.0.6': { ip: '10.0.0.60', hostname: 'six', ports: [] },
      });
      expect(parseMultiHostScan(json)).toEqual([
        { ip: '10.0.0.5', hostnames: [], os: undefined, ports: [{ port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'Unknown Version' }] },
        { ip: '10.0.0.60', hostnames: ['six'], os: undefined, ports: [] },
      ]);
    });

    it('falls through to the text formats when JSON yields no host', () => {
      expect(parseMultiHostScan('[]')).toEqual([]);
      expect(parseMultiHostScan('{ not json\nNmap scan report for 10.0.0.9\n22/tcp open ssh')).toEqual([
        { ip: '10.0.0.9', hostnames: [], os: undefined, ports: [{ port: 22, protocol: 'tcp', state: 'open', service: 'ssh', version: 'Unknown Version' }] },
      ]);
    });

    it('caps hosts at 256 and ports per host at 512', () => {
      const many = Array.from({ length: 300 }, (_, i) => ({ ip: `10.1.${i >> 8}.${i & 255}` }));
      expect(parseMultiHostScan(JSON.stringify(many))).toHaveLength(256);
      const ports = Array.from({ length: 600 }, (_, i) => i + 1);
      expect(parseMultiHostScan(JSON.stringify([{ ip: '10.0.0.1', ports }]))[0].ports).toHaveLength(512);
    });
  });
});
