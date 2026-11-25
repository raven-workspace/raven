import { describe, it, expect } from 'vitest';
import {
  canonicalToken, CREDENTIAL_TOKENS, findPlaceholders, hasPlaceholders, replacePlaceholders, resolveTemplate, SECRET_TOKENS,
} from '../../../engines/checklist/template';
import { tokensOf } from '../../../features/arsenal/fillTokens';

describe('resolveTemplate', () => {
  const ctx = { lhost: '10.10.14.3', lport: '9001', rhost: '10.0.0.5', customVars: {} };

  it("leaves curl's %{http_code} write-out alone", () => {
    const r = resolveTemplate("curl -s -o /dev/null -w '%{http_code}\\n' http://{TARGET_IP}/", ctx);
    expect(r.text).toBe("curl -s -o /dev/null -w '%{http_code}\\n' http://10.0.0.5/");
    expect(r.unresolved).toEqual([]);
  });

  it('substitutes the case-insensitive target, LHOST and LPORT aliases; <LHOST> is not a placeholder', () => {
    const r = resolveTemplate('{TARGET_IP} {target} {IP} {TARGET-IP} {LHOST} {lport} <LHOST>', ctx);
    expect(r.text).toBe('10.0.0.5 10.0.0.5 10.0.0.5 10.0.0.5 10.10.14.3 9001 <LHOST>');
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

describe('the placeholder grammar (RAV-48)', () => {
  it('finds {TOKEN}, any case, with its offsets', () => {
    expect(findPlaceholders('a {TARGET_IP} <TARGET> {dc-ip}')).toEqual([
      { start: 2, end: 13, raw: 'TARGET_IP' },
      { start: 23, end: 30, raw: 'dc-ip' },
    ]);
  });

  it('<script>, <TARGET> and XML tags are never placeholders', () => {
    const t = "zz '<script>alert(1)</script>' <TARGET> <searchConnectorDescriptionList> <Password>";
    expect(findPlaceholders(t)).toEqual([]);
    expect(hasPlaceholders(t)).toBe(false);
    expect(resolveTemplate(t, { lhost: '10.10.14.3', rhost: '10.0.0.5' })).toEqual({ text: t, unresolved: [], ranges: [] });
  });

  it('${VAR}, %{x}, $(cmd), %VAR% and single-char braces are never placeholders', () => {
    const t = 'echo ${HOME} -w %{http_code} $(id) %USERNAME% |%{0} <a>';
    expect(findPlaceholders(t)).toEqual([]);
    expect(hasPlaceholders(t)).toBe(false);
  });

  it('agrees with resolveTemplate on every range', () => {
    const t = 'zz {TARGET_IP} ${ZZ} <LHOST> %{x} {ip} {ZZ_THING}';
    expect(findPlaceholders(t).map(({ start, end, raw }) => ({ start, end, raw })))
      .toEqual(resolveTemplate(t, {}).ranges.map(({ start, end, raw }) => ({ start, end, raw })));
  });

  it('replacePlaceholders keeps the text between', () => {
    expect(replacePlaceholders('${A} {BB} x <CC>', (p) => p.raw.toLowerCase())).toBe('${A} bb x <CC>');
  });

  it('canonicalToken folds aliases the way resolveTemplate reads them', () => {
    expect(['TARGET', 'target', 'IP', 'TARGET-IP', 'TARGET_IP'].map(canonicalToken)).toEqual(Array(5).fill('TARGET_IP'));
    expect(canonicalToken('DC-IP')).toBe('DC_IP');
    expect(canonicalToken('ip')).toBe('LHOST');
    expect(canonicalToken('port')).toBe('LPORT');
    expect(canonicalToken('shell')).toBe('SHELL');
    expect(canonicalToken('constructor')).toBe('CONSTRUCTOR');
    expect(canonicalToken('dest_dir')).toBe('DEST_DIR');
  });

  it('secret tokens are the secrets among the credential tokens', () => {
    expect([...SECRET_TOKENS]).toEqual(['PASS', 'HASH', 'CRED']);
    expect([...CREDENTIAL_TOKENS]).toEqual(['USER', 'DOMAIN', 'PASS', 'HASH', 'DC_HOST']);
  });

  it("the Arsenal's fill fields read the same grammar: aliases fold; secrets and ${VAR} are not fields", () => {
    expect(tokensOf(['zz {IP} {DC-IP} -p {PASS} ${ZZ} {ZZ_FILE}'])).toEqual(['TARGET_IP', 'DC_IP', 'ZZ_FILE']);
  });

  it("<script>, <TARGET> and XML tags are never Arsenal fill fields", () => {
    expect(tokensOf(["zz '<script>alert(1)</script>' <TARGET> <searchConnectorDescriptionList> <Password>"])).toEqual([]);
  });
});
