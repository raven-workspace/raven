import { describe, it, expect } from 'vitest';
import { cvss4Score, parseCvssAny, scoreCvss } from '../../../engines/findings/cvss4';
import { calculateCvssScore } from '../../../engines/findings/cvss';

/**
 * Expected scores come from FIRST's reference CVSS v4.0 calculator
 * (https://github.com/FIRSTdotorg/cvss-v4-calculator, commit c5b0d409ae9f57c44264c6ce5f27d89298e1d32a,
 * 2024-08-19 — the code behind https://www.first.org/cvss/calculator/4.0). Each vector was run through its
 * unmodified cvss_score.js / cvss_lookup.js / max_composed.js / max_severity.js with node; the MacroVector
 * it reported is listed beside each score.
 */
const FIRST_V4: Array<[string, number]> = [
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', 9.3], // 000200
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N', 0], // no impact
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H', 10], // 000100
  ['CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', 8.5], // 100200
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N', 5.3], // 102201
  ['CVSS:4.0/AV:N/AC:H/AT:P/PR:L/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N', 2], // 112201
  ['CVSS:4.0/AV:P/AC:H/AT:P/PR:H/UI:A/VC:L/VI:L/VA:L/SC:L/SI:L/SA:L', 1], // 212201
  ['CVSS:4.0/AV:A/AC:L/AT:N/PR:N/UI:N/VC:H/VI:L/VA:N/SC:N/SI:N/SA:N', 7.1], // 101200
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', 8.7], // 100200
  ['CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', 9.2], // 010200
  ['CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:A/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', 8.4], // 100200
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N', 8.7], // 001200
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:L/SI:N/SA:N', 6.9], // 002201
  // threat metric, and NVD-style vectors that spell out every optional metric as X
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:U', 8.1], // 000220
  [
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:X/CR:X/IR:X/AR:X/MAV:X/MAC:X/MAT:X/MPR:X/MUI:X/MVC:X/MVI:X/MVA:X/MSC:X/MSI:X/MSA:X/S:X/AU:X/R:X/V:X/RE:X/U:X',
    9.3,
  ], // 000200
  ['CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:L/SC:N/SI:N/SA:N/MSI:S', 8.9], // 002001
];

describe('cvss4Score (FIRST CVSS v4.0)', () => {
  it.each(FIRST_V4)('%s = %s', (vector, expected) => {
    const parsed = parseCvssAny(vector);
    expect(parsed?.version).toBe('4.0');
    expect(cvss4Score(parsed!.metrics)).toBe(expected);
    expect(scoreCvss(vector)).toBe(expected);
  });

  it.each([
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N', // SA missing
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:S', // SA:S only valid as MSA
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/SA:N', // repeated
    'CVSS:4.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', // 3.1 metrics under a 4.0 prefix
    'AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', // 4.0 needs its prefix
    'CVSS:4.1/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
  ])('rejects %j', (vector) => {
    expect(parseCvssAny(vector)).toBeNull();
    expect(scoreCvss(vector)).toBeNull();
  });
});

describe('parseCvssAny / scoreCvss', () => {
  it('reads an unprefixed 3.x vector as 3.1', () => {
    const p = parseCvssAny('AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(p?.version).toBe('3.1');
    expect(p?.metrics.AV).toBe('N');
    expect(scoreCvss('AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
  });

  it('keeps the 3.0 / 3.1 prefix and score', () => {
    expect(parseCvssAny('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')?.version).toBe('3.0');
    expect(parseCvssAny('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')?.version).toBe('3.1');
    expect(scoreCvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
  });

  it('calculateCvssScore stays a 3.x-only alias', () => {
    expect(calculateCvssScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(calculateCvssScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseCvssAny('')).toBeNull();
    expect(parseCvssAny('nope')).toBeNull();
    expect(scoreCvss('CVSS:2.0/AV:N')).toBeNull();
  });
});
