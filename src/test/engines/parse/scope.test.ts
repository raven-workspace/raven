import { describe, it, expect } from 'vitest';
import { parseScopeList, ipInScope, extractIps, isIgnoredIp } from '../../../engines/parse/scope';

describe('parseScopeList', () => {
  it('splits, trims, dedupes, skips comments and reports invalid tokens', () => {
    expect(parseScopeList('10.10.60.95\n10.10.60.96, 10.10.10.0/24\n# dmz\nfoo\n10.10.60.95')).toEqual({
      entries: ['10.10.60.95', '10.10.60.96', '10.10.10.0/24'],
      invalid: ['foo'],
    });
  });
});

describe('ipInScope', () => {
  it('matches exact IPs and CIDR ranges', () => {
    expect(ipInScope('10.10.10.7', ['10.10.10.0/24'])).toBe(true);
    expect(ipInScope('10.10.11.7', ['10.10.10.0/24'])).toBe(false);
    expect(ipInScope('10.10.60.95', ['10.10.60.95'])).toBe(true);
    expect(ipInScope('1.2.3.4', [])).toBe(false);
  });
});

describe('extractIps', () => {
  it('finds unique valid IPv4s in first-seen order', () => {
    expect(extractIps('nxc smb 10.0.0.12 -u a; curl http://10.0.0.5:8080/x 999.1.1.1')).toEqual(['10.0.0.12', '10.0.0.5']);
  });
  it('does not match a prefix of a longer address', () => {
    expect(extractIps('10.0.0.12').includes('10.0.0.1')).toBe(false);
  });
});

describe('isIgnoredIp', () => {
  it('ignores unspecified, loopback and LHOST', () => {
    expect(isIgnoredIp('127.0.0.1')).toBe(true);
    expect(isIgnoredIp('0.0.0.0')).toBe(true);
    expect(isIgnoredIp('10.10.64.213', '10.10.64.213')).toBe(true);
    expect(isIgnoredIp('10.10.60.97', '10.10.64.213')).toBe(false);
  });
});
