import type { Engagement, EngagementKind } from '../../types/engagement';
import type { Host, HostOs } from '../../types/host';
import type { Service } from '../../types/service';
import { HOST_STAGES } from './data/hostChecklist';
import type { ChecklistGoal, ChecklistStage } from './types';

export interface HostFacts {
  os: 'linux' | 'windows' | null;
  ports: Set<number>;
  services: Set<string>;
  /** Any open service row exists (the host has been scanned), confirmed or not. */
  scanned: boolean;
  dualHomed: boolean;
  domainJoined: boolean;
  kind: EngagementKind;
}

/** A scanned service that is not closed or filtered (open, open|filtered, or no state recorded). */
export function isOpenService(s: Service): boolean {
  const state = (s.state ?? '').toLowerCase();
  return !state.startsWith('closed') && !state.startsWith('filtered');
}

/**
 * A service in state exactly `open`, as the store's AD set rule counts it. The AD set and DC tests use this, never
 * `isOpenService`: a UDP scan reports `open|filtered` for most ports, which would make every UDP-scanned host a DC.
 */
export function isStrictlyOpen(s: Service): boolean {
  return s.state === 'open';
}

/** Open TCP/UDP ports from scanned services that are not closed/filtered. */
export function openPorts(services: Service[]): Set<number> {
  const ports = new Set<number>();
  for (const s of services) if (isOpenService(s)) ports.add(s.port);
  return ports;
}

/** A confirmed product name, first match wins. The confirmed identity replaces nmap's guess. */
export const CONFIRMED_WORDS: [RegExp, string][] = [
  [/http|apache|nginx|iis|tomcat|jetty|lighttpd|caddy|werkzeug|express/, 'http'],
  [/samba|smb/, 'smb'],
  [/openssh|ssh/, 'ssh'],
  [/mysql|mariadb/, 'mysql'],
  [/postgres/, 'postgresql'],
  [/redis/, 'redis'],
  [/mongo/, 'mongodb'],
  [/mssql|sql server/, 'mssql'],
  [/ftp/, 'ftp'],
  [/ldap|active directory/, 'ldap'],
  [/winrm/, 'winrm'],
  [/rdp|terminal services/, 'rdp'],
  [/snmp/, 'snmp'],
  [/smtp|postfix|exim|sendmail/, 'smtp'],
  [/nfs/, 'nfs'],
  [/dns|bind/, 'dns'],
];

/** WinRM / HTTPAPI listeners are reported as http but are not web apps. */
const isNotWeb = (version: string | null, port: number): boolean =>
  /httpapi/i.test(version ?? '') || [5985, 5986, 47001].includes(port);

export function serviceNames(services: Service[]): Set<string> {
  const out = new Set<string>();
  for (const s of services) {
    if (!isOpenService(s)) continue;
    if (s.confirmedProduct) {
      const product = s.confirmedProduct.toLowerCase();
      const hit = CONFIRMED_WORDS.find(([re]) => re.test(product));
      if (hit && !(hit[1] === 'http' && isNotWeb(s.confirmedProduct, s.port))) out.add(hit[1]);
      continue;
    }
    const name = (s.nmapService ?? '').toLowerCase().trim();
    if (!name) continue;
    if (name.startsWith('http') || name.startsWith('ssl/http')) {
      if (!isNotWeb(s.nmapVersion, s.port)) out.add('http');
      continue;
    }
    out.add(name);
    if (name === 'microsoft-ds' || name === 'netbios-ssn') out.add('smb');
    if (name === 'domain') out.add('dns');
    if (name === 'ms-sql-s') out.add('mssql');
    if (name === 'ms-wbt-server') out.add('rdp');
    if (name === 'msrpc' || name === 'rpcbind') out.add('rpc');
    if (name === 'wsman' || name === 'wsmans') out.add('winrm');
  }
  return out;
}

export function hostOs(os: HostOs | null): HostFacts['os'] {
  if (os === 'windows') return 'windows';
  if (os === 'linux') return 'linux';
  return null;
}

type ServicesByHost = Map<string, Service[]>;

/** The AD set (GLOSSARY.md): the store's `adSetEffective`, the switch if set, else 88 and 389 both open. Never recomputed here. */
export function adSetHosts(hosts: Host[]): Host[] {
  return hosts.filter((h) => h.adSetEffective);
}

const kerberosAndLdapOpen = (services: Service[]): boolean =>
  [88, 389].every((port) => services.some((s) => s.port === port && isStrictlyOpen(s)));

/** AD set members with Kerberos (88) and LDAP (389) both strictly open: the DC candidates. */
const dcCandidates = (hosts: Host[], servicesByHost: ServicesByHost): Host[] =>
  adSetHosts(hosts).filter((h) => kerberosAndLdapOpen(servicesByHost.get(h.id) ?? []));

/**
 * The engagement's DC (GLOSSARY.md): the only AD set member with 88 and 389 both strictly open. An exam AD set is three
 * machines with one DC, so the other members are not DCs. None or several candidates means no DC. There is no DC pin.
 */
export function findDc(hosts: Host[], servicesByHost: ServicesByHost): Host | null {
  const found = dcCandidates(hosts, servicesByHost);
  return found.length === 1 ? found[0] : null;
}

/** `DC01`, `dc`, `corp-dc1` (first DNS label). Not `dc-web` or `dc_files`. */
const DC_NAME = /^dc\d*$|[-_]dc\d*$/i;
const namedLikeDc = (h: Host): boolean => DC_NAME.test((h.name ?? '').trim().split('.')[0] ?? '');
const one = (hs: Host[]): Host | null => (hs.length === 1 ? hs[0] : null);

/**
 * The DC that fills `{DC_IP}` / `{DC_HOST}`. Wider than `findDc`: an exam DC often sits behind a pivot and is never
 * scanned from Kali. In order: the DC (`findDc`); among several DC candidates, the only one named like a DC; the only
 * host with Kerberos (88) open; the only host named like a DC. Anything still ambiguous fills nothing.
 */
export function dcForFill(hosts: Host[], servicesByHost: ServicesByHost): Host | null {
  return dcFillChoice(hosts, servicesByHost).dc;
}

/** `dcForFill` plus whether the host's name decided it (the UI shows "DC (by name)"). */
export function dcFillChoice(hosts: Host[], servicesByHost: ServicesByHost): { dc: Host | null; byName: boolean } {
  const candidates = dcCandidates(hosts, servicesByHost);
  if (candidates.length === 1) return { dc: candidates[0], byName: false };
  if (candidates.length > 1) {
    const dc = one(candidates.filter(namedLikeDc));
    return { dc, byName: dc !== null };
  }
  const kerberos = one(hosts.filter((h) => openPorts(servicesByHost.get(h.id) ?? []).has(88)));
  if (kerberos) return { dc: kerberos, byName: false };
  const named = one(hosts.filter(namedLikeDc));
  return { dc: named, byName: named !== null };
}

export function hostFacts(
  host: Host,
  engagement: Pick<Engagement, 'kind'> | null,
  hosts: Host[],
  servicesByHost: ServicesByHost,
): HostFacts {
  const services = servicesByHost.get(host.id) ?? [];
  const os = hostOs(host.os);
  // A confirmed service speaks only through its confirmed identity: its port no longer counts.
  const ports = openPorts(services.filter((s) => !s.confirmedProduct));
  const scanned = openPorts(services).size > 0;
  // Joined: the host is in the AD set, or is a Windows host in an engagement with any AD set member.
  const domainJoined = host.adSetEffective || (os === 'windows' && adSetHosts(hosts).length > 0);
  return {
    os,
    ports,
    services: serviceNames(services),
    scanned,
    dualHomed: host.dualHomed === true,
    domainJoined,
    kind: engagement?.kind ?? 'lab',
  };
}

/** Facts for engagement-level goals: no OS or ports of its own, domain-joined when the AD set has any member. */
export function engagementFacts(engagement: Pick<Engagement, 'kind'>, hosts: Host[]): HostFacts {
  return {
    os: null,
    ports: new Set(),
    services: new Set(),
    scanned: false,
    dualHomed: false,
    domainJoined: adSetHosts(hosts).length > 0,
    kind: engagement.kind,
  };
}

export function goalApplies(goal: ChecklistGoal, facts: HostFacts): boolean {
  const a = goal.applies;
  if (!a) return true;
  if (a.os && (facts.os === null || !a.os.includes(facts.os))) return false;
  if (a.dualHomed && !facts.dualHomed) return false;
  if (a.domainJoined && !facts.domainJoined) return false;
  if (a.kinds && !a.kinds.includes(facts.kind)) return false;
  if (a.ports || a.services) {
    const portHit = a.ports
      ? a.ports.length === 0
        ? facts.scanned || facts.ports.size > 0 || facts.services.size > 0
        : a.ports.some((p) => facts.ports.has(p))
      : false;
    const serviceHit = a.services ? a.services.some((s) => facts.services.has(s)) : false;
    if (!portHit && !serviceHit) return false;
  }
  return true;
}

function stageHint(stage: ChecklistStage, facts: HostFacts): string | undefined {
  if (!stage.emptyHint) return undefined;
  if (stage.id === 'information-gathering') return !facts.scanned && facts.ports.size === 0 && facts.services.size === 0 ? stage.emptyHint : undefined;
  if (stage.id === 'privilege-escalation') return facts.os === null ? stage.emptyHint : undefined;
  return undefined;
}

/** Pure over the host: never reads or writes checklist state, so hidden goals keep their progress. */
export function applicableGoals(
  host: Host,
  engagement: Pick<Engagement, 'kind'> | null,
  hosts: Host[],
  servicesByHost: ServicesByHost,
): { stage: ChecklistStage; goals: ChecklistGoal[]; hint?: string }[] {
  const facts = hostFacts(host, engagement, hosts, servicesByHost);
  const out: { stage: ChecklistStage; goals: ChecklistGoal[]; hint?: string }[] = [];
  for (const stage of HOST_STAGES) {
    const goals = stage.goals.filter((goal) => goalApplies(goal, facts));
    const hint = stageHint(stage, facts);
    if (goals.length === 0 && !hint) continue;
    out.push({ stage, goals, ...(hint ? { hint } : {}) });
  }
  return out;
}

/** The stages shown on a host's own checklist: those placed on the engagement view are dropped. */
export function hostViewStages<T extends { stage: ChecklistStage }>(applicable: T[]): T[] {
  return applicable.filter((a) => a.stage.placement !== 'engagement');
}
