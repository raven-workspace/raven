import { describe, it, expect } from 'vitest';
import { nvdFill } from '../../../engines/findings/nvdFill';
import type { NvdRecord } from '../../../types/findings';

const V31 = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N';
const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

const rec = (over: Partial<NvdRecord>): NvdRecord => ({
  cveId: 'CVE-2020-0001',
  description: null,
  vector: null,
  score: null,
  cwes: [],
  references: [],
  published: null,
  lastModified: null,
  ...over,
});

const empty = { cvssVector: '', description: '', refs: [] as string[] };

describe('nvdFill', () => {
  it('an empty vector takes the highest-scoring record vector', () => {
    const r = nvdFill(empty, [
      rec({ cveId: 'CVE-2020-0001', vector: V31, score: 6.1 }),
      rec({ cveId: 'CVE-2021-0002', vector: V40, score: 9.3 }),
    ]);
    expect(r.apply.cvssVector).toBe(V40);
    expect(r.diffs).toEqual([]);
  });

  it('scores a record without an NVD score from its vector', () => {
    const r = nvdFill(empty, [
      rec({ vector: V40, score: null }),
      rec({ cveId: 'CVE-2021-0002', vector: V31, score: 6.1 }),
    ]);
    expect(r.apply.cvssVector).toBe(V40);
  });

  it('nvdFill offers a diff for a filled vector', () => {
    const r = nvdFill({ ...empty, cvssVector: V31 }, [rec({ vector: V40, score: 9.3 })]);
    expect(r.apply.cvssVector).toBeUndefined();
    expect(r.diffs).toEqual([{ field: 'cvssVector', nvd: V40 }]);
  });

  it('a filled vector equal to NVD offers nothing', () => {
    const r = nvdFill({ ...empty, cvssVector: ` ${V40} ` }, [rec({ vector: V40, score: 9.3 })]);
    expect(r.apply.cvssVector).toBeUndefined();
    expect(r.diffs).toEqual([]);
  });

  it('compares vectors by meaning, not text', () => {
    const nvd = [rec({ vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', score: 9.8 })];
    expect(nvdFill({ ...empty, cvssVector: 'av:n/ac:l/pr:n/ui:n/s:u/c:h/i:h/a:h' }, nvd).diffs).toEqual([]);
    expect(nvdFill({ ...empty, cvssVector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L' }, nvd).diffs).toEqual([
      { field: 'cvssVector', nvd: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
    ]);
  });

  it('an empty description fills', () => {
    const r = nvdFill(empty, [rec({ description: 'Stored XSS in the comment field.' })]);
    expect(r.apply.description).toBe('Stored XSS in the comment field.');
  });

  it('a filled description gets a diff, never an overwrite', () => {
    const r = nvdFill({ ...empty, description: 'My words.' }, [rec({ description: 'NVD words.' })]);
    expect(r.apply.description).toBeUndefined();
    expect(r.diffs).toEqual([{ field: 'description', nvd: 'NVD words.' }]);
  });

  it('refs gain the URLs and CWE-79, deduplicated', () => {
    const r = nvdFill({ ...empty, refs: ['CVE-2020-0001', 'https://a.example/advisory'] }, [
      rec({ cwes: ['CWE-79'], references: ['https://a.example/advisory', 'https://b.example/patch'] }),
      rec({ cveId: 'CVE-2021-0002', cwes: ['CWE-79'], references: ['https://b.example/patch'] }),
    ]);
    expect(r.apply.refs).toEqual(['CVE-2020-0001', 'https://a.example/advisory', 'https://b.example/patch', 'CWE-79']);
  });

  it('an exploit-db URL also adds its EDB reference', () => {
    const r = nvdFill(empty, [rec({ references: ['https://www.exploit-db.com/exploits/12345'] })]);
    expect(r.apply.refs).toEqual(['https://www.exploit-db.com/exploits/12345', 'EDB-12345']);
  });

  it('no new refs leaves refs out of apply', () => {
    const r = nvdFill({ ...empty, refs: ['CWE-79'] }, [rec({ cwes: ['CWE-79'] })]);
    expect(r.apply.refs).toBeUndefined();
    expect(nvdFill(empty, [])).toEqual({ apply: {}, diffs: [] });
  });
});
