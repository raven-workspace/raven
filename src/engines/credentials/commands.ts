import type { CredAttempt, Credential, Username } from '../../types/credentials';
import type { Host } from '../../types/host';
import { singleQuoted } from '../checklist/shellQuote';
import type { Service } from '../../types/service';
import { LOCAL_ONLY_SERVICES, SPRAY_SERVICE_ORDER, authModesFor, cellFor, hostSprayServices, isNtlmHash, isOwnerless, isSprayable, ntHalf } from './matrix';
import type { CredAuthMode, SprayService } from './types';

export interface TestCommand {
  service: SprayService;
  authMode: CredAuthMode;
  hostIds: string[];
  command: string;
  targets?: string;
}
export interface CommandSet {
  commands: TestCommand[];
  notice?: 'no-services' | 'nothing-left' | 'not-sprayable';
}

// LOCAL_ONLY_SERVICES (ssh/ftp/vnc/nfs): auth mode 'local' is a storage key only; nxc rejects -d / --local-auth there.

export function shellQuote(s: string): string {
  return singleQuoted(s);
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_') || 'cred';

/** `-H`/`-p` is chosen from the real credential; `mask` (display builds) replaces the quoted value, unquoted. */
function secretFlag(cred: Credential, mask?: string): string {
  if (isNtlmHash(cred)) {
    return `-H ${mask ?? shellQuote(ntHalf(cred.secret))}`;
  }
  return `-p ${mask ?? shellQuote(cred.secret)}`;
}

function authFlag(cred: Credential, service: SprayService, mode: CredAuthMode, domain?: string): string {
  if (LOCAL_ONLY_SERVICES.has(service)) return '';
  if (mode === 'local') return '--local-auth';
  const d = cred.scope === 'app' ? undefined : (cred.domain || domain);
  return d ? `-d ${shellQuote(d)}` : '';
}

const join = (...parts: (string | undefined)[]) => parts.filter((p) => p && p.length).join(' ');

function needsRun(cell: ReturnType<typeof cellFor>, mode: CredAuthMode): boolean {
  if (cell.state === 'na') return false;
  const a = cell.byMode[mode];
  return !a || a.result === 'errored';
}

export function buildTestCommands(input: {
  cred: Credential;
  hosts: Host[];
  /** Open scanned services per host id; a host with no entry runs nothing. */
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
  services?: SprayService[];
  domain?: string;
  useTargetsFile?: boolean;
  extraFlags?: string;
  /** Appended to the tee file name (`...[-local]-<suffix>.txt`) so a step doesn't overwrite another's output. */
  teeSuffix?: string;
  /**
   * R11 (Shares step): also target hosts where this credential already works (valid/admin) in that mode, since
   * enumeration flags like --shares are only useful where the credential authenticates.
   */
  includeWorking?: boolean;
  /** Display builds: emitted unquoted in place of the secret value. Everything else is unchanged. */
  secretMask?: string;
}): CommandSet {
  const { cred, hosts, attempts } = input;
  const sv = (h: Host) => input.servicesByHost.get(h.id) ?? [];
  if (!isSprayable(cred) || isOwnerless(cred)) return { commands: [], notice: 'not-sprayable' };
  const wanted = (input.services ?? SPRAY_SERVICE_ORDER).filter((s) => SPRAY_SERVICE_ORDER.includes(s));
  const runnable = hosts.filter((h) => h.ip!);
  const present = SPRAY_SERVICE_ORDER.filter((s) => wanted.includes(s) && runnable.some((h) => hostSprayServices(h, sv(h)).includes(s)));
  if (present.length === 0) return { commands: [], notice: 'no-services' };

  const commands: TestCommand[] = [];
  for (const service of present) {
    for (const mode of authModesFor(cred, service)) {
      const todo = runnable.filter((h) => {
        const cell = cellFor(cred, h, sv(h), service, attempts);
        if (needsRun(cell, mode)) return true;
        const r = cell.byMode[mode]?.result;
        return !!input.includeWorking && (r === 'valid' || r === 'admin');
      });
      if (todo.length === 0) continue;
      const ips = todo.map((h) => h.ip!);
      const command = join(
        'nxc', service, input.useTargetsFile ? 'targets.txt' : ips.join(' '),
        `-u ${shellQuote(cred.username)}`, secretFlag(cred, input.secretMask),
        authFlag(cred, service, mode, input.domain), input.extraFlags?.trim(),
        `| tee nxc-${service}-${safeName(cred.username)}${mode === 'local' && !LOCAL_ONLY_SERVICES.has(service) ? '-local' : ''}${input.teeSuffix ? `-${safeName(input.teeSuffix)}` : ''}.txt`,
      );
      commands.push({
        service, authMode: mode, hostIds: todo.map((h) => h.id), command,
        ...(input.useTargetsFile ? { targets: ips.join('\n') } : {}),
      });
    }
  }
  return commands.length ? { commands } : { commands: [], notice: 'nothing-left' };
}

export function buildRoastCommands(input: { cred: Credential; hosts: Host[]; servicesByHost: Map<string, Service[]>; domain?: string; secretMask?: string }): CommandSet {
  const { cred } = input;
  if (!isSprayable(cred) || isOwnerless(cred) || (cred.scope ?? 'domain') !== 'domain') return { commands: [], notice: 'not-sprayable' };
  const sv = (h: Host) => input.servicesByHost.get(h.id) ?? [];
  const ldap = input.hosts.filter((h) => h.ip && hostSprayServices(h, sv(h)).includes('ldap'));
  if (ldap.length === 0) return { commands: [], notice: 'no-services' };
  const command = join(
    'nxc ldap', ldap.map((h) => h.ip!).join(' '),
    `-u ${shellQuote(cred.username)}`, secretFlag(cred, input.secretMask), authFlag(cred, 'ldap', 'domain', input.domain),
    '--kerberoasting kerb.txt --asreproast asrep.txt',
    `| tee nxc-ldap-roast-${safeName(cred.username)}.txt`,
  );
  return { commands: [{ service: 'ldap', authMode: 'domain', hostIds: ldap.map((h) => h.id), command }] };
}

const ntOf = (s: string) => { const t = s.trim().toLowerCase(); return t.includes(':') ? t.split(':')[1] : t; };
const sameSecret = (a: Credential, b: Credential) => (a.type === 'hash' ? ntOf(a.secret) === ntOf(b.secret) : a.secret === b.secret);

export function buildUsernameSprayCommands(input: {
  passwordCred: Credential;
  usernames: Username[];
  hosts: Host[];
  /** Open scanned services per host id; a host with no entry runs nothing. */
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
  service?: SprayService;
  domain?: string;
  /** The engagement's credentials: a user's own credential with this password counts as that user tried. */
  credentials?: Credential[];
  /** Display builds: emitted unquoted in place of the secret value. */
  secretMask?: string;
}): CommandSet & { usersFile: string } {
  const { passwordCred: cred, attempts } = input;
  const service = input.service ?? 'smb';
  const empty = (notice: CommandSet['notice']) => ({ commands: [], notice, usersFile: '' });
  // An NT hash can be sprayed (-H) only when it has no owner; a named user's hash is tested per host instead.
  if (!isSprayable(cred) || (cred.type === 'hash' && !isOwnerless(cred))) return empty('not-sprayable');
  const sv = (h: Host) => input.servicesByHost.get(h.id) ?? [];
  const runnable = input.hosts.filter((h) => h.ip && hostSprayServices(h, sv(h)).includes(service));
  if (runnable.length === 0) return empty('no-services');

  const modes = authModesFor(cred, service);
  const sprayTag = isOwnerless(cred) ? `secret-${safeName(cred.id.slice(-6))}` : safeName(cred.username);
  const lc = (s?: string) => (s ?? '').trim().toLowerCase();
  // R12 moves a username's spray results onto the credential accepted for it; they still mean "tried".
  const ownCreds = (u: Username) =>
    (input.credentials ?? []).filter(
      (c) => c.id !== cred.id && c.type === cred.type && sameSecret(c, cred) && lc(c.username) === lc(u.username) &&
        (!u.domain || !c.domain || lc(u.domain) === lc(c.domain)),
    );
  const triedAsOwn = (u: Username, h: Host, mode: CredAuthMode) =>
    ownCreds(u).some((c) => attempts.some(
      (a) => a.credId === c.id && !a.usernameId && a.hostId === h.id && a.service === service && a.authMode === mode && a.result !== 'errored',
    ));
  const pending = (u: Username, h: Host, mode: CredAuthMode) =>
    needsRun(cellFor(cred, h, sv(h), service, attempts, u.id), mode) && !triedAsOwn(u, h, mode);
  const users = input.usernames.filter((u) => runnable.some((h) => modes.some((m) => pending(u, h, m))));
  if (users.length === 0) return empty('nothing-left');

  const commands: TestCommand[] = [];
  for (const mode of modes) {
    const todo = runnable.filter((h) => users.some((u) => pending(u, h, mode)));
    if (todo.length === 0) continue;
    commands.push({
      service, authMode: mode, hostIds: todo.map((h) => h.id),
      command: join(
        'nxc', service, todo.map((h) => h.ip!).join(' '),
        '-u users.txt', secretFlag(cred, input.secretMask), '--continue-on-success',
        authFlag(cred, service, mode, input.domain),
        `| tee nxc-${service}-spray-${sprayTag}${mode === 'local' && !LOCAL_ONLY_SERVICES.has(service) ? '-local' : ''}.txt`,
      ),
    });
  }
  return { commands, usersFile: users.map((u) => u.username).join('\n') };
}

export type RoutineStepId = 'smb' | 'winrm' | 'rdp' | 'mssql' | 'ssh' | 'shares' | 'roast' | 'spray-users';

export const ROUTINE_STEPS: { id: RoutineStepId; itemId: string; title: string }[] = [
  { id: 'smb', itemId: 'cred-routine-smb', title: 'SMB' },
  { id: 'winrm', itemId: 'cred-routine-winrm', title: 'WinRM' },
  { id: 'rdp', itemId: 'cred-routine-rdp', title: 'RDP' },
  { id: 'mssql', itemId: 'cred-routine-mssql', title: 'MSSQL' },
  { id: 'ssh', itemId: 'cred-routine-ssh', title: 'SSH' },
  { id: 'shares', itemId: 'cred-routine-shares', title: 'Shares (--shares)' },
  { id: 'roast', itemId: 'cred-routine-roast', title: 'Kerberoast + AS-REP roast' },
  { id: 'spray-users', itemId: 'cred-routine-spray-users', title: 'Spray known passwords at usernames' },
];

export function routineStepApplies(
  step: RoutineStepId,
  cred: Credential,
  hosts: Host[],
  servicesByHost: Map<string, Service[]>,
  usernames: Username[],
): boolean {
  if (!isSprayable(cred)) return false;
  if (isOwnerless(cred) && step !== 'spray-users') return false;
  const has = (s: SprayService) => hosts.some((h) => hostSprayServices(h, servicesByHost.get(h.id) ?? []).includes(s)) && authModesFor(cred, s).length > 0;
  switch (step) {
    case 'smb': case 'winrm': case 'rdp': case 'mssql': case 'ssh': return has(step);
    case 'shares': return has('smb');
    case 'roast': return (cred.scope ?? 'domain') === 'domain' && has('ldap');
    case 'spray-users': return (cred.type !== 'hash' || isOwnerless(cred)) && usernames.length > 0 && has('smb');
  }
}
