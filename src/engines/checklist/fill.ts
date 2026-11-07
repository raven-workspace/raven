import type { CredAttempt, Credential } from '../../types/credentials';
import type { Engagement } from '../../types/engagement';
import type { Host } from '../../types/host';
import type { Tunnel } from '../../types/network';
import type { Service } from '../../types/service';
import { ipInScope, parseScopeList } from '../parse/scope';
import { isNtlmHash, isOwnerless } from '../credentials/matrix';
import { dcFillChoice, dcForFill, hostFacts, serviceNames } from './facts';
import type { ChecklistGoal } from './types';
import { quoteContextAt, shellEscape } from './shellQuote';
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
  /** The picked credential: the only source of USER, PASS and HASH. */
  cred?: Credential | null;
  /** Settings.kaliUser: KALI_USER. */
  kaliUser?: string;
  /** The open ports to offer for {PORT}; the first is filled. */
  portHint?: number[];
  /** Explicit token values keyed by upper-case token name (FILE, DEST_DIR, PORT, COMMUNITY...). They win over everything. */
  overrides?: Record<string, string>;
}

/**
 * The host's open ports to offer for {PORT}, ascending. Only state exactly `open` counts (a UDP scan's `open|filtered`
 * is unconfirmed, like the Rust side). Under a goal: only those matching its `applies.ports` or
 * `applies.services`; a goal with neither (or an empty `ports`) offers every open port.
 */
export function portChoices(input: FillInput, goal?: ChecklistGoal): number[] {
  const services = (input.servicesByHost.get(input.host.id) ?? []).filter((s) => (s.state ?? '').trim().toLowerCase() === 'open');
  const a = goal?.applies;
  const any = !a || (!a.ports && !a.services) || a.ports?.length === 0;
  const out = new Set<number>();
  for (const s of services) {
    if (any || a.ports?.includes(s.port) || a.services?.some((n) => serviceNames([s]).has(n))) out.add(s.port);
  }
  return [...out].sort((x, y) => x - y);
}

export interface FillOptions {
  /**
   * Display builds: PASS and HASH are still decided from the real credential, but their value is this mask.
   * Never mask by replacing text afterwards.
   */
  secretMask?: string;
  /**
   * Escape credential values (USER, DOMAIN, PASS, HASH) for the quoting context where each token sits, so a copied
   * command cannot be broken or injected by a secret. Bourne-shell rules: use it only for commands run from the
   * attacker (Kali) shell. Target-side commands keep raw values because PowerShell and cmd quote differently.
   * Never combine with `secretMask` (the mask is not a secret).
   */
  shellSafe?: boolean;
  /** The command's own OS. Used for {DEST_DIR} only when the host's OS is unknown (dashboard, no host). */
  commandOs?: string;
}

/** Passwords beat other secret types, then the newest attempt: a password works everywhere a hash does not. */
function preferred(best: { a: CredAttempt; c: Credential } | null, a: CredAttempt, c: Credential): { a: CredAttempt; c: Credential } {
  if (!best) return { a, c };
  const pw = (x: Credential) => (x.type === 'password' ? 1 : 0);
  if (pw(c) !== pw(best.c)) return pw(c) > pw(best.c) ? { a, c } : best;
  return a.at > best.a.at ? { a, c } : best;
}

/**
 * Engagement-level default: among domain-scope credentials with a valid or admin `domain` attempt anywhere in the
 * engagement, a password first, then the newest attempt.
 */
export function defaultDomainCred(credentials: Credential[], attempts: CredAttempt[]): Credential | null {
  const byId = new Map(credentials.filter((c) => c.scope === 'domain').map((c) => [c.id, c]));
  let best: { a: CredAttempt; c: Credential } | null = null;
  for (const a of attempts) {
    const c = byId.get(a.credId);
    if (a.authMode !== 'domain' || (a.result !== 'valid' && a.result !== 'admin') || !c) continue;
    best = preferred(best, a, c);
  }
  return best?.c ?? null;
}

/** Among credentials with a valid or admin attempt on this host: a password first, then the newest attempt. */
export function defaultCredFor(host: Pick<Host, 'id'>, credentials: Credential[], attempts: CredAttempt[]): Credential | null {
  const byId = new Map(credentials.map((c) => [c.id, c]));
  let best: { a: CredAttempt; c: Credential } | null = null;
  for (const a of attempts) {
    const c = byId.get(a.credId);
    if (a.hostId !== host.id || (a.result !== 'valid' && a.result !== 'admin') || !c) continue;
    best = preferred(best, a, c);
  }
  return best?.c ?? null;
}

/**
 * The credential commands fill with. `picked`: a credential id, null for "none", undefined for no pick. A missing
 * (deleted) pick falls back to the default: the host's own, else the engagement's domain default. No host: the latter.
 */
export function resolveCred(
  picked: string | null | undefined,
  credentials: Credential[],
  attempts: CredAttempt[],
  host: Pick<Host, 'id'> | null,
): Credential | null {
  if (picked === null) return null;
  const chosen = picked ? credentials.find((c) => c.id === picked) : undefined;
  if (chosen) return chosen;
  return (host ? defaultCredFor(host, credentials, attempts) : null) ?? defaultDomainCred(credentials, attempts);
}

export interface FillResult {
  text: string;
  unresolved: string[];
  viaTunnel?: { tunnel: Tunnel; viaHostName: string; down: boolean };
  /** A DC token was filled from a host picked only by its name (no 88/389 seen): worth a glance. */
  dcByName?: boolean;
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

/** Tokens `commandContext` computes itself (as custom variables), on top of the template engine's built-in ones. */
export const COMPUTED_TOKENS = [
  'PASS', 'HASH', 'DC_HOST', 'SUBNET', 'SUBNET_PREFIX', 'TUNNEL_IP', 'TARGET_HOST', 'HOSTNAME',
  'PIVOT_IP', 'PIVOT_NAME', 'KALI_USER', 'COMMUNITY', 'SOCKS_PORT', 'DEST_DIR', 'PORT',
] as const;

const DEST_DIRS: Record<string, string> = { windows: 'C:\\Windows\\Temp', linux: '/tmp' };
/** A writable temp dir for a known OS; never guessed (undefined leaves {DEST_DIR} for the user to fill). */
const destDir = (os: string | null | undefined): string | undefined => (os ? DEST_DIRS[os] : undefined);

export function commandContext(input: FillInput, opts: FillOptions = {}): SubstitutionContext {
  const { host, engagement, hosts, servicesByHost, tunnels } = input;
  const tunnel = tunnelFor(host, tunnels);
  const tunnelIp = tunnel?.callbackIp.trim() || undefined;
  const dc = dcForFill(hosts, servicesByHost);
  const cred = input.cred ?? null;
  const domain = cred?.domain?.trim() || engagement.domain?.trim() || undefined;
  const secret = cred ? cred.secret.trim() : '';
  // Decided from the real credential; the mask only replaces the value.
  const pass = cred?.type === 'password' && secret ? (opts.secretMask ?? cred.secret) : undefined;
  const hash = cred && secret && isNtlmHash(cred) ? (opts.secretMask ?? secret.split(':').pop()) : undefined;
  const facts = hostFacts(host, engagement, hosts, servicesByHost);
  const hostName = host.name?.trim() || undefined;
  const pivot = tunnel ? hosts.find((h) => h.id === tunnel.viaHostId) : undefined;
  const subnet = subnetFor(host, engagement, tunnels);
  const prefix = subnet?.match(/^(\d+\.\d+\.\d+)\.\d+\/24$/)?.[1];

  const computed: Record<(typeof COMPUTED_TOKENS)[number] | string, string | undefined> = {
    PASS: pass,
    HASH: hash,
    DC_HOST: dc ? dcHostName(dc, domain) : undefined,
    SUBNET: subnet,
    SUBNET_PREFIX: prefix,
    TUNNEL_IP: tunnelIp,
    TARGET_HOST: facts.domainJoined && engagement.domain?.trim() && hostName ? `${hostName}.${engagement.domain.trim()}` : hostName,
    HOSTNAME: hostName,
    PIVOT_IP: pivot?.ip?.trim() || undefined,
    PIVOT_NAME: pivot?.name?.trim() || undefined,
    KALI_USER: input.kaliUser?.trim() || undefined,
    COMMUNITY: 'public',
    SOCKS_PORT: '1080',
    DEST_DIR: destDir(host.os === 'windows' || host.os === 'linux' ? host.os : opts.commandOs),
    PORT: input.portHint?.length ? String(input.portHint[0]) : undefined,
  };
  for (const [k, v] of Object.entries(input.overrides ?? {})) if (v) computed[k.toUpperCase()] = v;
  const customVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(computed)) if (v) customVars[k] = v;

  // Explicit overrides also win over the global-field tokens (the Arsenal chips edit LHOST and TARGET_IP).
  const o = (name: string) => computed[name];
  return {
    rhost: o('TARGET_IP') ?? (host.ip?.trim() || undefined),
    lhost: o('LHOST') ?? (tunnel ? tunnelIp : input.attackerIp.trim() || undefined),
    lport: o('LPORT') ?? (input.listenerPort.trim() || undefined),
    domain: o('DOMAIN') ?? domain,
    user: o('USER') ?? (cred && !isOwnerless(cred) ? cred.username.trim() : undefined),
    dcIp: o('DC_IP') ?? (dc?.ip?.trim() || undefined),
    customVars,
  };
}

/** Tokens whose value is, or derives from, the credential (DC_HOST carries the credential's domain). */
const CRED_TOKENS = new Set(['USER', 'DOMAIN', 'PASS', 'HASH', 'DC_HOST']);

export function fillCommand(template: string, input: FillInput, opts: FillOptions = {}): FillResult {
  const ctx = commandContext(input, opts);
  const { unresolved, ranges } = resolveTemplate(template, ctx);
  // The engine shows display defaults (10.10.14.X, 4444) for empty known fields; never present those as real.
  // INTERFACE alone keeps its tun0 default and is not reported.
  let text = '';
  let last = 0;
  for (const r of ranges) {
    text += template.slice(last, r.start);
    const token = template.slice(r.start, r.end);
    let piece = r.resolved || r.canonical === 'interface' ? resolveTemplate(token, ctx).text : token;
    if (opts.shellSafe && r.resolved && CRED_TOKENS.has(r.raw.toUpperCase())) {
      piece = shellEscape(piece, quoteContextAt(template, r.start));
    }
    text += piece;
    last = r.end;
  }
  text += template.slice(last);

  const tunnel = tunnelFor(input.host, input.tunnels);
  const result: FillResult = { text, unresolved: unresolved.filter((u) => u !== 'INTERFACE') };
  const usesDc = ranges.some((r) => r.resolved && ['DC_IP', 'DC-IP', 'DC_HOST'].includes(r.raw.toUpperCase()));
  if (usesDc && !input.overrides?.DC_IP && dcFillChoice(input.hosts, input.servicesByHost).byName) result.dcByName = true;
  if (tunnel) {
    result.viaTunnel = {
      tunnel,
      viaHostName: input.hosts.find((h) => h.id === tunnel.viaHostId)?.name ?? 'unknown host',
      down: tunnel.status === 'down',
    };
  }
  return result;
}
