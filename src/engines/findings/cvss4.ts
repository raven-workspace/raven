/**
 * cvss4.ts
 * CVSS v4.0 scoring, ported from FIRST's reference calculator, and the version-aware entry points
 * `parseCvssAny` / `scoreCvss` used for every stored vector (3.0, 3.1 and 4.0).
 *
 * Source: https://github.com/FIRSTdotorg/cvss-v4-calculator, commit c5b0d409ae9f57c44264c6ce5f27d89298e1d32a
 * (2024-08-19): `cvss_score.js` (cvss_score, macroVector, m, getEQMaxes, extractValueMetric). The arithmetic is
 * kept step for step, including the floating-point level values, so scores match the calculator exactly.
 * The data tables are in cvss4Lookup.ts. Copyright FIRST, Red Hat, and contributors. BSD-2-Clause.
 */

import { calculateCvssScore, parseCvssVector } from './cvss';
import { CVSS4_LOOKUP, CVSS4_MAX_COMPOSED, CVSS4_MAX_SEVERITY } from './cvss4Lookup';

export type CvssVersion = '3.0' | '3.1' | '4.0';

/** The eleven base metrics, in vector order. */
export const CVSS4_BASE_KEYS = ['AV', 'AC', 'AT', 'PR', 'UI', 'VC', 'VI', 'VA', 'SC', 'SI', 'SA'] as const;

const CVSS4_VALUES: Record<string, readonly string[]> = {
  AV: ['N', 'A', 'L', 'P'],
  AC: ['L', 'H'],
  AT: ['N', 'P'],
  PR: ['N', 'L', 'H'],
  UI: ['N', 'P', 'A'],
  VC: ['H', 'L', 'N'],
  VI: ['H', 'L', 'N'],
  VA: ['H', 'L', 'N'],
  SC: ['H', 'L', 'N'],
  SI: ['H', 'L', 'N'],
  SA: ['H', 'L', 'N'],
  // Threat
  E: ['X', 'A', 'P', 'U'],
  // Environmental
  CR: ['X', 'H', 'M', 'L'],
  IR: ['X', 'H', 'M', 'L'],
  AR: ['X', 'H', 'M', 'L'],
  MAV: ['X', 'N', 'A', 'L', 'P'],
  MAC: ['X', 'L', 'H'],
  MAT: ['X', 'N', 'P'],
  MPR: ['X', 'N', 'L', 'H'],
  MUI: ['X', 'N', 'P', 'A'],
  MVC: ['X', 'H', 'L', 'N'],
  MVI: ['X', 'H', 'L', 'N'],
  MVA: ['X', 'H', 'L', 'N'],
  MSC: ['X', 'H', 'L', 'N'],
  MSI: ['X', 'S', 'H', 'L', 'N'],
  MSA: ['X', 'S', 'H', 'L', 'N'],
  // Supplemental (never change the score)
  S: ['X', 'N', 'P'],
  AU: ['X', 'N', 'Y'],
  R: ['X', 'A', 'U', 'I'],
  V: ['X', 'D', 'C'],
  RE: ['X', 'L', 'M', 'H'],
  U: ['X', 'Clear', 'Green', 'Amber', 'Red'],
};

/** Parses a `CVSS:4.0/…` vector: all eleven base metrics once, plus any valid optional metric once. */
function parseCvss4(parts: string[]): Record<string, string> | null {
  const found: Record<string, string> = {};
  for (const part of parts) {
    const [key, value, ...rest] = part.split(':');
    if (rest.length > 0 || !key || !value) return null;
    const metric = key.toUpperCase();
    const allowed = CVSS4_VALUES[metric];
    const val = allowed?.find((a) => a.toUpperCase() === value.toUpperCase());
    if (!val || found[metric] !== undefined) return null;
    found[metric] = val;
  }
  return CVSS4_BASE_KEYS.every((k) => found[k] !== undefined) ? found : null;
}

/**
 * Parses a CVSS 3.0, 3.1 or 4.0 vector. 4.0 needs its `CVSS:4.0/` prefix; an unprefixed 3.x vector is read as 3.1.
 * Returns null for anything else.
 */
export function parseCvssAny(vector: string): { version: CvssVersion; metrics: Record<string, string> } | null {
  if (typeof vector !== 'string') return null;
  const v = vector.trim();
  const parts = v.split('/').filter((p) => p.length > 0);
  if (parts.length > 0 && /^CVSS:4\.0$/i.test(parts[0])) {
    const metrics = parseCvss4(parts.slice(1));
    return metrics ? { version: '4.0', metrics } : null;
  }
  const m3 = parseCvssVector(v);
  if (!m3) return null;
  return { version: /^CVSS:3\.0\//i.test(v) ? '3.0' : '3.1', metrics: { ...m3 } };
}

/** Base score of any supported vector (3.0, 3.1 or 4.0); null when it does not parse. */
export function scoreCvss(vector: string): number | null {
  const p = parseCvssAny(vector);
  if (!p) return null;
  return p.version === '4.0' ? cvss4Score(p.metrics) : calculateCvssScore(vector);
}

// --- FIRST reference port -------------------------------------------------------------------------------

const AV_LEVELS: Record<string, number> = { N: 0.0, A: 0.1, L: 0.2, P: 0.3 };
const PR_LEVELS: Record<string, number> = { N: 0.0, L: 0.1, H: 0.2 };
const UI_LEVELS: Record<string, number> = { N: 0.0, P: 0.1, A: 0.2 };
const AC_LEVELS: Record<string, number> = { L: 0.0, H: 0.1 };
const AT_LEVELS: Record<string, number> = { N: 0.0, P: 0.1 };
const VC_LEVELS: Record<string, number> = { H: 0.0, L: 0.1, N: 0.2 };
const VI_LEVELS: Record<string, number> = { H: 0.0, L: 0.1, N: 0.2 };
const VA_LEVELS: Record<string, number> = { H: 0.0, L: 0.1, N: 0.2 };
const SC_LEVELS: Record<string, number> = { H: 0.1, L: 0.2, N: 0.3 };
const SI_LEVELS: Record<string, number> = { S: 0.0, H: 0.1, L: 0.2, N: 0.3 };
const SA_LEVELS: Record<string, number> = { S: 0.0, H: 0.1, L: 0.2, N: 0.3 };
const CR_LEVELS: Record<string, number> = { H: 0.0, M: 0.1, L: 0.2 };
const IR_LEVELS: Record<string, number> = { H: 0.0, M: 0.1, L: 0.2 };
const AR_LEVELS: Record<string, number> = { H: 0.0, M: 0.1, L: 0.2 };

/** The effective value of `metric`: X defaults to the worst case, modified metrics override base ones. */
function m(sel: Record<string, string>, metric: string): string | undefined {
  const selected = sel[metric];
  if (metric === 'E' && (selected === 'X' || selected === undefined)) return 'A';
  if ((metric === 'CR' || metric === 'IR' || metric === 'AR') && (selected === 'X' || selected === undefined)) return 'H';
  const modified = sel['M' + metric];
  if (modified !== undefined && modified !== 'X') return modified;
  return selected;
}

/** The six EQ levels as a MacroVector string, e.g. "000200". */
export function cvss4MacroVector(sel: Record<string, string>): string {
  const AV = m(sel, 'AV');
  const PR = m(sel, 'PR');
  const UI = m(sel, 'UI');
  let eq1: string;
  if (AV === 'N' && PR === 'N' && UI === 'N') eq1 = '0';
  else if ((AV === 'N' || PR === 'N' || UI === 'N') && AV !== 'P') eq1 = '1';
  else eq1 = '2';

  const eq2 = m(sel, 'AC') === 'L' && m(sel, 'AT') === 'N' ? '0' : '1';

  const VC = m(sel, 'VC');
  const VI = m(sel, 'VI');
  const VA = m(sel, 'VA');
  let eq3: string;
  if (VC === 'H' && VI === 'H') eq3 = '0';
  else if (VC === 'H' || VI === 'H' || VA === 'H') eq3 = '1';
  else eq3 = '2';

  let eq4: string;
  if (m(sel, 'MSI') === 'S' || m(sel, 'MSA') === 'S') eq4 = '0';
  else if (m(sel, 'SC') === 'H' || m(sel, 'SI') === 'H' || m(sel, 'SA') === 'H') eq4 = '1';
  else eq4 = '2';

  const E = m(sel, 'E');
  const eq5 = E === 'A' ? '0' : E === 'P' ? '1' : '2';

  const eq6 =
    (m(sel, 'CR') === 'H' && VC === 'H') || (m(sel, 'IR') === 'H' && VI === 'H') || (m(sel, 'AR') === 'H' && VA === 'H')
      ? '0'
      : '1';

  return eq1 + eq2 + eq3 + eq4 + eq5 + eq6;
}

function extractValueMetric(metric: string, str: string): string {
  const extracted = str.slice(str.indexOf(metric) + metric.length + 1);
  return extracted.indexOf('/') > 0 ? extracted.substring(0, extracted.indexOf('/')) : extracted;
}

/** A MacroVector's score, or NaN when that MacroVector does not exist (as in the reference). */
const lookup = (macro: string): number => CVSS4_LOOKUP[macro] ?? NaN;

/** Official FIRST CVSS v4.0 score (0.0 - 10.0) for parsed metrics, e.g. from `parseCvssAny`. */
export function cvss4Score(sel: Record<string, string>): number {
  if (['VC', 'VI', 'VA', 'SC', 'SI', 'SA'].every((metric) => m(sel, metric) === 'N')) return 0.0;

  const macro = cvss4MacroVector(sel);
  let value = lookup(macro);

  const eq1 = parseInt(macro[0]);
  const eq2 = parseInt(macro[1]);
  const eq3 = parseInt(macro[2]);
  const eq4 = parseInt(macro[3]);
  const eq5 = parseInt(macro[4]);
  const eq6 = parseInt(macro[5]);

  const at = (a: number, b: number, c: number, d: number, e: number, f: number) => `${a}${b}${c}${d}${e}${f}`;

  const scoreEq1NextLower = lookup(at(eq1 + 1, eq2, eq3, eq4, eq5, eq6));
  const scoreEq2NextLower = lookup(at(eq1, eq2 + 1, eq3, eq4, eq5, eq6));

  // EQ3 and EQ6 are related.
  let scoreEq3Eq6NextLower: number;
  if (eq3 === 1 && eq6 === 1) scoreEq3Eq6NextLower = lookup(at(eq1, eq2, eq3 + 1, eq4, eq5, eq6)); // 11 -> 21
  else if (eq3 === 0 && eq6 === 1) scoreEq3Eq6NextLower = lookup(at(eq1, eq2, eq3 + 1, eq4, eq5, eq6)); // 01 -> 11
  else if (eq3 === 1 && eq6 === 0) scoreEq3Eq6NextLower = lookup(at(eq1, eq2, eq3, eq4, eq5, eq6 + 1)); // 10 -> 11
  else if (eq3 === 0 && eq6 === 0) {
    // 00 -> 01 or 00 -> 10: take the higher one (NaN compares false, as in the reference)
    const left = lookup(at(eq1, eq2, eq3, eq4, eq5, eq6 + 1));
    const right = lookup(at(eq1, eq2, eq3 + 1, eq4, eq5, eq6));
    scoreEq3Eq6NextLower = left > right ? left : right;
  } else scoreEq3Eq6NextLower = lookup(at(eq1, eq2, eq3 + 1, eq4, eq5, eq6 + 1)); // 21 -> 32 (does not exist)

  const scoreEq4NextLower = lookup(at(eq1, eq2, eq3, eq4 + 1, eq5, eq6));
  const scoreEq5NextLower = lookup(at(eq1, eq2, eq3, eq4, eq5 + 1, eq6));

  const eq1Maxes = CVSS4_MAX_COMPOSED.eq1[macro[0]];
  const eq2Maxes = CVSS4_MAX_COMPOSED.eq2[macro[1]];
  const eq3Eq6Maxes = CVSS4_MAX_COMPOSED.eq3[macro[2]][macro[5]];
  const eq4Maxes = CVSS4_MAX_COMPOSED.eq4[macro[3]];
  const eq5Maxes = CVSS4_MAX_COMPOSED.eq5[macro[4]];

  const maxVectors: string[] = [];
  for (const a of eq1Maxes) for (const b of eq2Maxes) for (const c of eq3Eq6Maxes) for (const d of eq4Maxes) for (const e of eq5Maxes) {
    maxVectors.push(a + b + c + d + e);
  }

  // Find the highest-severity vector the scored vector is at or below; if none fits, the last one's
  // distances are used (the reference keeps the loop variables after the loop).
  let dAV = 0, dPR = 0, dUI = 0, dAC = 0, dAT = 0, dVC = 0, dVI = 0, dVA = 0, dSC = 0, dSI = 0, dSA = 0, dCR = 0, dIR = 0, dAR = 0;
  for (const max of maxVectors) {
    const d = (levels: Record<string, number>, metric: string) =>
      levels[m(sel, metric) as string] - levels[extractValueMetric(metric, max)];
    dAV = d(AV_LEVELS, 'AV');
    dPR = d(PR_LEVELS, 'PR');
    dUI = d(UI_LEVELS, 'UI');
    dAC = d(AC_LEVELS, 'AC');
    dAT = d(AT_LEVELS, 'AT');
    dVC = d(VC_LEVELS, 'VC');
    dVI = d(VI_LEVELS, 'VI');
    dVA = d(VA_LEVELS, 'VA');
    dSC = d(SC_LEVELS, 'SC');
    dSI = d(SI_LEVELS, 'SI');
    dSA = d(SA_LEVELS, 'SA');
    dCR = d(CR_LEVELS, 'CR');
    dIR = d(IR_LEVELS, 'IR');
    dAR = d(AR_LEVELS, 'AR');
    if ([dAV, dPR, dUI, dAC, dAT, dVC, dVI, dVA, dSC, dSI, dSA, dCR, dIR, dAR].some((x) => x < 0)) continue;
    break;
  }

  const currentEq1 = dAV + dPR + dUI;
  const currentEq2 = dAC + dAT;
  const currentEq3Eq6 = dVC + dVI + dVA + dCR + dIR + dAR;
  const currentEq4 = dSC + dSI + dSA;

  const step = 0.1;

  // Maximal scoring difference to the next lower MacroVector (NaN when there is none).
  const availableEq1 = value - scoreEq1NextLower;
  const availableEq2 = value - scoreEq2NextLower;
  const availableEq3Eq6 = value - scoreEq3Eq6NextLower;
  const availableEq4 = value - scoreEq4NextLower;
  const availableEq5 = value - scoreEq5NextLower;

  let nExistingLower = 0;
  let normEq1 = 0;
  let normEq2 = 0;
  let normEq3Eq6 = 0;
  let normEq4 = 0;
  let normEq5 = 0;

  const maxSeverityEq1 = CVSS4_MAX_SEVERITY.eq1[eq1] * step;
  const maxSeverityEq2 = CVSS4_MAX_SEVERITY.eq2[eq2] * step;
  const maxSeverityEq3Eq6 = CVSS4_MAX_SEVERITY.eq3eq6[eq3][eq6] * step;
  const maxSeverityEq4 = CVSS4_MAX_SEVERITY.eq4[eq4] * step;

  if (!isNaN(availableEq1)) {
    nExistingLower += 1;
    normEq1 = availableEq1 * (currentEq1 / maxSeverityEq1);
  }
  if (!isNaN(availableEq2)) {
    nExistingLower += 1;
    normEq2 = availableEq2 * (currentEq2 / maxSeverityEq2);
  }
  if (!isNaN(availableEq3Eq6)) {
    nExistingLower += 1;
    normEq3Eq6 = availableEq3Eq6 * (currentEq3Eq6 / maxSeverityEq3Eq6);
  }
  if (!isNaN(availableEq4)) {
    nExistingLower += 1;
    normEq4 = availableEq4 * (currentEq4 / maxSeverityEq4);
  }
  if (!isNaN(availableEq5)) {
    // EQ5's proportion is always 0.
    nExistingLower += 1;
    normEq5 = availableEq5 * 0;
  }

  const meanDistance =
    nExistingLower === 0 ? 0 : (normEq1 + normEq2 + normEq3Eq6 + normEq4 + normEq5) / nExistingLower;

  value -= meanDistance;
  if (value < 0) value = 0.0;
  if (value > 10) value = 10.0;
  return Math.round(value * 10) / 10;
}
