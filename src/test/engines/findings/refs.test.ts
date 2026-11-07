import { describe, it, expect } from 'vitest';
import { suggestRefs } from '../../../engines/findings/refs';

describe('suggestRefs', () => {
  it('finds CVE and EDB ids, unique, in order of first appearance', () => {
    expect(
      suggestRefs(['see CVE-2021-41773 and EDB-ID: 50383', 'https://www.exploit-db.com/exploits/50383']),
    ).toEqual(['CVE-2021-41773', 'EDB-50383']);
  });

  it('reads every EDB form and normalises CVE case', () => {
    expect(suggestRefs(['EDB-ID 42315 then cve-2017-0144', 'exploit-db.com/exploits/1', 'EDB-ID:7'])).toEqual([
      'EDB-42315',
      'CVE-2017-0144',
      'EDB-1',
      'EDB-7',
    ]);
  });

  it('needs four or more digits after the year', () => {
    expect(suggestRefs(['CVE-2021-123 CVE-21-12345 CVE-2024-123456'])).toEqual(['CVE-2024-123456']);
  });

  it('nothing to offer in empty text', () => {
    expect(suggestRefs([])).toEqual([]);
    expect(suggestRefs(['', 'no ids here'])).toEqual([]);
  });
});
