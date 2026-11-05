import { describe, it, expect } from 'vitest';
import type { Engagement } from '../../../types/engagement';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import type { Tunnel } from '../../../types/network';
import type { CredAttempt, Credential } from '../../../types/credentials';
import { defaultCredFor, defaultDomainCred, fillCommand, hasUnmodelledQuoting, quoteContextAt, tunnelFor, type FillInput } from '../../../engines/checklist';

const host = (p: Partial<Host> = {}): Host => ({
  id: 'h1', engagementId: 'e1', name: 'ms01', ip: '172.16.1.5', os: 'windows', boardColumn: 'information-gathering', boardManual: false,
  access: 'none', createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
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

const cred = (p: Partial<Credential> = {}): Credential => ({
  id: 'c1', engagementId: 'e1', type: 'password', username: 'alice', domain: 'CORP', secret: 'Winter2024!', hashType: null,
  scope: 'domain', localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...p,
});
const att = (p: Partial<CredAttempt> = {}): CredAttempt => ({
  id: 'a1', engagementId: 'e1', credId: 'c1', usernameId: null, hostId: 'h1', service: 'smb', port: null, result: 'valid',
  authMode: 'domain', detail: null, logEntryId: null, at: 10, ...p,
});
const NT = '  AAD3B435B51404EEAAD3B435B51404EE:31D6CFE0D16AE931B73C59D7E0C089C0  ';

describe('credential fill', () => {
  it('fill puts USER and PASS from the picked credential and the NT half for HASH', () => {
    const t = 'x -d {DOMAIN} -u {USER} -p {PASS}';
    const r = fillCommand(t, input({ cred: cred(), engagement: eng({ domain: 'other.local' }) }));
    expect(r.text).toBe('x -d CORP -u alice -p Winter2024!');
    expect(r.unresolved).toEqual([]);
    const h = fillCommand('x -u {USER} -H {HASH}', input({ cred: cred({ type: 'hash', secret: NT }) }));
    expect(h.text).toBe('x -u alice -H 31D6CFE0D16AE931B73C59D7E0C089C0');
    // A password gives no HASH; a hash gives no PASS.
    expect(fillCommand('{HASH}', input({ cred: cred() })).unresolved).toEqual(['HASH']);
    expect(fillCommand('{PASS}', input({ cred: cred({ type: 'hash', secret: NT }) })).unresolved).toEqual(['PASS']);
  });

  it('an ownerless credential has no USER, and an empty secret stays unresolved', () => {
    const r = fillCommand('{USER} {PASS}', input({ cred: cred({ username: '', secret: '  ' }) }));
    expect(r.unresolved).toEqual(['USER', 'PASS']);
  });

  it('displayed text masks PASS and HASH from the real credential; copy text has them', () => {
    const pw = cred({ secret: "pa'ss w0rd" });
    const shown = fillCommand("x -u {USER} -p '{PASS}'", input({ cred: pw }), { secretMask: '********' });
    expect(shown.text).toBe("x -u alice -p '********'");
    expect(shown.text).not.toContain("pa'ss");
    expect(fillCommand("x -p '{PASS}'", input({ cred: pw }), { shellSafe: true }).text).toBe(String.raw`x -p 'pa'\''ss w0rd'`);
    const hash = cred({ type: 'hash', secret: NT });
    const h = fillCommand('x -H {HASH}', input({ cred: hash }), { secretMask: '********' });
    expect(h.text).toBe('x -H ********');
    expect(h.text).not.toMatch(/31D6/i);
    // Masked or not, a hash credential still gives no PASS.
    expect(fillCommand('{PASS}', input({ cred: hash }), { secretMask: '********' }).unresolved).toEqual(['PASS']);
  });
});

describe('defaultCredFor', () => {
  const creds = [cred({ id: 'c1' }), cred({ id: 'c2', username: 'bob' }), cred({ id: 'c3', username: 'carol' })];
  it('picks the newest credential with a valid or admin attempt on the host', () => {
    const attempts = [
      att({ credId: 'c1', at: 10 }),
      att({ id: 'a2', credId: 'c2', result: 'admin', at: 20 }),
      att({ id: 'a3', credId: 'c3', result: 'failed', at: 30 }),
      att({ id: 'a4', credId: 'c3', hostId: 'other', at: 40 }),
    ];
    expect(defaultCredFor(host(), creds, attempts)?.id).toBe('c2');
    expect(defaultCredFor(host(), creds, [])).toBeNull();
    expect(defaultCredFor(host(), [], attempts)).toBeNull();
  });
});

describe('shell-safe copy (T9-R2)', () => {
  const real = (t: string, secret: string, extra: Partial<Credential> = {}) =>
    fillCommand(t, input({ cred: cred({ secret, ...extra }) }), { shellSafe: true }).text;
  const noBare = (out: string, chars: string) => {
    for (let i = 0; i < out.length; i++) if (chars.includes(out[i])) expect(quoteContextAt(out, i)).not.toBe('bare');
  };

  it('escapes a quote inside single quotes', () => {
    expect(real("x -p '{PASS}'", "pa'ss w0rd")).toBe(String.raw`x -p 'pa'\''ss w0rd'`);
  });
  it('never yields an unquoted ; for an injection attempt', () => {
    const evil = "';curl x|sh;'";
    const quoted = real("x -p '{PASS}'", evil);
    expect(quoted).toBe(String.raw`x -p ''\'';curl x|sh;'\'''`);
    noBare(quoted, ';|');
    noBare(real('x -p {PASS}', evil), ';|');
    noBare(real('x -p "{PASS}"', evil), ';|');
  });
  it('escapes $ ` \\ and " inside double quotes', () => {
    expect(real('x -p "{PASS}"', '$HOME"x')).toBe('x -p "\\$HOME\\"x"');
    expect(real('x -p "{PASS}"', 'a`b\\c')).toBe('x -p "a\\`b\\\\c"');
  });
  it('quotes a bare value with a space or shell character, leaves a safe one alone', () => {
    expect(real('x -p {PASS}', 'two words')).toBe("x -p 'two words'");
    expect(real('x -p {PASS}', 'Winter2024!')).toBe("x -p 'Winter2024!'");
    expect(real('x -p {PASS}', 'Winter2024')).toBe('x -p Winter2024');
    expect(real('x -u {USER}', 'p', { username: 'alice' })).toBe('x -u alice');
    expect(real('x -u {USER}', 'p', { username: 'svc$' })).toBe("x -u 'svc$'");
  });
  it('leaves values raw without shellSafe, and the display mask unchanged', () => {
    expect(fillCommand("x '{PASS}'", input({ cred: cred({ secret: "a'b" }) })).text).toBe("x 'a'b'");
    expect(fillCommand("x '{PASS}'", input({ cred: cred({ secret: "a'b" }) }), { secretMask: '***' }).text).toBe("x '***'");
  });
});

describe('shell-safe copy: DC_HOST and expansion edge cases', () => {
  const dc = host({ id: 'dc', name: 'dc01', ip: '10.0.0.10' });
  const withDomain = (t: string, domain: string) =>
    fillCommand(t, input({ cred: cred({ domain }), hosts: [dc], servicesByHost: adServices('dc') }), { shellSafe: true }).text;
  const noBare = (out: string, chars: string) => {
    for (let i = 0; i < out.length; i++) if (chars.includes(out[i])) expect(quoteContextAt(out, i)).not.toBe('bare');
  };

  it('DC_HOST carrying a hostile credential domain yields no unquoted ;', () => {
    const out = withDomain('bloodyAD --host {DC_HOST} -d x', 'corp.local;id');
    expect(out).toBe("bloodyAD --host 'dc01.corp.local;id' -d x");
    noBare(out, ';');
  });
  it('$(…) in the domain is inert inside the /etc/hosts double-quote shape', () => {
    const out = withDomain('echo "{DC_IP} {DC_HOST} {DOMAIN}" | sudo tee -a /etc/hosts', 'a$(id).local');
    expect(out).toBe(String.raw`echo "10.0.0.10 dc01.a\$(id).local a\$(id).local" | sudo tee -a /etc/hosts`);
  });
  it('quotes a bare value starting with = (zsh =cmd expansion)', () => {
    expect(fillCommand('x {PASS}', input({ cred: cred({ secret: '=ls' }) }), { shellSafe: true }).text).toBe("x '=ls'");
    expect(fillCommand('x {PASS}', input({ cred: cred({ secret: 'a=b' }) }), { shellSafe: true }).text).toBe('x a=b');
  });
  it('neutralises ! in double quotes (history expansion)', () => {
    const out = fillCommand('x "{PASS}"', input({ cred: cred({ secret: 'a!b' }) }), { shellSafe: true }).text;
    expect(out).toBe(`x "a"'!'"b"`);
  });
});

describe('shell-safe copy: nested $(…)', () => {
  it("a quote in the domain is escaped for the single quotes nested inside \"$(echo '…')\"", () => {
    const t = 'ldapsearch -b "$(echo \'DC={DOMAIN}\' | sed s/a/b/)" -w \'{PASS}\'';
    const out = fillCommand(t, input({ cred: cred({ domain: "a'b" }) }), { shellSafe: true }).text;
    expect(out).toContain(String.raw`echo 'DC=a'\''b'`);
    expect(quoteContextAt('"$(x {Y}', 8)).toBe('bare');
    expect(quoteContextAt('"$(x) {Y}', 7)).toBe('double');
  });
  it('flags unmodelled shapes only outside single quotes', () => {
    expect(hasUnmodelledQuoting("x '{FILL}$' y")).toBe(false);
    expect(hasUnmodelledQuoting("x $'a' {PASS}")).toBe(true);
    expect(hasUnmodelledQuoting('x `id` {PASS}')).toBe(true);
  });
});

describe('quoteContextAt', () => {
  it('tracks quotes and backslashes', () => {
    const t = String.raw`a '{X}' "{Y}" {Z} \' {W}`;
    expect(quoteContextAt(t, t.indexOf('{X}'))).toBe('single');
    expect(quoteContextAt(t, t.indexOf('{Y}'))).toBe('double');
    expect(quoteContextAt(t, t.indexOf('{Z}'))).toBe('bare');
    // An escaped quote outside quotes does not open a quote.
    expect(quoteContextAt(t, t.indexOf('{W}'))).toBe('bare');
    const u = String.raw`"a\" {X}"`;
    expect(quoteContextAt(u, u.indexOf('{X}'))).toBe('double');
  });
});

describe('defaultDomainCred', () => {
  it('is the newest domain credential with a valid or admin domain attempt', () => {
    const creds = [cred({ id: 'c1' }), cred({ id: 'c2', scope: 'local' }), cred({ id: 'c3', username: 'bob' })];
    const attempts = [
      att({ credId: 'c1', at: 10 }),
      att({ id: 'a2', credId: 'c2', at: 30 }),
      att({ id: 'a3', credId: 'c3', at: 20, hostId: 'h9' }),
      att({ id: 'a4', credId: 'c3', at: 40, authMode: 'local' }),
    ];
    expect(defaultDomainCred(creds, attempts)?.id).toBe('c3');
    expect(defaultDomainCred(creds, [])).toBeNull();
  });
});
