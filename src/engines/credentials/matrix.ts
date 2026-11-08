import type { CredAttempt, Credential } from '../../types/credentials';
import type { Host } from '../../types/host';
import type { Service } from '../../types/service';
import type { CredAuthMode, SprayService } from './types';

export const SERVICE_PORTS: Record<SprayService, number[]> = {
  smb: [445, 139],
  winrm: [5985, 5986],
  rdp: [3389],
  mssql: [1433],
  ssh: [22],
  ftp: [21],
  ldap: [389, 636],
  wmi: [135],
  vnc: [5900],
  nfs: [2049],
};

const SERVICE_ORDER: SprayService[] = ['smb', 'winrm', 'rdp', 'mssql', 'ssh', 'ftp', 'ldap', 'wmi', 'vnc', 'nfs'];

const SERVICE_NAMES: Record<string, SprayService> = {
  'microsoft-ds': 'smb', 'netbios-ssn': 'smb', smb: 'smb',
  wsman: 'winrm', wsmans: 'winrm', winrm: 'winrm', 'wsman-ssl': 'winrm',
  'ms-wbt-server': 'rdp', rdp: 'rdp',
  'ms-sql-s': 'mssql', mssql: 'mssql',
  ssh: 'ssh', ftp: 'ftp',
  ldap: 'ldap', ldaps: 'ldap', 'ldap-ssl': 'ldap',
  msrpc: 'wmi', wmi: 'wmi',
  vnc: 'vnc', nfs: 'nfs', nfsd: 'nfs',
};

/** The spray services a host runs, from its open scanned services (by port, and by nmap service name). */
export function hostSprayServices(_host: Host, services: Service[]): SprayService[] {
  const found = new Set<SprayService>();
  const byPort = (port: number) => {
    for (const s of SERVICE_ORDER) if (SERVICE_PORTS[s].includes(port)) found.add(s);
  };
  for (const sp of services) {
    if (sp.state !== 'open') continue;
    byPort(sp.port);
    const named = SERVICE_NAMES[(sp.nmapService ?? '').toLowerCase()];
    if (named) found.add(named);
  }
  return SERVICE_ORDER.filter((s) => found.has(s));
}

const NT_RE = /^[0-9a-f]{32}$/i;
const LMNT_RE = /^[0-9a-f]{32}:[0-9a-f]{32}$/i;

/** An NT (or LM:NT) hash credential. A plaintext password that happens to be 32 hex chars is not one. */
export function isNtlmHash(cred: Credential): boolean {
  if (cred.type !== 'hash') return false;
  const s = cred.secret.trim();
  return NT_RE.test(s) || LMNT_RE.test(s);
}

/** A secret with no known owner (found without a username). Sprayable only at the engagement's usernames. */
export function isOwnerless(c: Pick<Credential, 'username'>): boolean {
  return !c.username.trim();
}

const PLACEHOLDER_SECRETS = new Set(['none', 'n/a', '-', '']);

/** A password credential whose secret is a stand-in for "no secret" (the operator typed none / n/a / -). */
export function isPlaceholderSecret(c: Credential): boolean {
  return c.type === 'password' && PLACEHOLDER_SECRETS.has(c.secret.trim().toLowerCase());
}

/** A computer account (`HOST$`). Its password is machine-generated: never sprayed, never cracked. */
export function isMachineAccount(c: Pick<Credential, 'username'>): boolean {
  return c.username.trim().endsWith('$');
}

export function isSprayable(cred: Credential): boolean {
  if (isMachineAccount(cred)) return false;
  if (!cred.secret || !cred.secret.trim()) return false;
  if (cred.crackStatus === 'uncrackable') return false;
  if (cred.type === 'ticket' || cred.type === 'key' || cred.type === 'token') return false;
  if (cred.type === 'hash') {
    if (!isNtlmHash(cred)) return false;
    // 'MD5' on a 32-hex secret is a legacy auto-identification (identifyHash lists MD5 before NTLM), not a choice.
    if (cred.hashType && !/^(NTLM|pwdump)/i.test(cred.hashType) && !(cred.hashType === 'MD5' && NT_RE.test(cred.secret.trim()))) return false;
  }
  return true;
}

const LOCAL_ONLY: SprayService[] = ['ssh', 'ftp', 'vnc', 'nfs'];

export function authModesFor(cred: Credential, service: SprayService): CredAuthMode[] {
  const isHash = cred.type === 'hash';
  if (LOCAL_ONLY.includes(service)) return isHash ? [] : ['local'];
  if (service === 'ldap') return ['domain'];
  // A local account's password is often reused by a same-named domain account: try both, local first.
  return cred.scope === 'local' ? ['local', 'domain'] : ['domain', 'local'];
}

export type CellState = 'admin' | 'valid' | 'failed' | 'untested' | 'errored' | 'na';
export interface Cell {
  state: CellState;
  byMode: Partial<Record<CredAuthMode, CredAttempt>>;
  modesDiffer: boolean;
  /** Applicable modes with no result, or only errored ones (a 'failed' cell with any of these is partial). */
  untriedModes: CredAuthMode[];
}

const RANK: Record<string, number> = { admin: 4, valid: 3, failed: 2, errored: 1 };

export function cellFor(
  cred: Credential,
  host: Host,
  services: Service[],
  service: SprayService,
  attempts: CredAttempt[],
  usernameId?: string,
): Cell {
  const applicable = authModesFor(cred, service);
  if (applicable.length === 0 || !hostSprayServices(host, services).includes(service)) {
    return { state: 'na', byMode: {}, modesDiffer: false, untriedModes: [] };
  }
  const relevant = attempts.filter(
    (a) =>
      a.credId === cred.id &&
      a.hostId === host.id &&
      a.service === service &&
      (usernameId ? a.usernameId === usernameId : !a.usernameId),
  );
  // A mode the routine doesn't suggest still counts once tested (a local credential tried with -d).
  const modes = [...new Set([...applicable, ...relevant.map((a) => a.authMode)])];
  const byMode: Partial<Record<CredAuthMode, CredAttempt>> = {};
  for (const mode of modes) {
    const ofMode = relevant.filter((a) => a.authMode === mode);
    const real = ofMode.filter((a) => a.result !== 'errored');
    const pool = real.length ? real : ofMode;
    // latest non-errored result wins; errors never displace a real result
    let pick: CredAttempt | undefined;
    for (const a of pool) if (!pick || a.at >= pick.at) pick = a;
    if (pick) byMode[mode] = pick;
  }
  const untriedModes = applicable.filter((m) => !byMode[m] || byMode[m]!.result === 'errored');
  const results = Object.values(byMode).map((a) => a!.result);
  if (results.length === 0) return { state: 'untested', byMode, modesDiffer: false, untriedModes };
  const best = results.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  const real = results.filter((r) => r !== 'errored');
  return {
    state: best as CellState,
    byMode,
    modesDiffer: new Set(real).size > 1,
    untriedModes,
  };
}

/** The modes a cell shows: the applicable ones, then any other mode a result was recorded under. */
export function cellModes(cred: Credential, service: SprayService, cell: Cell): CredAuthMode[] {
  return [...new Set([...authModesFor(cred, service), ...(Object.keys(cell.byMode) as CredAuthMode[])])];
}

export type OverallState = 'admin' | 'valid' | 'untested' | 'dead' | 'not-sprayable';

export function overallState(
  cred: Credential,
  hosts: Host[],
  servicesByHost: Map<string, Service[]>,
  attempts: CredAttempt[],
): OverallState {
  if (!isSprayable(cred)) return 'not-sprayable';
  let valid = false;
  let open = false;
  let any = false;
  for (const h of hosts) {
    const services = servicesByHost.get(h.id) ?? [];
    for (const s of hostSprayServices(h, services)) {
      const cell = cellFor(cred, h, services, s, attempts);
      if (cell.state === 'na') continue;
      any = true;
      if (cell.state === 'admin') return 'admin';
      if (cell.state === 'valid') valid = true;
      else if (cell.state !== 'failed') open = true;
      else {
        // failed in one mode but another applicable mode never tried
        if (cell.untriedModes.length > 0) open = true;
      }
    }
  }
  if (valid) return 'valid';
  if (!any || open) return 'untested';
  return 'dead';
}

/**
 * A cracked hash and its recorded plaintext are one account secret: list only the plaintext, and count
 * the hash's results (pass-the-hash) as the plaintext's, so the account shows once and is never re-sprayed.
 */
export function foldCrackedHashes(creds: Credential[], attempts: CredAttempt[]): { creds: Credential[]; attempts: CredAttempt[] } {
  const ids = new Set(creds.map((c) => c.id));
  const plainFor = new Map<string, string>();
  for (const c of creds) if (c.type === 'password' && c.crackedFrom && ids.has(c.crackedFrom)) plainFor.set(c.crackedFrom, c.id);
  if (plainFor.size === 0) return { creds, attempts };
  return {
    creds: creds.filter((c) => !plainFor.has(c.id)),
    attempts: attempts.map((a) => (plainFor.has(a.credId) ? { ...a, credId: plainFor.get(a.credId)! } : a)),
  };
}

/**
 * Hashes captured from a challenge or a ticket (Kerberoast, AS-REP, NetNTLM) differ on every capture but crack
 * to the same password, so the account and the kind identify them, not the text. NT and stored hashes return null.
 */
export function hashCaptureKind(c: Pick<Credential, 'type' | 'secret' | 'hashType'>): string | null {
  if (c.type !== 'hash') return null;
  const s = c.secret.trim();
  if (/^\$krb5tgs\$/i.test(s)) return 'krb5tgs';
  if (/^\$krb5asrep\$/i.test(s)) return 'krb5asrep';
  if (/^NetNTLM/i.test(c.hashType ?? '') || /^[^:\s]+::[^:]*:[0-9a-f]{16}:/i.test(s)) return 'netntlm';
  return null;
}

const captureRank = (c: Credential) => (c.crackStatus === 'cracked' ? 0 : c.crackStatus === 'uncrackable' ? 2 : 1);

/** One captured hash per account and kind (re-roasts stored before captures were deduplicated): the cracked one, else the first. */
export function dedupeHashCaptures(creds: Credential[]): Credential[] {
  const keep = new Map<string, Credential>();
  const keyOf = (c: Credential) => {
    const kind = hashCaptureKind(c);
    if (!kind) return null;
    const host = c.scope === 'local' ? (c.localHostId ?? '') : '';
    return [kind, c.username.trim().toLowerCase(), (c.domain ?? '').trim().toLowerCase(), c.engagementId, host].join('|');
  };
  for (const c of creds) {
    const k = keyOf(c);
    if (!k) continue;
    const held = keep.get(k);
    if (!held || captureRank(c) < captureRank(held)) keep.set(k, c);
  }
  return creds.filter((c) => {
    const k = keyOf(c);
    return !k || keep.get(k) === c;
  });
}
