import { describe, it, expect } from 'vitest';
import { parseScopeList, ipInScope } from '../../../engines/parse/scope';

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
