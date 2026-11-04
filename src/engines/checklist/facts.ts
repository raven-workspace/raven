import type { Engagement, EngagementKind } from '../../types/engagement';
import type { Host, HostOs } from '../../types/host';
import type { Service } from '../../types/service';
import { HOST_STAGES } from './data/hostChecklist';
import type { ChecklistGoal, ChecklistStage } from './types';

export interface HostFacts {
  os: 'linux' | 'windows' | null;
  ports: Set<number>;
  services: Set<string>;
  dualHomed: boolean;
  domainJoined: boolean;
  kind: EngagementKind;
}

const isDead = (s: Service): boolean => {
  const state = (s.state ?? '').toLowerCase();
  return state.startsWith('closed') || state.startsWith('filtered');
};

/** Open TCP/UDP ports from scanned services that are not closed/filtered. */
export function openPorts(services: Service[]): Set<number> {
  const ports = new Set<number>();
  for (const s of services) if (!isDead(s)) ports.add(s.port);
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

export function serviceNames(services: Service[]): Set<string> {
  const out = new Set<string>();
  for (const s of services) {
    if (isDead(s)) continue;
    if (s.confirmedProduct) {
      const product = s.confirmedProduct.toLowerCase();
      const hit = CONFIRMED_WORDS.find(([re]) => re.test(product));
      if (hit) out.add(hit[1]);
      continue;
    }
    const name = (s.nmapService ?? '').toLowerCase().trim();
    if (!name) continue;
    if (name.startsWith('http') || name.startsWith('ssl/http')) {
      // WinRM / HTTPAPI listeners are reported as http by nmap but are not web apps.
      const notWeb = /httpapi/i.test(s.nmapVersion ?? '') || [5985, 5986, 47001].includes(s.port);
      if (!notWeb) out.add('http');
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

/** Hosts with both 88 (Kerberos) and 389 (LDAP) open. There is no DC pin. */
export function adHosts(hosts: Host[], servicesByHost: ServicesByHost): Host[] {
  return hosts.filter((h) => {
    const ports = openPorts(servicesByHost.get(h.id) ?? []);
    return ports.has(88) && ports.has(389);
  });
}

/** The engagement's domain controller: the only AD host, else null. */
export function findDcHost(hosts: Host[], servicesByHost: ServicesByHost): Host | null {
  const found = adHosts(hosts, servicesByHost);
  return found.length === 1 ? found[0] : null;
}

export function hostFacts(
  host: Host,
  engagement: Pick<Engagement, 'kind'> | null,
  hosts: Host[],
  servicesByHost: ServicesByHost,
): HostFacts {
  const services = servicesByHost.get(host.id) ?? [];
  const os = hostOs(host.os);
  const ports = openPorts(services);
  // Joined: the host is itself a DC-like host (88/389), or a Windows host in an engagement with any AD host.
  const domainJoined =
    ports.has(88) || ports.has(389) || (os === 'windows' && adHosts(hosts, servicesByHost).length > 0);
  return {
    os,
    ports,
    services: serviceNames(services),
    dualHomed: host.dualHomed === true,
    domainJoined,
    kind: engagement?.kind ?? 'lab',
  };
}

/** Facts for engagement-level goals: no OS or ports of its own, domain-joined when any host is AD. */
export function engagementFacts(
  engagement: Pick<Engagement, 'kind'>,
  hosts: Host[],
  servicesByHost: ServicesByHost,
): HostFacts {
  return {
    os: null,
    ports: new Set(),
    services: new Set(),
    dualHomed: false,
    domainJoined: adHosts(hosts, servicesByHost).length > 0,
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
        ? facts.ports.size > 0 || facts.services.size > 0
        : a.ports.some((p) => facts.ports.has(p))
      : false;
    const serviceHit = a.services ? a.services.some((s) => facts.services.has(s)) : false;
    if (!portHit && !serviceHit) return false;
  }
  return true;
}

function stageHint(stage: ChecklistStage, facts: HostFacts): string | undefined {
  if (!stage.emptyHint) return undefined;
  if (stage.id === 'enumerate') return facts.ports.size === 0 && facts.services.size === 0 ? stage.emptyHint : undefined;
  if (stage.id === 'privesc') return facts.os === null ? stage.emptyHint : undefined;
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
