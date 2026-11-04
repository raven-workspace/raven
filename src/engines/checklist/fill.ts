import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { Tunnel } from '../../types/network';
import type { Service } from '../../types/service';
import { ipInScope, parseScopeList } from '../parse/scope';
import { findDcHost } from './facts';
import { resolveTemplate, type SubstitutionContext } from './template';

export interface FillInput {
  host: Host;
  engagement: Engagement;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  tunnels: Tunnel[];
  /** Settings.attackerIp: LHOST when the host is not behind a tunnel. */
  attackerIp: string;
  /** Settings.listenerPort: LPORT. */
  listenerPort: string;
}

export interface FillResult {
  text: string;
  unresolved: string[];
  viaTunnel?: { tunnel: Tunnel; viaHostName: string; down: boolean };
}

/** True for a valid IPv4 or IPv4 CIDR (surrounding whitespace ignored). */
function validEntry(entry: string): boolean {
  return parseScopeList(entry.trim()).entries.length === 1;
}

function contains(entry: string, ip: string): boolean {
  const e = entry.trim();
  return validEntry(e) && ipInScope(ip, [e]);
}

/**
 * The first tunnel with a valid subnet containing the host's IP. A tunnel through this host itself is skipped:
 * the pivot reaches Kali directly, never through its own tunnel's callback.
 */
export function tunnelFor(host: Host, tunnels: Tunnel[]): Tunnel | null {
  const ip = (host.ip ?? '').trim();
  if (!ip) return null;
  return tunnels.find((t) => t.viaHostId !== host.id && t.subnets.some((s) => contains(s, ip))) ?? null;
}

/**
 * SUBNET: the pivot's own tunnel subnet; else the one scope range that does not contain the host. With several
 * such ranges the next network is a guess, so it stays unresolved.
 */
function subnetFor(host: Host, engagement: Engagement, tunnels: Tunnel[]): string | undefined {
  const pivot = tunnels.find((t) => t.viaHostId === host.id && t.subnets.some((s) => validEntry(s)));
  if (pivot) return pivot.subnets.find((s) => validEntry(s))!.trim();
  const ip = (host.ip ?? '').trim();
  const candidates = new Set(
    engagement.scopeCidrs
      .map((s) => s.trim())
      .filter((s) => s.includes('/') && validEntry(s) && !(ip && contains(s, ip))),
  );
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function dcHostName(dc: Host, domain: string | undefined): string | undefined {
  const name = (dc.name ?? '').trim();
  if (!name) return undefined;
  if (name.includes('.') || !domain) return name;
  return `${name}.${domain}`;
}

/** Credentials (USER, PASS, HASH) are deliberately absent: they stay unresolved until step 4. */
export function commandContext(input: FillInput): SubstitutionContext {
  const { host, engagement, hosts, servicesByHost, tunnels } = input;
  const tunnel = tunnelFor(host, tunnels);
  const tunnelIp = tunnel?.callbackIp.trim() || undefined;
  const dc = findDcHost(hosts, servicesByHost);
  const domain = engagement.domain?.trim() || undefined;
  const subnet = subnetFor(host, engagement, tunnels);
  const prefix = subnet?.match(/^(\d+\.\d+\.\d+)\.\d+\/24$/)?.[1];

  const computed: Record<string, string | undefined> = {
    DC_HOST: dc ? dcHostName(dc, domain) : undefined,
    SUBNET: subnet,
    SUBNET_PREFIX: prefix,
    TUNNEL_IP: tunnelIp,
  };
  const customVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(computed)) if (v) customVars[k] = v;

  return {
    rhost: host.ip?.trim() || undefined,
    lhost: tunnel ? tunnelIp : input.attackerIp.trim() || undefined,
    lport: input.listenerPort.trim() || undefined,
    domain,
    dcIp: dc?.ip?.trim() || undefined,
    customVars,
  };
}

export function fillCommand(template: string, input: FillInput): FillResult {
  const ctx = commandContext(input);
  const { unresolved, ranges } = resolveTemplate(template, ctx);
  // The engine shows display defaults (10.10.14.X, 4444) for empty known fields; never present those as real.
  // INTERFACE alone keeps its tun0 default and is not reported.
  let text = '';
  let last = 0;
  for (const r of ranges) {
    text += template.slice(last, r.start);
    const token = template.slice(r.start, r.end);
    text += r.resolved || r.canonical === 'interface' ? resolveTemplate(token, ctx).text : token;
    last = r.end;
  }
  text += template.slice(last);

  const tunnel = tunnelFor(input.host, input.tunnels);
  const result: FillResult = { text, unresolved: unresolved.filter((u) => u !== 'INTERFACE') };
  if (tunnel) {
    result.viaTunnel = {
      tunnel,
      viaHostName: input.hosts.find((h) => h.id === tunnel.viaHostId)?.name ?? 'unknown host',
      down: tunnel.status === 'down',
    };
  }
  return result;
}
