/**
 * nvdFill.ts
 * Merges NVD lookups into a finding draft (host-page spec §5.4 fill rules). Empty fields fill directly; a field the
 * user already filled is never overwritten: it gets a "use NVD" diff instead.
 */

import type { NvdRecord } from '../../types/findings';
import { parseCvssAny, scoreCvss } from './cvss4';

export type NvdFillable = { cvssVector: string; description: string; refs: string[] };

export interface NvdFillResult {
  apply: Partial<NvdFillable>;
  diffs: { field: 'cvssVector' | 'description'; nvd: string }[];
}

/** Same version and same metrics, whatever the prefix, order or case. Unparseable vectors compare as text. */
function sameVector(a: string, b: string): boolean {
  const pa = parseCvssAny(a);
  const pb = parseCvssAny(b);
  if (!pa || !pb) return a.trim() === b.trim();
  const ka = Object.keys(pa.metrics);
  return (
    pa.version === pb.version &&
    ka.length === Object.keys(pb.metrics).length &&
    ka.every((k) => pa.metrics[k] === pb.metrics[k])
  );
}

const EDB = /exploit-db\.com\/exploits\/(\d+)/i;

/** A record's score: NVD's own, else computed from its vector. */
const recordScore = (r: NvdRecord): number => (r.vector ? (r.score ?? scoreCvss(r.vector) ?? -1) : -1);

export function nvdFill(current: NvdFillable, records: NvdRecord[]): NvdFillResult {
  const apply: Partial<NvdFillable> = {};
  const diffs: NvdFillResult['diffs'] = [];

  // With several CVEs the highest-scoring vector wins (first one on a tie).
  const best = records.reduce<NvdRecord | null>(
    (top, r) => (r.vector && (top === null || recordScore(r) > recordScore(top)) ? r : top),
    null,
  );
  if (best?.vector) {
    const mine = current.cvssVector.trim();
    if (mine === '') apply.cvssVector = best.vector;
    else if (!sameVector(mine, best.vector)) diffs.push({ field: 'cvssVector', nvd: best.vector });
  }

  // The description follows the chosen vector's CVE when it has one, else the first that does.
  const described = [best, ...records].find((r) => r?.description?.trim());
  const description = described?.description?.trim();
  if (description) {
    const mine = current.description.trim();
    if (mine === '') apply.description = description;
    else if (mine !== description) diffs.push({ field: 'description', nvd: description });
  }

  const refs = [...current.refs];
  const add = (ref: string) => {
    if (!refs.includes(ref)) refs.push(ref);
  };
  for (const r of records) {
    for (const url of r.references) {
      add(url);
      const edb = EDB.exec(url);
      if (edb) add(`EDB-${edb[1]}`);
    }
    for (const cwe of r.cwes) add(cwe);
  }
  if (refs.length > current.refs.length) apply.refs = refs;

  return { apply, diffs };
}
