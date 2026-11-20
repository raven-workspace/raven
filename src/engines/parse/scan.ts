/**
 * scanParserUtils.ts
 * High-performance multi-format parser for CTF scan artifacts.
 * Supports Nmap XML, standard Nmap text, Grepable (.gnmap), and Rustscan outputs.
 * Completely browser-native (zero Node fs dependencies).
 */

export interface ParsedPort {
  port: number;
  protocol: string;
  state: string;
  service: string;
  version: string;
}

export interface ParsedHost {
  ip?: string;
  hostname?: string;
  os?: string;
  ports: ParsedPort[];
}

export interface ScanImportResult {
  format: 'nmap-xml' | 'nmap-text' | 'gnmap' | 'rustscan' | 'raw-ports';
  detectedIp?: string;
  detectedHost?: string;
  detectedOs?: string;
  ports: ParsedPort[];
  hosts?: ParsedHost[];
}

const isValidPort = (p: number): boolean => !isNaN(p) && p >= 1 && p <= 65535;

/** Nmap XML with DTDs, entity declarations and unknown entity references stripped, before it reaches DOMParser. */
function sanitizeNmapXml(xmlContent: string): string {
  // Defense against XML entity expansion (Billion Laughs) and XXE constructs.
  // Handles multi-line / nested DTD internal subsets (strip all <!DOCTYPE ... [ ... ]> and <!ENTITY... blocks)
  return xmlContent
    .replace(/<!DOCTYPE\b[^>[]*\[[\s\S]*?\][^>]*>/gi, '')
    .replace(/<!DOCTYPE\b[^>]*>/gi, '')
    .replace(/<!ENTITY\b[\s\S]*?>/gi, '')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)[a-zA-Z0-9_-]+;/gi, '');
}

/** One `<host>` of an Nmap XML run: the name of its first `<hostname>` as written (`firstHostname`), and every
 *  distinct non-empty name (`hostnames`). */
interface XmlHost {
  ip?: string;
  firstHostname?: string;
  hostnames: string[];
  os?: string;
  ports: ParsedPort[];
}

/** An open or open|filtered `<port>`, or null. */
function xmlPort(portEl: Element): ParsedPort | null {
  const stateEl = portEl.querySelector('state');
  const state = stateEl?.getAttribute('state') || 'closed';
  if (state !== 'open' && state !== 'open|filtered') return null;

  const portNum = parseInt(portEl.getAttribute('portid') || '0', 10);
  if (!isValidPort(portNum)) return null;
  const protocol = (portEl.getAttribute('protocol') || 'tcp').toLowerCase();
  const serviceEl = portEl.querySelector('service');
  const service = (serviceEl?.getAttribute('name') || 'unknown').toLowerCase();

  const product = serviceEl?.getAttribute('product') || '';
  const versionNum = serviceEl?.getAttribute('version') || '';
  const extrainfo = serviceEl?.getAttribute('extrainfo') || '';
  const fullVersion = [product, versionNum, extrainfo].filter(Boolean).join(' ') || 'Unknown Version';

  return { port: portNum, protocol, state, service, version: fullVersion };
}

/** Every `<host>` of an Nmap XML run, in order. Null when there is no DOMParser, the XML doesn't parse, or it holds no
 *  `<nmaprun>`. */
function xmlHosts(xmlContent: string): XmlHost[] | null {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null;

  const doc = new DOMParser().parseFromString(sanitizeNmapXml(xmlContent), 'text/xml');
  // Safeguard against XML parsing errors
  if (doc.querySelector('parsererror') || !doc.querySelector('nmaprun')) return null;

  return Array.from(doc.querySelectorAll('host'), (hostNode) => {
    const addressNode =
      hostNode.querySelector('address[addrtype="ipv4"]') ||
      hostNode.querySelector('address[addrtype="ipv6"]') ||
      hostNode.querySelector('address');

    const hostnames: string[] = [];
    hostNode.querySelectorAll('hostname').forEach((h) => {
      const n = h.getAttribute('name');
      if (n && !hostnames.includes(n)) hostnames.push(n);
    });

    const ports: ParsedPort[] = [];
    hostNode.querySelectorAll('ports > port').forEach((portEl) => {
      const port = xmlPort(portEl);
      if (port) ports.push(port);
    });

    return {
      ip: addressNode?.getAttribute('addr') || undefined,
      firstHostname: hostNode.querySelector('hostname')?.getAttribute('name') || undefined,
      hostnames,
      os: hostNode.querySelector('osmatch')?.getAttribute('name') || undefined,
      ports,
    };
  });
}

/**
 * Parse Nmap XML output using browser DOMParser with <parsererror> safeguard
 */
export function parseNmapXml(xmlContent: string): ScanImportResult | null {
  try {
    const xml = xmlHosts(xmlContent);
    if (!xml || xml.length === 0) return null;

    const parsedHosts: ParsedHost[] = xml
      .filter((h) => h.ports.length > 0 || h.ip)
      .map((h) => ({ ip: h.ip, hostname: h.firstHostname, os: h.os, ports: h.ports }));
    if (parsedHosts.length === 0) return null;

    const primaryHost = parsedHosts[0];

    return {
      format: 'nmap-xml',
      detectedIp: primaryHost.ip,
      detectedHost: primaryHost.hostname,
      detectedOs: primaryHost.os,
      ports: primaryHost.ports.length > 0 ? primaryHost.ports : xml.flatMap((h) => h.ports),
      hosts: parsedHosts,
    };
  } catch {
    return null;
  }
}

/** One `Host:` line of greppable Nmap: its IPv4 address and name (`ip` unset when the line names no IPv4 address),
 *  its OS field, and its open ports. */
function gnmapLine(line: string): { ip?: string; hostname?: string; os?: string; ports: ParsedPort[] } {
  const hostMatch = line.match(/^Host:\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s*(?:\(([^)]*)\))?/);
  const osField = line.match(/\tOS:\s*([^\t\r\n]+)/);

  const ports: ParsedPort[] = [];
  const portsPart = line.split('Ports:')[1];
  if (portsPart) {
    for (const pe of portsPart.split(',')) {
      const parts = pe.trim().split('/');
      if (parts.length < 5) continue;
      const portNum = parseInt(parts[0], 10);
      const state = parts[1]?.toLowerCase();
      const proto = parts[2]?.toLowerCase() || 'tcp';
      const service = parts[4]?.toLowerCase() || 'unknown';
      const version = (parts[6] || parts[5] || 'Unknown Version').trim();
      const isOpenState = state === 'open' || state === 'open|filtered';
      if (!isOpenState || !isValidPort(portNum)) continue;
      ports.push({ port: portNum, protocol: proto, state: state || 'open', service, version });
    }
  }

  return {
    ip: hostMatch?.[1],
    hostname: hostMatch?.[2] || undefined,
    os: osField ? osField[1].trim() : undefined,
    ports,
  };
}

/**
 * Parse Grepable Nmap (.gnmap) output
 */
function parseGrepableNmap(content: string): ScanImportResult | null {
  if (!content.includes('Ports:') && !content.includes('# Nmap')) return null;

  let detectedIp: string | undefined;
  let detectedHost: string | undefined;
  const ports: ParsedPort[] = [];
  const hostsByIp = new Map<string, ParsedHost>();

  for (const line of content.split('\n')) {
    if (!line.startsWith('Host:')) continue;
    const parsed = gnmapLine(line);
    let lineHost: ParsedHost | undefined;
    if (parsed.ip) {
      detectedIp = parsed.ip;
      if (parsed.hostname) detectedHost = parsed.hostname;
      lineHost = hostsByIp.get(parsed.ip);
      if (!lineHost) {
        lineHost = { ip: parsed.ip, ports: [] };
        hostsByIp.set(parsed.ip, lineHost);
      }
      if (parsed.hostname && !lineHost.hostname) lineHost.hostname = parsed.hostname;
      if (parsed.os !== undefined && !lineHost.os) lineHost.os = parsed.os;
    }
    // A line whose address isn't IPv4 still adds its ports to the scan's.
    ports.push(...parsed.ports);
    lineHost?.ports.push(...parsed.ports);
  }

  if (ports.length === 0 && !detectedIp) return null;

  return {
    format: 'gnmap',
    detectedIp,
    detectedHost,
    ports,
    ...(hostsByIp.size > 1 ? { hosts: Array.from(hostsByIp.values()) } : {}),
  };
}

/**
 * Parse Rustscan output
 */
export function parseRustscan(content: string): ScanImportResult | null {
  const hasRustscanMarker = content.toLowerCase().includes('rustscan') || content.includes('Open ') || content.includes('[~] Starting Script(s)');
  if (!hasRustscanMarker) return null;

  let detectedIp: string | undefined;
  const discoveredPorts: number[] = [];

  const openLineRegex = /Open\s+([0-9]{1,3}(?:\.[0-9]{1,3}){3}):([0-9]{1,5})/gi;
  let match: RegExpExecArray | null;
  while ((match = openLineRegex.exec(content)) !== null) {
    if (!detectedIp) detectedIp = match[1];
    const port = parseInt(match[2], 10);
    if (isValidPort(port)) discoveredPorts.push(port);
  }

  const arrayMatch = content.match(/\[([0-9,\s]+)\]/);
  if (arrayMatch && discoveredPorts.length === 0) {
    const rawNums = arrayMatch[1]
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => isValidPort(n));
    discoveredPorts.push(...rawNums);
  }

  const nmapTextResult = parseNmapText(content);
  if (nmapTextResult && nmapTextResult.ports.length > 0) {
    return {
      format: 'rustscan',
      detectedIp: detectedIp || nmapTextResult.detectedIp,
      detectedHost: nmapTextResult.detectedHost,
      detectedOs: nmapTextResult.detectedOs,
      ports: nmapTextResult.ports,
    };
  }

  if (discoveredPorts.length === 0) return null;

  const uniquePorts = Array.from(new Set(discoveredPorts)).sort((a, b) => a - b);
  const ports: ParsedPort[] = uniquePorts.map((portNum) => ({
    port: portNum,
    protocol: 'tcp',
    state: 'open',
    service: 'unknown',
    version: 'Unknown',
  }));

  return { format: 'rustscan', detectedIp, ports };
}

const IPV4_SRC = String.raw`(?:\d{1,3}\.){3}\d{1,3}`;
const IPV6_SRC = String.raw`(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:%\w+)?`;
const HOST_REPORT_REGEX = new RegExp(`Nmap scan report for (?:([^\\s(]+)\\s\\()?(${IPV4_SRC}|${IPV6_SRC})?`, 'i');
const PORT_LINE_REGEX = /^(\d{1,5})\/(tcp|udp)\s+(open(?:\|filtered)?)\s+(\S+)\s*([^\r\n]*)/i;
const OPEN_PORT_LINE = /^\s*\d{1,5}\/(?:tcp|udp)\s+open/im;

/** The first "Nmap scan report for" line's address and name: `name (ip)`, or a bare address, or a bare name. */
function reportHeader(content: string): { ip?: string; name?: string } {
  const hostMatch = content.match(HOST_REPORT_REGEX);
  if (!hostMatch) return {};
  if (hostMatch[2]) return { ip: hostMatch[2], name: hostMatch[1] || undefined };
  if (!hostMatch[1]) return {};
  // Check if hostMatch[1] looks like an IP
  if (new RegExp(`^${IPV4_SRC}$`).test(hostMatch[1]) || new RegExp(`^${IPV6_SRC}$`).test(hostMatch[1])) return { ip: hostMatch[1] };
  return { name: hostMatch[1] };
}

/** The OS a "Service Info:" line names. */
function serviceInfoOs(content: string): string | undefined {
  const osMatch = content.match(/Service Info:[^\n\r]*?\bOSs?:\s*([^;\n\r]+)/i);
  return osMatch ? osMatch[1].trim() : undefined;
}

/** The open ports of Nmap text's port lines, at most `cap` of them. */
function nmapTextPorts(content: string, cap = Infinity): ParsedPort[] {
  const ports: ParsedPort[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (ports.length >= cap) break;
    const pMatch = line.trim().match(PORT_LINE_REGEX);
    if (!pMatch) continue;
    const portNum = parseInt(pMatch[1], 10);
    if (!isValidPort(portNum)) continue;
    ports.push({
      port: portNum,
      protocol: pMatch[2].toLowerCase(),
      state: pMatch[3].toLowerCase(),
      service: pMatch[4].toLowerCase(),
      version: pMatch[5].trim() || 'Unknown Version',
    });
  }
  return ports;
}

/** Nmap text cut into one section per "Nmap scan report for" line, from that line to the next. */
const reportSections = (content: string): string[] =>
  content.split(/^(?=Nmap scan report for )/im).filter((sec) => /^Nmap scan report for /i.test(sec));

/**
 * Parse Standard Nmap text output (.nmap / console output)
 * Supports IPv4/IPv6 target identification and service versioning
 */
function parseNmapText(content: string): ScanImportResult | null {
  // Also accept headerless snippets made of bare "22/tcp open ssh" port lines
  const hasOpenPortLine = OPEN_PORT_LINE.test(content);
  if (!content.includes('Nmap scan report') && !content.includes('PORT') && !content.includes('STATE') && !hasOpenPortLine) {
    return null;
  }

  const header = reportHeader(content);
  const detectedIp = header.ip;
  const detectedHost = header.name ?? header.ip;
  const ports = nmapTextPorts(content);

  if (ports.length === 0 && !detectedIp) return null;

  // Multi-host report: one "Nmap scan report for" section per host
  let hosts: ParsedHost[] | undefined;
  const sections = reportSections(content);
  if (sections.length > 1) {
    hosts = sections.map((sec) => {
      const sub = parseNmapText(sec);
      return {
        ip: sub?.detectedIp,
        hostname: sub?.detectedHost && sub.detectedHost !== sub.detectedIp ? sub.detectedHost : undefined,
        os: sub?.detectedOs,
        ports: sub?.ports ?? [],
      };
    });
  }

  return {
    format: 'nmap-text',
    detectedIp,
    detectedHost,
    detectedOs: serviceInfoOs(content),
    ports,
    ...(hosts ? { hosts } : {}),
  };
}

/**
 * Universal auto-detecting scan intake dispatcher
 */
export function detectAndParseScan(rawInput: string): ScanImportResult | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. Check for Nmap XML
  if (trimmed.startsWith('<?xml') || trimmed.includes('<nmaprun') || trimmed.includes('<host>')) {
    const xmlResult = parseNmapXml(trimmed);
    if (xmlResult) return xmlResult;
  }

  // 2. Check for Grepable Nmap
  if (trimmed.includes('Ports:') && (trimmed.includes('# Nmap') || trimmed.includes('Host:'))) {
    const gnmapResult = parseGrepableNmap(trimmed);
    if (gnmapResult) return gnmapResult;
  }

  // 3. Check for Rustscan
  if (trimmed.toLowerCase().includes('rustscan') || (trimmed.includes('Open ') && trimmed.includes(':'))) {
    const rustscanResult = parseRustscan(trimmed);
    if (rustscanResult) return rustscanResult;
  }

  // 4. Standard Nmap Text Output
  const nmapTextResult = parseNmapText(trimmed);
  if (nmapTextResult) return nmapTextResult;

  // 5. Fallback: Raw Port List
  // Extract potential IP address if present in raw text
  const ipMatch = trimmed.match(/\b([0-9]{1,3}(?:\.[0-9]{1,3}){3})\b/);
  const detectedIp = ipMatch ? ipMatch[1] : undefined;

  // Strip all IPv4 addresses, IPv6 addresses, CVE IDs, and version strings first to avoid leaking false ports
  const sanitizedForPorts = trimmed
    .replace(new RegExp(IPV4_SRC, 'g'), ' ')
    .replace(new RegExp(IPV6_SRC, 'g'), ' ')
    .replace(/\bCVE-\d{4}-\d{4,7}\b/gi, ' ')
    .replace(/\b\d+\.\d+(?:\.\d+)*\b/g, ' ');

  // Only two shapes count as a port list: text that is nothing but port numbers, or a single line such as
  // "open ports: 21, 22, 80". Numbers anywhere else (PIDs, timings, grep line numbers, flag values) are not ports.
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const listLike = lines.length >= 1 && lines.every((l) => /^[\s,0-9\-/:|]+$/.test(l));
  const labelledList = lines.length === 1 ? sanitizedForPorts.match(/\bports\b\s*[:=]?\s*((?:\d{1,5}\s*(?:,|and)?\s*)+)/i) : null;
  const listText = listLike ? sanitizedForPorts : labelledList?.[1] ?? '';
  const candidateMatches = [...listText.matchAll(/(?<![.\w:-])(\d{1,5})(?![.\w:-])/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => isValidPort(n));

  if (candidateMatches.length > 0) {
    const uniquePorts = Array.from(new Set(candidateMatches)).sort((a, b) => a - b);
    const ports: ParsedPort[] = uniquePorts.map((p) => ({
      port: p,
      protocol: 'tcp',
      state: 'open',
      service: 'service',
      version: 'Raw port intake',
    }));

    return { format: 'raw-ports', detectedIp, ports };
  }

  return null;
}

/**
 * Multi-host scan intake: keeps every host discovered in a paste instead of collapsing
 * to a single primary target. Note: named ParsedMultiHost (not ParsedHost) to avoid
 * colliding with the existing exported ParsedHost shape (ip optional, hostname singular)
 * already consumed elsewhere in the codebase.
 */
export interface ParsedMultiHost {
  ip: string;
  hostnames: string[];
  os?: string;
  ports: ParsedPort[];
}

const MAX_MULTI_HOSTS = 256;
const MAX_PORTS_PER_MULTI_HOST = 512;

/** Adds a host to `map` under `dedupeKey`, or merges it into the one already there: new hostnames appended, the first
 *  OS kept, ports appended. Past the caps, a new host is dropped and extra ports are ignored. */
function addMultiHost(
  map: Map<string, ParsedMultiHost>,
  dedupeKey: string,
  ip: string,
  hostnames: readonly string[],
  os: string | undefined,
  ports: ParsedPort[]
): void {
  if (!ip && ports.length === 0) return;
  let existing = map.get(dedupeKey);
  if (!existing) {
    if (map.size >= MAX_MULTI_HOSTS) return;
    existing = { ip, hostnames: [], os, ports: [] };
    map.set(dedupeKey, existing);
  }
  for (const hostname of hostnames) {
    if (hostname && !existing.hostnames.includes(hostname)) existing.hostnames.push(hostname);
  }
  if (!existing.os && os) existing.os = os;
  for (const p of ports) {
    if (existing.ports.length >= MAX_PORTS_PER_MULTI_HOST) break;
    existing.ports.push(p);
  }
}

function normalizeJsonPort(raw: unknown): ParsedPort | null {
  if (raw == null) return null;
  let portNum: number;
  let protocol = 'tcp';
  let state = 'open';
  let service = 'unknown';
  let version = 'Unknown Version';

  if (typeof raw === 'number' || typeof raw === 'string') {
    portNum = parseInt(String(raw), 10);
  } else if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    portNum = parseInt(String(o.port ?? o.portid ?? o.id ?? ''), 10);
    protocol = String(o.protocol ?? o.proto ?? 'tcp').toLowerCase();
    state = String(o.state ?? o.status ?? 'open').toLowerCase();
    service = String(o.service ?? o.name ?? o.serviceName ?? 'unknown').toLowerCase();
    version = String(o.version ?? o.product ?? o.banner ?? 'Unknown Version');
  } else {
    return null;
  }

  if (!isValidPort(portNum)) return null;
  if (state && state !== 'open' && state !== 'open|filtered') return null;

  return { port: portNum, protocol, state: state || 'open', service, version };
}

function parseMultiHostJson(trimmed: string): ParsedMultiHost[] | null {
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const map = new Map<string, ParsedMultiHost>();
  let noIpCounter = 0;

  const ingest = (entry: unknown, keyHint?: string): void => {
    if (!entry || typeof entry !== 'object') return;
    const o = entry as Record<string, unknown>;
    const ip = String(o.ip ?? o.address ?? o.host ?? o.addr ?? keyHint ?? '').trim();

    let hostnames: string[] = [];
    if (Array.isArray(o.hostnames)) hostnames = o.hostnames.map((h) => String(h)).filter(Boolean);
    else if (Array.isArray(o.names)) hostnames = o.names.map((h) => String(h)).filter(Boolean);
    else if (typeof o.hostname === 'string' && o.hostname) hostnames = [o.hostname];
    else if (typeof o.name === 'string' && o.name && keyHint === undefined) hostnames = [o.name];

    const os = typeof o.os === 'string' ? o.os : typeof o.osName === 'string' ? o.osName : undefined;

    const rawPorts = Array.isArray(o.ports) ? o.ports : [];
    const ports: ParsedPort[] = [];
    for (const rp of rawPorts) {
      if (ports.length >= MAX_PORTS_PER_MULTI_HOST) break;
      const p = normalizeJsonPort(rp);
      if (p) ports.push(p);
    }

    if (!ip && ports.length === 0) return;
    addMultiHost(map, ip || `__noip_${noIpCounter++}__`, ip, hostnames, os, ports);
  };

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (map.size >= MAX_MULTI_HOSTS) break;
      ingest(entry);
    }
  } else if (data && typeof data === 'object') {
    for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
      if (map.size >= MAX_MULTI_HOSTS) break;
      ingest(entry, key);
    }
  } else {
    return null;
  }

  return Array.from(map.values());
}

/**
 * Parse every host out of a pasted scan, regardless of format, instead of collapsing to
 * one primary target. Accepts the same four shapes the single-host parsers understand:
 * Nmap XML, greppable .gnmap, plain Nmap text, and JSON (array or ip-keyed object).
 * Never throws — malformed input resolves to an empty array. Capped at 256 hosts and
 * 512 ports per host.
 */
export function parseMultiHostScan(raw: string): ParsedMultiHost[] {
  try {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return [];

    const map = new Map<string, ParsedMultiHost>();

    // 1. Nmap XML — multiple <host> elements
    if (trimmed.startsWith('<?xml') || trimmed.includes('<nmaprun') || trimmed.includes('<host>')) {
      const xml = xmlHosts(trimmed);
      if (!xml) return [];
      let noIpCounter = 0;
      for (const host of xml) {
        if (map.size >= MAX_MULTI_HOSTS) break;
        const ip = host.ip ?? '';
        if (!ip && host.ports.length === 0) continue;
        addMultiHost(map, ip || `__noip_${noIpCounter++}__`, ip, host.hostnames, host.os, host.ports);
      }
      return Array.from(map.values());
    }

    // 2. JSON — array of host objects, or object keyed by ip
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const jsonResult = parseMultiHostJson(trimmed);
      if (jsonResult && jsonResult.length > 0) return jsonResult;
      // Fall through to text-based formats if JSON.parse succeeded but yielded nothing,
      // or if it wasn't actually JSON (e.g. a stray '{' in free text).
    }

    // 3. Greppable Nmap (.gnmap) — "Host: <ip> (<name>)" lines
    if (trimmed.includes('Host:') && (trimmed.includes('Ports:') || trimmed.includes('# Nmap'))) {
      for (const line of trimmed.split('\n')) {
        if (!line.startsWith('Host:')) continue;
        const { ip, hostname, os, ports } = gnmapLine(line);
        if (!ip) continue;
        addMultiHost(map, ip, ip, hostname ? [hostname] : [], os, ports);
      }
      if (map.size > 0) return Array.from(map.values());
    }

    // 4. Plain / normal terminal output — repeated "Nmap scan report for <name> (<ip>)" blocks
    let noIpCounter = 0;
    for (const sec of reportSections(trimmed)) {
      if (map.size >= MAX_MULTI_HOSTS) break;
      const { ip = '', name } = reportHeader(sec);
      const ports = nmapTextPorts(sec, MAX_PORTS_PER_MULTI_HOST);
      if (!ip && ports.length === 0) continue;
      addMultiHost(map, ip || `__noip_${noIpCounter++}__`, ip, name ? [name] : [], serviceInfoOs(sec), ports);
    }
    if (map.size > 0) return Array.from(map.values());

    // No host-report headers at all: treat the whole paste as a single headerless host
    // if it contains bare port lines (e.g. a snippet of "22/tcp open ssh" lines).
    if (OPEN_PORT_LINE.test(trimmed)) {
      const ports = nmapTextPorts(trimmed, MAX_PORTS_PER_MULTI_HOST);
      if (ports.length > 0) {
        const ipMatch = trimmed.match(new RegExp(IPV4_SRC));
        const ip = ipMatch ? ipMatch[0] : '';
        addMultiHost(map, ip || '__noip_0__', ip, [], undefined, ports);
      }
    }

    return Array.from(map.values());
  } catch {
    return [];
  }
}
