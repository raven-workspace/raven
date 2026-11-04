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

/** Unique IPv4s as whole tokens, in first-seen order. */
export function extractIps(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d]|\.\d)/g)) {
    const ip = m[0];
    if (ipToInt(ip) === null || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

export function isIgnoredIp(ip: string, lhost?: string): boolean {
  if (lhost && ip === lhost) return true;
  return ip === '0.0.0.0' || ip.startsWith('127.');
}
