/**
 * refs.ts
 * Reference ids found in free text (log entries, notes), offered as one-click chips on a finding (host-page spec §4.5).
 */

// One pass per text, so ids come out in the order they appear. Groups: CVE year and number, then the EDB number
// from `EDB-ID: <n>` / `EDB-ID <n>`, then from an exploit-db.com URL.
const REF = /\b(?:CVE-(\d{4})-(\d{4,}))\b|\bEDB-ID:?\s*(\d+)|exploit-db\.com\/exploits\/(\d+)/gi;

/** Unique `CVE-YYYY-N…` and `EDB-<n>` ids, in order of first appearance across `texts`. */
export function suggestRefs(texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(REF)) {
      const ref = m[1] ? `CVE-${m[1]}-${m[2]}` : `EDB-${m[3] ?? m[4]}`;
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

/** True for a CVE id (the refs NVD can look up). */
export const isCveId = (ref: string): boolean => /^CVE-\d{4}-\d{4,}$/i.test(ref.trim());
