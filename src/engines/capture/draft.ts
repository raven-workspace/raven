import type { BoardColumn, HostOs } from '../../types/host';
import type { CommandBlock, LogContent, LogKind } from '../../types/log';
import type { ScanPort } from '../../types/service';
import { HOST_IP, hostsNamedIn, isKaliLabel, namedHostsInLine, shellHost, type HostRef } from '../attribution';
import { detectOsFromScan } from '../parse/commandOutput';
import { detectAndParseScan, parseMultiHostScan, type ParsedPort } from '../parse/scan';
import { splitPaste } from '../parse/logPaste';
import { ipInScope } from '../parse/scope';
import { httpParts, httpTitle } from './http';
import { findFlagInPaste } from './flag';
import { detectKind } from './kind';
import { commandTitle, flagTitle, noteTitle, screenshotFileName } from './titles';

export type { ScanPort };

export type CaptureDraft = {
  kind: LogKind;
  title: string;
  hostIds: string[];
  ranOn: string;
  content: LogContent;
  unknownScopeIps: string[];
  scan: { hostId: string; ports: ScanPort[]; os: HostOs | null } | null;
};

export type DraftInput = {
  text: string;
  image: { mime: string } | null;
  kind?: LogKind;
  hosts: (HostRef & { column: BoardColumn })[];
  scope: string[];
  domain: string;
  machines: string[];
  lastRanOn: string | null;
};

function union(lists: HostRef[][]): HostRef[] {
  const seen = new Set<string>();
  const out: HostRef[] = [];
  for (const h of lists.flat()) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
  }
  return out;
}

function ipsOf(text: string): string[] {
  return Array.from(new Set(text.match(HOST_IP) ?? []));
}

/** Parser placeholders for "no version seen"; stored as blank so they never overwrite a real guess. */
const VERSION_PLACEHOLDERS = new Set(['unknown version', 'unknown', 'raw port intake']);
/** Port states a capture keeps from a scan. */
export const OPEN_STATES = new Set(['open', 'open|filtered']);

/**
 * Rustscan's bare `Open ip:port` path names no service and fills in `unknown` / `Unknown`. That pair is a
 * placeholder, not nmap's own `unknown`, so it is blanked. (The XML/gnmap `|| 'unknown'` fallbacks can't be
 * told apart from a real nmap `unknown` and are kept.)
 */
const isPlaceholderService = (format: string, p: ParsedPort) =>
  format === 'rustscan' && p.service === 'unknown' && p.version === 'Unknown';

function toScanPorts(ports: ParsedPort[], format: string): ScanPort[] {
  return ports
    .filter((p) => OPEN_STATES.has(p.state.toLowerCase()))
    .map((p) => ({
      port: p.port,
      protocol: p.protocol === 'udp' ? 'udp' : 'tcp',
      state: p.state,
      service: isPlaceholderService(format, p) ? '' : p.service,
      version: VERSION_PLACEHOLDERS.has(p.version.trim().toLowerCase()) ? '' : p.version,
    }));
}

/** True when a scan's host identity (IP or reported hostname) is `target`. */
function isTarget(ip: string | undefined, names: (string | undefined)[], target: HostRef, domain: string): boolean {
  if (ip && target.ip && ip === target.ip) return true;
  const name = target.name.toLowerCase();
  const fqdn = domain ? `${name}.${domain.toLowerCase()}` : null;
  return names.some((n) => {
    const v = n?.toLowerCase();
    return !!v && v !== ip && (v === name || v === fqdn || (!!target.ip && v === target.ip));
  });
}

const REPORT_HEADER = /^Nmap scan report for (?:(\S+) \()?([^\s)]+)\)?/i;

/**
 * The scan of `target` inside a command's output, or null. A single-host scan counts only when it reports
 * `target` (a headerless port list names no host, so the attributed host owns it); a multi-host scan
 * contributes only `target`'s own section.
 */
function scanFor(output: string, target: HostRef, domain: string): CaptureDraft['scan'] {
  const result = detectAndParseScan(output);
  if (!result || result.ports.length === 0 || result.format === 'raw-ports') return null;

  const hosts = parseMultiHostScan(output);
  if (hosts.length > 1) {
    const match = hosts.find((h) => isTarget(h.ip || undefined, h.hostnames, target, domain));
    if (!match) return null;
    // Plain text: analyse the host's own section so its -O lines count and nobody else's do.
    const section = output
      .split(/^(?=Nmap scan report for )/im)
      .find((sec) => {
        const m = sec.match(REPORT_HEADER);
        return m && isTarget(m[2], [m[1], m[2]], target, domain);
      });
    const os = detectOsFromScan({ format: result.format, ports: match.ports, detectedOs: match.os }, section ?? '');
    return { hostId: target.id, ports: toScanPorts(match.ports, result.format), os: os?.os ?? null };
  }

  const reported = result.detectedIp || result.detectedHost || hosts[0]?.ip;
  if (reported && !isTarget(result.detectedIp || hosts[0]?.ip || undefined, [result.detectedHost], target, domain)) return null;
  // Rustscan "Open ip:port" lines for several IPs: which port is whose is not reliable, so no scan.
  const openIps = new Set(Array.from(output.matchAll(/Open\s+((?:\d{1,3}\.){3}\d{1,3}):\d+/g), (m) => m[1]));
  if (openIps.size > 1) return null;
  return { hostId: target.id, ports: toScanPorts(result.ports, result.format), os: detectOsFromScan(result, output.trim())?.os ?? null };
}

export function buildDraft(input: DraftInput): CaptureDraft {
  const { text, hosts, scope, domain, machines } = input;
  const kind = input.kind ?? detectKind(text, input.image !== null);
  const fallbackRanOn = input.lastRanOn ?? machines[0] ?? '';
  const kaliMachine = machines.find(isKaliLabel);
  const empty = { unknownScopeIps: [] as string[], scan: null };

  const withUnknown = (scanText: string) => {
    const known = new Set(hosts.map((h) => h.ip).filter((ip): ip is string => !!ip));
    return ipsOf(scanText).filter((ip) => ipInScope(ip, scope) && !known.has(ip));
  };

  if (kind === 'command') {
    const blocks: CommandBlock[] = splitPaste(text);
    const perBlock = blocks.map((b) => {
      const sh = shellHost(b.shell, undefined, hosts, domain);
      return sh ? [sh] : namedHostsInLine(b.command, hosts, domain);
    });
    const attributed = union(perBlock);

    const hostShell = blocks.map((b) => shellHost(b.shell, undefined, hosts, domain)).find((h) => h);
    const kaliShell = blocks.some((b) => b.shell && isKaliLabel(b.shell));
    const ranOn = hostShell ? hostShell.name : kaliShell && kaliMachine ? kaliMachine : fallbackRanOn;

    const lines = blocks.map((b) => b.command).join('\n');
    const scan = attributed.length === 1 ? scanFor(blocks.map((b) => b.output).join('\n'), attributed[0], domain) : null;
    return {
      kind,
      title: commandTitle(blocks),
      hostIds: attributed.map((h) => h.id),
      ranOn,
      content: { kind: 'command', blocks },
      unknownScopeIps: withUnknown(lines),
      scan,
    };
  }

  const named = hostsNamedIn(text, hosts, domain);
  const first = named[0] ?? null;
  const base = { hostIds: named.map((h) => h.id), ranOn: fallbackRanOn, ...empty };
  const unknownScopeIps = withUnknown(text);

  switch (kind) {
    case 'screenshot': {
      const mime = input.image?.mime ?? 'image/png';
      const fileName = screenshotFileName({
        ip: first?.ip ?? null,
        hostName: first?.name ?? null,
        column: hosts.find((h) => h.id === first?.id)?.column ?? null,
        caption: text,
        mime,
      });
      return {
        ...base,
        kind,
        // The caption's first line names the shot; without one it is just "Screenshot" (never joined to a host).
        title: noteTitle(text) || 'Screenshot',
        content: { kind: 'screenshot', attachmentId: '', caption: text.trim(), fileName },
        unknownScopeIps,
      };
    }
    case 'http': {
      const parts = httpParts(text);
      const attributed = hostsNamedIn(parts.request, hosts, domain)[0] ?? null;
      return {
        ...base,
        hostIds: attributed ? [attributed.id] : [],
        kind,
        title: httpTitle(parts, attributed),
        content: { kind: 'http', request: parts.request, response: parts.response },
        unknownScopeIps,
      };
    }
    case 'flag': {
      // A pasted proof block (whoami; ip a; cat local.txt) ran on the box itself; its interface
      // addresses (broadcast, other NICs) are not boxes to add.
      const found = findFlagInPaste(text);
      const flagKind = found?.flagKind ?? 'local';
      return {
        ...base,
        kind,
        ranOn: found && first ? first.name : base.ranOn,
        title: flagTitle(flagKind),
        content: { kind: 'flag', flagKind, value: found?.value ?? text.trim(), attachmentId: '', proof: found ? text.trim() : null },
        unknownScopeIps: found ? [] : unknownScopeIps,
      };
    }
    default:
      return { ...base, kind: 'note', title: noteTitle(text), content: { kind: 'note', text }, unknownScopeIps };
  }
}
