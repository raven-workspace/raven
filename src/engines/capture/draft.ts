import type { BoardColumn, HostOs } from '../../types/host';
import type { CommandBlock, LogContent, LogKind } from '../../types/log';
import type { ScanPort } from '../../types/service';
import { HOST_IP, hostsNamedIn, isKaliLabel, namedHostsInLine, shellHost, type HostRef } from '../attribution';
import { analyzeCommandOutput } from '../parse/commandOutput';
import { splitPaste } from '../parse/logPaste';
import { ipInScope } from '../parse/scope';
import { httpParts, httpTitle } from './http';
import { detectKind } from './kind';
import { screenshotFileName } from './screenshot';
import { commandTitle, flagTitle, noteTitle } from './titles';

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
    let scan: CaptureDraft['scan'] = null;
    const analysis = analyzeCommandOutput(blocks.map((b) => b.output).join('\n'));
    if (analysis.scan && analysis.scan.format !== 'raw-ports' && attributed.length === 1) {
      scan = {
        hostId: attributed[0].id,
        ports: analysis.scan.ports.map((p) => ({
          port: p.port,
          protocol: p.protocol === 'udp' ? 'udp' : 'tcp',
          state: p.state,
          service: p.service,
          version: p.version,
        })),
        os: analysis.os?.os ?? null,
      };
    }
    return {
      kind,
      title: commandTitle(blocks, hosts, domain),
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
        title: first ? `Screenshot · ${first.name}` : 'Screenshot',
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
    case 'flag':
      return {
        ...base,
        kind,
        title: flagTitle('local', first),
        content: { kind: 'flag', flagKind: 'local', value: text.trim(), attachmentId: '' },
        unknownScopeIps,
      };
    default:
      return { ...base, kind: 'note', title: noteTitle(text), content: { kind: 'note', text }, unknownScopeIps };
  }
}
