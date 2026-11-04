import { describe, it, expect } from 'vitest';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import type { Tunnel } from '../../../types/network';
import { fillCommand, tunnelFor, type FillInput } from '../../../engines/checklist';

const host = (p: Partial<Host> = {}): Host => ({
  id: 'h1', engagementId: 'e1', name: 'ms01', ip: '172.16.1.5', os: 'windows', boardColumn: 'enumerate', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, ...p,
});
const eng = (p: Partial<Engagement> = {}): Engagement => ({
  id: 'e1', name: 'Eng', kind: 'lab', client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null,
  endsAt: null, timeboxStart: null, timeboxMinutes: null, status: 'active', createdAt: 0, updatedAt: 0,
  lastActivityAt: null, lastRanOn: null, msfHostId: null, ...p,
});
const tun = (p: Partial<Tunnel> = {}): Tunnel => ({
  id: 't1', engagementId: 'e1', kind: 'ligolo', viaHostId: 'pivot', subnets: ['172.16.1.0/24'], callbackIp: '240.0.0.1',
  status: 'up', notes: null, createdAt: 0, updatedAt: 0, ...p,
});
let n = 0;
const svc = (hostId: string, port: number): Service => ({
  id: `s${n++}`, hostId, port, protocol: 'tcp', state: 'open', nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 0, updatedAt: 0,
});
const input = (p: Partial<FillInput> = {}): FillInput => ({
  host: host(), engagement: eng(), hosts: [], servicesByHost: new Map(), tunnels: [], attackerIp: '10.10.14.3',
  listenerPort: '4444', ...p,
});
const adServices = (id: string) => new Map([[id, [svc(id, 88), svc(id, 389)]]]);

describe('fillCommand', () => {
  it('fills target, domain and DC', () => {
    const dc = host({ id: 'dc', name: 'dc01', ip: '10.0.0.10' });
    const r = fillCommand('nxc smb {TARGET_IP} -d {DOMAIN} --dc {DC_IP} {DC_HOST}', input({
      host: host({ ip: '10.0.0.5' }), engagement: eng({ domain: 'corp.local' }), hosts: [dc], servicesByHost: adServices('dc'),
    }));
    expect(r.text).toBe('nxc smb 10.0.0.5 -d corp.local --dc 10.0.0.10 dc01.corp.local');
    expect(r.unresolved).toEqual([]);
  });

  it('uses an FQDN DC name as is', () => {
    const dc = host({ id: 'dc', name: 'dc01.corp.local', ip: '10.0.0.10' });
    const r = fillCommand('{DC_HOST}', input({ engagement: eng({ domain: 'x.y' }), hosts: [dc], servicesByHost: adServices('dc') }));
    expect(r.text).toBe('dc01.corp.local');
  });

  it('fill leaves USER/PASS/HASH unresolved', () => {
    const r = fillCommand('x -u {USER} -p {PASS} -H {HASH}', input());
    expect(r.text).toBe('x -u {USER} -p {PASS} -H {HASH}');
    expect(r.unresolved).toEqual(['USER', 'PASS', 'HASH']);
  });

  it('LHOST comes from the tunnel callback when the host is behind a tunnel, else from the attacker IP setting', () => {
    const pivot = host({ id: 'pivot', name: 'web01', ip: '10.0.0.2' });
    const behind = fillCommand('nc {LHOST} {LPORT} {TUNNEL_IP}', input({ hosts: [pivot], tunnels: [tun()] }));
    expect(behind.text).toBe('nc 240.0.0.1 4444 240.0.0.1');
    expect(behind.viaTunnel).toMatchObject({ viaHostName: 'web01', down: false });
    const direct = fillCommand('nc {LHOST} {TUNNEL_IP}', input({ host: host({ ip: '10.0.0.5' }), tunnels: [tun()] }));
    expect(direct.text).toBe('nc 10.10.14.3 {TUNNEL_IP}');
    expect(direct.viaTunnel).toBeUndefined();
    expect(direct.unresolved).toEqual(['TUNNEL_IP']);
  });

  it('down tunnel still sets LHOST with down=true', () => {
    const r = fillCommand('nc {LHOST}', input({ tunnels: [tun({ status: 'down' })] }));
    expect(r.text).toBe('nc 240.0.0.1');
    expect(r.viaTunnel?.down).toBe(true);
  });

  it('ignores invalid subnets and trims whitespace', () => {
    const h = host();
    expect(tunnelFor(h, [tun({ subnets: ['172.16.1.0/24 '] })])).not.toBeNull();
    expect(tunnelFor(h, [tun({ subnets: ['garbage', '172.16.1.0/33'] })])).toBeNull();
    expect(tunnelFor(h, [tun({ subnets: ['0.0.0.0/0'] })])).not.toBeNull();
    expect(tunnelFor(h, [tun({ subnets: [' 172.16.1.5'] })])).not.toBeNull();
  });

  it('unknown values stay unresolved, never blank or placeholder defaults', () => {
    const r = fillCommand('x {PASS} {LHOST} {TARGET_IP} {FILL_SHARE}', input({ host: host({ ip: '' }), attackerIp: '' }));
    expect(r.text).toBe('x {PASS} {LHOST} {TARGET_IP} {FILL_SHARE}');
    expect(r.unresolved).toEqual(expect.arrayContaining(['PASS', 'LHOST', 'TARGET_IP', 'FILL_SHARE']));
  });

  it('INTERFACE keeps tun0 and is never listed', () => {
    const r = fillCommand('{INTERFACE}', input());
    expect(r.text).toBe('tun0');
    expect(r.unresolved).toEqual([]);
  });

  it('tunnel with blank callback IP leaves LHOST unresolved and sets viaTunnel', () => {
    const r = fillCommand('nc {LHOST}', input({ tunnels: [tun({ callbackIp: ' ' })] }));
    expect(r.text).toBe('nc {LHOST}');
    expect(r.unresolved).toContain('LHOST');
    expect(r.viaTunnel).toBeDefined();
  });

  it('a pivot never takes its own tunnel callback as LHOST, even when its IP is in the tunnel subnet', () => {
    const pivot = host({ id: 'pivot', ip: '10.10.5.141' });
    const behind = host({ id: 'ms02', ip: '10.10.5.142' });
    const tunnels = [tun({ subnets: ['10.10.5.0/24'], callbackIp: '10.10.5.141' })];
    expect(tunnelFor(pivot, tunnels)).toBeNull();
    const r = fillCommand('nc {LHOST} {LPORT}', input({ host: pivot, hosts: [pivot, behind], tunnels }));
    expect(r.text).toBe('nc 10.10.14.3 4444');
    expect(r.viaTunnel).toBeUndefined();
    expect(tunnelFor(behind, tunnels)?.id).toBe('t1');
  });

  it('subnet comes from the pivot tunnel, else the scope range not containing the host', () => {
    const e = eng({ scopeCidrs: ['172.31.50.0/24', '172.16.10.0/24'] });
    const r = fillCommand('{SUBNET} {SUBNET_PREFIX}', input({ host: host({ ip: '172.31.50.5' }), engagement: e }));
    expect(r.text).toBe('172.16.10.0/24 172.16.10');
    const pivot = host({ id: 'pivot', ip: '172.31.50.5' });
    const r2 = fillCommand('{SUBNET}', input({
      host: pivot, engagement: eng({ scopeCidrs: ['172.31.50.0/24'] }), tunnels: [tun({ subnets: ['10.5.5.0/24'] })],
    }));
    expect(r2.text).toBe('10.5.5.0/24');
  });

  it('scope fills SUBNET only when exactly one other range exists', () => {
    const fill = (scopeCidrs: string[]) =>
      fillCommand('{SUBNET}', input({ host: host({ ip: '172.31.50.5' }), engagement: eng({ scopeCidrs }) }));
    expect(fill(['172.31.50.0/24', '172.16.10.0/24']).text).toBe('172.16.10.0/24');
    expect(fill(['172.31.50.0/24', '172.16.10.0/24', '10.10.20.0/24']).unresolved).toEqual(['SUBNET']);
    expect(fill(['172.31.50.0/24']).unresolved).toEqual(['SUBNET']);
    expect(fill(['172.16.10.0/24', '10.10.20.0/24']).unresolved).toEqual(['SUBNET']);
  });

  it('subnet prefix is unresolved for non-/24 ranges', () => {
    const r = fillCommand('{SUBNET} {SUBNET_PREFIX}', input({ host: host({ ip: '1.2.3.4' }), engagement: eng({ scopeCidrs: ['10.9.0.0/16'] }) }));
    expect(r.text).toBe('10.9.0.0/16 {SUBNET_PREFIX}');
    expect(r.unresolved).toEqual(['SUBNET_PREFIX']);
  });

  it('DC fields stay unresolved when two hosts are AD', () => {
    const a = host({ id: 'a' });
    const b = host({ id: 'b' });
    const sbh = new Map([...adServices('a'), ...adServices('b')]);
    const r = fillCommand('{DC_IP}', input({ hosts: [a, b], servicesByHost: sbh }));
    expect(r.unresolved).toEqual(['DC_IP']);
  });
});
