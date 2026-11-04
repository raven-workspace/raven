/**
 * Recognises arbitrary tool / command output pasted or uploaded onto a target and extracts the facts Raven can use:
 * the tool, a suggested title, the operating system (with the evidence for it), the AD domain and the hostname.
 * Port scans are delegated to detectAndParseScan; everything else is classified by distinctive markers.
 */
import type { HostOs } from '../../types/host';
import { detectAndParseScan, type ScanImportResult } from './scan';

export interface OsDetection {
  os: HostOs;
  /** Short human-readable reason, e.g. "Nmap OS detection: Windows Server 2019". */
  evidence: string;
}

export interface CommandOutputAnalysis {
  /** Tool label ("nmap", "netexec", ...) or "text" when nothing matched. */
  tool: string;
  title: string;
  os?: OsDetection;
  domain?: string;
  hostname?: string;
  /** Set when the output is a port scan with at least one open port. */
  scan?: ScanImportResult;
}

/** Maps a free-form OS string ("Microsoft Windows Server 2019", "Ubuntu 22.04", "FreeBSD 13") to Raven's OS list. */
export function normalizeOsName(raw: string | undefined | null): HostOs | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/windows|microsoft|win32|win64/.test(s)) return 'windows';
  if (/android/.test(s)) return 'other';
  if (/mac ?os|os x|darwin|apple/.test(s)) return 'other';
  if (/freebsd|openbsd|netbsd|\bbsd\b|pfsense|opnsense/.test(s)) return 'other';
  if (/linux|ubuntu|debian|centos|red ?hat|rhel|fedora|kali|alpine|arch|suse|gentoo|amazon|unix|samba/.test(s)) return 'linux';
  return null;
}

/** Services that only run on Windows hosts in practice. */
const WINDOWS_ONLY_SERVICES = /^(msrpc|ms-wbt-server|microsoft-ds|ncacn_http|globalcatldap|wsman|winrm)$/i;
const WINDOWS_ONLY_PORTS = new Set([135, 3389, 5985, 5986]);

/**
 * Best OS guess for a parsed scan. Order of trust: nmap OS detection / Service Info, then service version banners,
 * then Windows-only services. Returns null when the scan carries no usable signal.
 */
export function detectOsFromScan(result: ScanImportResult, rawText = ''): OsDetection | null {
  const explicit = result.detectedOs || result.hosts?.find((h) => h.os)?.os;
  const fromExplicit = normalizeOsName(explicit);
  if (fromExplicit) return { os: fromExplicit, evidence: `Nmap OS detection: ${explicit!.trim()}` };

  // Nmap -O lines that the port parser does not keep.
  const osLine = rawText.match(/^(?:OS details|Running(?: \(JUST GUESSING\))?|Aggressive OS guesses):\s*(.+)$/im);
  const fromOsLine = normalizeOsName(osLine?.[1]);
  if (fromOsLine) return { os: fromOsLine, evidence: `Nmap OS detection: ${osLine![1].trim().slice(0, 80)}` };

  const versions = result.ports.map((p) => `${p.service} ${p.version || ''}`).join(' | ');
  if (/microsoft|windows|\biis\b/i.test(versions)) {
    const banner = result.ports.find((p) => /microsoft|windows|\biis\b/i.test(`${p.service} ${p.version || ''}`));
    return { os: 'windows', evidence: `Service banner: ${(banner?.version || banner?.service || '').slice(0, 80)}` };
  }
  const linuxBanner = result.ports.find((p) => /ubuntu|debian|centos|red ?hat|fedora|linux/i.test(p.version || ''));
  if (linuxBanner) return { os: 'linux', evidence: `Service banner: ${(linuxBanner.version || '').slice(0, 80)}` };
  const bsdBanner = result.ports.find((p) => /freebsd|openbsd|netbsd/i.test(p.version || ''));
  if (bsdBanner) return { os: 'other', evidence: `Service banner: ${(bsdBanner.version || '').slice(0, 80)}` };

  const windowsPort = result.ports.find((p) => WINDOWS_ONLY_SERVICES.test(p.service) || WINDOWS_ONLY_PORTS.has(p.port));
  if (windowsPort) return { os: 'windows', evidence: `Windows-only service on ${windowsPort.port}/${windowsPort.protocol}` };

  return null;
}

const firstMatch = (text: string, re: RegExp): string | undefined => text.match(re)?.[1]?.trim() || undefined;

/** "dc=corp,dc=local" -> "corp.local" */
const domainFromDn = (dn: string | undefined): string | undefined => {
  if (!dn) return undefined;
  const parts = [...dn.matchAll(/dc=([^,\s]+)/gi)].map((m) => m[1]);
  return parts.length >= 2 ? parts.join('.').toLowerCase() : undefined;
};

const cleanDomain = (d: string | undefined): string | undefined => {
  const v = d?.trim().replace(/[.)\]]+$/, '').toLowerCase();
  return v && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : undefined;
};

interface ToolRule {
  tool: string;
  test: RegExp;
  extract?: (text: string) => Partial<Omit<CommandOutputAnalysis, 'tool' | 'title' | 'scan'>>;
}

const os = (value: HostOs | null, evidence: string): OsDetection | undefined =>
  value ? { os: value, evidence } : undefined;

// Ordered: the first matching rule names the tool.
const TOOL_RULES: ToolRule[] = [
  {
    tool: 'netexec',
    test: /^(?:SMB|WINRM|LDAPS?|MSSQL|RDP|SSH|FTP|WMI|NFS|VNC)\s+\d{1,3}(?:\.\d{1,3}){3}\s+\d+\s+\S+\s+\[[*+\-!]\]/m,
    extract: (t) => {
      const info = firstMatch(t, /\[\*\]\s+((?:Windows|Unix|Linux)[^(\r\n]*)/i);
      return {
        os: os(normalizeOsName(info), `netexec: ${info?.trim().slice(0, 80)}`),
        hostname: firstMatch(t, /\(name:([^)]+)\)/i),
        domain: cleanDomain(firstMatch(t, /\(domain:([^)]+)\)/i)),
      };
    },
  },
  {
    tool: 'enum4linux',
    test: /enum4linux|Starting enum4linux|ENUM4LINUX/i,
    extract: (t) => {
      const info = firstMatch(t, /OS(?: info)?[^\n]*?(?:OS=\[|:\s*)(Windows[^\]\n]*|Unix[^\]\n]*|Linux[^\]\n]*)/i);
      return {
        os: os(normalizeOsName(info), `enum4linux: ${info?.slice(0, 80)}`),
        domain: cleanDomain(firstMatch(t, /(?:DNS domain|Domain Name|FQDN)\s*:\s*(\S+)/i)),
      };
    },
  },
  {
    tool: 'systeminfo',
    test: /^OS Name:\s+.+$/m,
    extract: (t) => {
      const name = firstMatch(t, /^OS Name:\s+(.+)$/m);
      return {
        os: os(normalizeOsName(name) || 'windows', `systeminfo: ${name?.slice(0, 80)}`),
        hostname: firstMatch(t, /^Host Name:\s+(\S+)/m),
        domain: cleanDomain(firstMatch(t, /^Domain:\s+(\S+)/m)),
      };
    },
  },
  { tool: 'winpeas', test: /winpeas/i, extract: () => ({ os: os('windows', 'winPEAS output') }) },
  { tool: 'linpeas', test: /linpeas/i, extract: () => ({ os: os('linux', 'LinPEAS output') }) },
  {
    tool: 'ipconfig',
    test: /Windows IP Configuration/i,
    extract: (t) => ({ os: os('windows', 'ipconfig output'), domain: cleanDomain(firstMatch(t, /Primary Dns Suffix[ .]*:\s*(\S+)/i)) }),
  },
  {
    tool: 'whoami',
    test: /^\s*(?:nt authority\\[a-z ]+|[a-z0-9_.-]+\\[a-z0-9_.$-]+)\s*$/im,
    extract: () => ({ os: os('windows', 'Windows account (DOMAIN\\user)') }),
  },
  {
    tool: 'uname',
    test: /^(?:Linux|FreeBSD|OpenBSD|NetBSD|Darwin)\s+\S+\s+\d+\.\d+\S*/m,
    extract: (t) => {
      const line = t.match(/^(Linux|FreeBSD|OpenBSD|NetBSD|Darwin)\s+(\S+)\s+(\d+\.\d+\S*)/m);
      return { os: os(normalizeOsName(line?.[1]), `uname: ${line?.[1]} ${line?.[3]}`), hostname: line?.[2] };
    },
  },
  {
    tool: 'ldapsearch',
    test: /^# extended LDIF/m,
    extract: (t) => ({ domain: domainFromDn(firstMatch(t, /^(?:dn|namingContexts|defaultNamingContext):\s*(.*dc=.*)$/im)) }),
  },
  {
    tool: 'kerbrute',
    test: /kerbrute/i,
    extract: (t) => ({ domain: cleanDomain(firstMatch(t, /VALID USERNAME:\s*\S+@(\S+)/i) || firstMatch(t, /Using KDC\(s\):[\s\S]*?\.(\S+?):88/i)) }),
  },
  { tool: 'impacket', test: /Impacket v\d/i },
  { tool: 'smbmap', test: /smbmap|Disk\s+Permissions\s+Comment/i },
  { tool: 'smbclient', test: /Sharename\s+Type\s+Comment/i },
  { tool: 'gobuster', test: /gobuster/i },
  { tool: 'feroxbuster', test: /feroxbuster/i },
  { tool: 'ffuf', test: /\bffuf\b|:: Method\s+:/i },
  { tool: 'dirsearch', test: /dirsearch/i },
  { tool: 'nikto', test: /Nikto v\d/i },
  { tool: 'whatweb', test: /whatweb|\[\d{3} [A-Za-z ]+\]\s+\S+\[/i },
  { tool: 'hydra', test: /Hydra v\d/i },
  { tool: 'wpscan', test: /WPScan/i },
  { tool: 'sqlmap', test: /sqlmap/i },
  {
    tool: 'ping',
    test: /\bttl=\d+/i,
    extract: (t) => {
      const ttl = Number(firstMatch(t, /\bttl=(\d+)/i));
      if (!ttl) return {};
      // Initial TTLs: 64 for Linux/macOS/BSD, 128 for Windows. Hops only ever lower it.
      return ttl > 64 && ttl <= 128 ? { os: os('windows', `ping TTL ${ttl}`) } : ttl <= 64 ? { os: os('linux', `ping TTL ${ttl}`) } : {};
    },
  },
];

const PROMPT_LINE = /^\s*(?:[$#❯>%]|└─[$#]|PS [^>]*>|[\w.-]+@[\w.-]+:[^$#]*[$#])\s+(.+)$/;

/** Uses the command line when the paste starts with a shell prompt, otherwise "<tool> output". */
function suggestTitle(text: string, tool: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const prompt = firstLine.match(PROMPT_LINE);
  if (prompt) return prompt[1].trim().slice(0, 120);
  return tool === 'text' ? 'Command output' : `${tool} output`;
}

export function analyzeCommandOutput(text: string): CommandOutputAnalysis {
  const trimmed = (text || '').trim();
  if (!trimmed) return { tool: 'text', title: 'Command output' };

  const scan = detectAndParseScan(trimmed);
  // Raw "list of numbers" matches are too loose to name a tool; real scan formats are kept.
  if (scan && scan.ports.length > 0 && scan.format !== 'raw-ports') {
    const tool = scan.format === 'rustscan' ? 'rustscan' : 'nmap';
    return {
      tool,
      title: suggestTitle(trimmed, tool),
      scan,
      os: detectOsFromScan(scan, trimmed) || undefined,
      hostname: scan.detectedHost && scan.detectedHost !== scan.detectedIp ? scan.detectedHost : undefined,
    };
  }

  for (const rule of TOOL_RULES) {
    if (!rule.test.test(trimmed)) continue;
    const extracted = rule.extract?.(trimmed) || {};
    return {
      tool: rule.tool,
      title: suggestTitle(trimmed, rule.tool),
      ...Object.fromEntries(Object.entries(extracted).filter(([, v]) => v !== undefined)),
    };
  }

  if (scan && scan.ports.length > 0) {
    return { tool: 'ports', title: suggestTitle(trimmed, 'ports'), scan };
  }
  return { tool: 'text', title: suggestTitle(trimmed, 'text') };
}

/** True when a file's text looks binary (NUL bytes or mostly control characters), so it isn't stored as output. */
export function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  const sample = text.slice(0, 4000);
  if (!sample) return false;
  const control = sample.replace(/[\t\n\r\x20-\x7e\u00a0-\uffff]/g, '').length;
  return control / sample.length > 0.1;
}
