import { firstSegment } from './library/matcher';

/** A host as attribution sees it. */
export type HostRef = { id: string; name: string; ip: string | null };

const IP_LIKE = /^\d{1,3}(\.\d{1,3}){3}$/;
/**
 * IPv4s as whole tokens. A CIDR (`10.0.0.0/24`) or a range (`10.0.0.1-50`, `10.0.0.1-10.0.0.6`) is not a host:
 * an IP touching `-` or followed by `/digits` never attributes. Nor is an IP inside a file name or path
 * (`scans/10.0.0.5/full.nmap`, `10.0.0.5_full.txt`, `out/10.0.0.5.txt`): no word character, `.` or `-` around it,
 * and no path segment before it (`dir/`); a URL's `://` and a UNC `//IP` are fine. `:port`, `@`, `,`, quotes, `=` and a URL path after it attribute.
 */
export const HOST_IP = /(?<![\w.-])(?<![\w.-]\/)(?:\d{1,3}\.){3}\d{1,3}(?![\w-]|\.\w|\/\d)/g;
/** A line that excludes hosts names them without targeting them, so it attributes no host at all. */
const EXCLUDE = /(^|\s)--?exclude(file)?(?=[\s=]|$)/i;
/** Name tokens: split on whitespace, quotes and / @ : , = ( ) [ ] ; */
const TOKEN_SPLIT = /[\s'"/@:,=()[\];]+/;
const KALI_WORD = /(^|[^a-z0-9])kali([^a-z0-9]|$)/i;

/** True when a label (shell prompt, ran-on) names the attacker box: the word `kali`, case-insensitive. */
export function isKaliLabel(label: string): boolean {
  return KALI_WORD.test(label);
}

export function ipsIn(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(HOST_IP), (m) => m[0]));
}

/**
 * Hosts named in `text`: by IP as a whole token, or by a token equal to the host name (or
 * `<name>.<engagement domain>`). A token ending in `$` is a machine account, never a host; a filename like
 * `ms01.txt` is not a token match.
 */
export function hostsNamedIn(text: string, hosts: HostRef[], domain: string): HostRef[] {
  const ips = ipsIn(text);
  const tokens = new Set(
    text
      .split(TOKEN_SPLIT)
      .filter((t) => t && !t.endsWith('$'))
      .map((t) => t.toLowerCase()),
  );
  return hosts.filter((h) => {
    if (h.ip && ips.has(h.ip)) return true;
    const name = h.name.trim().toLowerCase();
    if (!name || IP_LIKE.test(name)) return false;
    return tokens.has(name) || (!!domain && tokens.has(`${name}.${domain}`));
  });
}

/** A line that excludes hosts (`--exclude`, `--excludefile`) names them without targeting them. */
export function excludesHosts(line: string): boolean {
  return EXCLUDE.test(firstSegment(line));
}

/** Hosts an attacker-side command line aims at: those named in its first segment; none when it excludes hosts. */
export function namedHostsInLine(line: string, hosts: HostRef[], domain: string): HostRef[] {
  const segment = firstSegment(line);
  return excludesHosts(line) ? [] : hostsNamedIn(segment, hosts, domain);
}

/**
 * The one host a shell label or `ranOn` names. null = attacker box (the word `kali` anywhere) or ambiguous;
 * 'none' = names nothing (a label then falls back to `ranOn`).
 */
function resolveOne(label: string, hosts: HostRef[], domain: string): HostRef | null | 'none' {
  const text = label.trim();
  if (!text) return 'none';
  if (isKaliLabel(text)) return null;
  const found = hostsNamedIn(text, hosts, domain);
  if (found.length === 0) return 'none';
  return found.length === 1 ? found[0] : null;
}

/** Shell label first, then `ranOn`. A Kali or ambiguous label stops the fallback. */
export function shellHost(shell: string | undefined, ranOn: string | undefined, hosts: HostRef[], domain: string): HostRef | null {
  const fromShell = resolveOne(shell ?? '', hosts, domain);
  if (fromShell !== 'none') return fromShell;
  const fromRanOn = resolveOne(ranOn ?? '', hosts, domain);
  return fromRanOn === 'none' ? null : fromRanOn;
}
