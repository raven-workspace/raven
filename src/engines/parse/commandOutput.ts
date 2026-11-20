/** Operating-system detection for parsed port scans (nmap OS detection, service banners, Windows-only services). */
import type { HostOs } from '../../types/host';
import type { ScanImportResult } from './scan';

export interface OsDetection {
  os: HostOs;
  /** Short human-readable reason, e.g. "Nmap OS detection: Windows Server 2019". */
  evidence: string;
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
