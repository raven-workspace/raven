const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipToInt(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function parseCidr(entry: string): { base: number; mask: number } | null {
  const [addr, bits, extra] = entry.split('/');
  if (extra !== undefined) return null;
  const base = ipToInt(addr);
  if (base === null) return null;
  if (bits === undefined) return { base, mask: 0xffffffff };
  if (!/^\d{1,2}$/.test(bits)) return null;
  const len = Number(bits);
  if (len > 32) return null;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

/** One IPv4 or IPv4 CIDR per line (also comma or whitespace separated). */
export function parseScopeList(text: string): { entries: string[]; invalid: string[] } {
  const entries: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const content = line.split('#')[0];
    for (const token of content.split(/[\s,]+/)) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      (parseCidr(token) ? entries : invalid).push(token);
    }
  }
  return { entries, invalid };
}

export function ipInScope(ip: string, scope: string[]): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  return scope.some((entry) => {
    const c = parseCidr(entry);
    return c !== null && ((n & c.mask) >>> 0) === c.base;
  });
}

/** The network an address sits in, as a CIDR string: `networkOf("172.16.5.10", 24)` is `"172.16.5.0/24"`. */
export function networkOf(ip: string, prefix: number): string {
  const n = ipToInt(ip);
  if (n === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return `${ip}/${prefix}`;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const base = (n & mask) >>> 0;
  return `${base >>> 24}.${(base >>> 16) & 255}.${(base >>> 8) & 255}.${base & 255}/${prefix}`;
}

/** A dotted netmask as a prefix length (`"255.255.255.0"` is 24); null when not a contiguous mask. */
export function maskToPrefix(mask: string): number | null {
  const n = ipToInt(mask);
  if (n === null) return null;
  let prefix = 0;
  while (prefix < 32 && ((n << prefix) & 0x80000000) !== 0) prefix++;
  const expected = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return n === expected ? prefix : null;
}
