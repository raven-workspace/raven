import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../../../engines/checklist/template';

describe('resolveTemplate', () => {
  const ctx = { lhost: '10.10.14.3', lport: '9001', rhost: '10.0.0.5', customVars: {} };

  it("leaves curl's %{http_code} write-out alone", () => {
    const r = resolveTemplate("curl -s -o /dev/null -w '%{http_code}\\n' http://{TARGET_IP}/", ctx);
    expect(r.text).toBe("curl -s -o /dev/null -w '%{http_code}\\n' http://10.0.0.5/");
    expect(r.unresolved).toEqual([]);
  });

  it('substitutes the case-insensitive target, LHOST and LPORT aliases', () => {
    const r = resolveTemplate('{TARGET_IP} {target} {IP} {TARGET-IP} {LHOST} {lport} <LHOST>', ctx);
    expect(r.text).toBe('10.0.0.5 10.0.0.5 10.0.0.5 10.0.0.5 10.10.14.3 9001 10.10.14.3');
    expect(r.unresolved).toEqual([]);
  });

  it('lowercase {ip}/{port} are the attacker side; legacyAliases makes {ip} the target', () => {
    expect(resolveTemplate('/dev/tcp/{ip}/{port}', ctx).text).toBe('/dev/tcp/10.10.14.3/9001');
    expect(resolveTemplate('nmap {ip}', ctx, { legacyAliases: true }).text).toBe('nmap 10.0.0.5');
  });

  it('activeTargetIp wins over rhost', () => {
    expect(resolveTemplate('{TARGET_IP}', { ...ctx, activeTargetIp: '1.2.3.4' }).text).toBe('1.2.3.4');
  });

  it('empty known fields show a default but are reported unresolved; INTERFACE defaults to tun0', () => {
    const r = resolveTemplate('{LHOST} {INTERFACE}', {});
    expect(r.text).toBe('10.10.14.X tun0');
    expect(r.unresolved).toEqual(['LHOST', 'INTERFACE']);
  });

  it('leaves ${VAR}, $(cmd), %VAR% and single-char braces untouched', () => {
    const t = 'echo ${HOME} $(id) %USERNAME% |%{0}';
    const r = resolveTemplate(t, ctx);
    expect(r.text).toBe(t);
    expect(r.unresolved).toEqual([]);
  });

  it('unknown tokens stay and are reported; custom vars match case-insensitively', () => {
    const r = resolveTemplate('{FILL_X} {fill_y}', { customVars: { FILL_Y: 'v' } });
    expect(r.text).toBe('{FILL_X} v');
    expect(r.unresolved).toEqual(['FILL_X']);
  });

  it('global-field tokens fall back to a same-named custom variable', () => {
    expect(resolveTemplate('{DOMAIN}', { domain: 'a.local', customVars: { DOMAIN: 'b' } }).text).toBe('a.local');
    expect(resolveTemplate('{DOMAIN}', { customVars: { DOMAIN: 'b' } }).text).toBe('b');
    expect(resolveTemplate('{DC-IP}', { dcIp: '10.0.0.10' }).text).toBe('10.0.0.10');
  });

  it('reports ranges for every token', () => {
    const r = resolveTemplate('a {TARGET_IP} b {NOPE}', ctx);
    expect(r.ranges).toEqual([
      { start: 2, end: 13, raw: 'TARGET_IP', canonical: 'rhost', resolved: true },
      { start: 16, end: 22, raw: 'NOPE', canonical: null, resolved: false },
    ]);
  });

  it('empty template yields empty result', () => {
    expect(resolveTemplate('', ctx)).toEqual({ text: '', unresolved: [], ranges: [] });
  });
});
