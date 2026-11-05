import type { AttemptResult } from '../../types/credentials';
import type { SprayService } from './types';

export interface NxcAuthResult {
  protocol: SprayService;
  ip: string;
  port: number;
  hostLabel: string;
  domain?: string;
  username: string;
  secret: string;
  result: AttemptResult;
  detail?: string;
  line: string;
}

const LINE_RE = /^\s*(SMB|WINRM|RDP|SSH|MSSQL|LDAPS?|FTP|WMI|VNC|NFS)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s+(\S+)\s+\[([+-])\]\s+(.*)$/;

const FAILED_REASONS = [
  'STATUS_LOGON_FAILURE',
  'STATUS_ACCOUNT_DISABLED',
  'STATUS_ACCOUNT_EXPIRED',
  'STATUS_PASSWORD_EXPIRED',
  'STATUS_INVALID_LOGON_HOURS',
  'STATUS_ACCOUNT_RESTRICTION',
  'Login incorrect',
  'Authentication failed',
  // MSSQL: wrong password, unknown login, or a domain login sent where only local works (and vice versa)
  'Login failed',
  // LDAP over Kerberos: wrong password, no such user
  'KDC_ERR_PREAUTH_FAILED',
  'KDC_ERR_C_PRINCIPAL_UNKNOWN',
];
// LDAP bind error 52e (invalid credentials), printed raw by older nxc versions
const LDAP_BAD_CREDS_RE = /\b52e\b/;

// Error indicators win over failure keywords: an errored attempt must never count as failed.
const ERROR_RE = /banner|reset|timed out|timeout|errno|error|locked_out|connection/i;

function toProtocol(raw: string): SprayService {
  const p = raw.toLowerCase();
  return (p === 'ldaps' ? 'ldap' : p) as SprayService;
}

function splitPrincipal(principal: string): { domain?: string; username: string } | null {
  if (!principal || /\s/.test(principal)) return null;
  const bs = principal.indexOf('\\');
  if (bs >= 0) {
    const username = principal.slice(bs + 1);
    return username ? { domain: principal.slice(0, bs) || undefined, username } : null;
  }
  const at = principal.lastIndexOf('@');
  if (at > 0) {
    const username = principal.slice(0, at);
    const domain = principal.slice(at + 1);
    return { domain: domain || undefined, username };
  }
  return { username: principal };
}

export function parseNxcAuthResults(text: string, knownSecrets: string[] = []): NxcAuthResult[] {
  const secrets = knownSecrets.filter(s => s).sort((a, b) => b.length - a.length);
  const out: NxcAuthResult[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const [, proto, ip, port, hostLabel, mark, body] = m;
    const colon = body.indexOf(':');
    if (colon <= 0) continue;
    const who = splitPrincipal(body.slice(0, colon));
    if (!who) continue;
    const rest = body.slice(colon + 1);
    // A known secret only counts when it ends the text or is followed by whitespace: a shorter known
    // secret must never swallow the start of a longer password (Welcome1 vs Welcome1!).
    const known = secrets.find(s => rest.startsWith(s) && (rest.length === s.length || /\s/.test(rest[s.length])));
    let secret: string;
    if (known) secret = known;
    else secret = rest.split(/\s/)[0];
    if (!secret) continue;
    const tail = rest.slice(secret.length);
    const pwned = /\(Pwn3d!\)/.test(tail);
    const reason = tail.replace(/\(Pwn3d!\)/g, '').trim();

    let result: AttemptResult;
    let detail: string | undefined;
    if (mark === '+') {
      result = pwned ? 'admin' : 'valid';
    } else if (!reason) {
      result = 'failed';
    } else if (reason.includes('STATUS_PASSWORD_MUST_CHANGE')) {
      result = 'valid';
      detail = reason;
    } else if (ERROR_RE.test(reason)) {
      result = 'errored';
      detail = reason;
    } else if (FAILED_REASONS.some(r => reason.includes(r)) || LDAP_BAD_CREDS_RE.test(reason)) {
      result = 'failed';
    } else {
      result = 'errored';
      detail = reason;
    }
    out.push({
      protocol: toProtocol(proto), ip, port: Number(port), hostLabel,
      ...(who.domain ? { domain: who.domain } : {}),
      username: who.username, secret, result,
      ...(detail ? { detail } : {}),
      line: raw.trim(),
    });
  }
  return out;
}

export function parseRoastHashes(text: string): { kind: 'krb5tgs' | 'krb5asrep'; username: string; domain?: string; hash: string }[] {
  const out: { kind: 'krb5tgs' | 'krb5asrep'; username: string; domain?: string; hash: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tgs = /\$krb5tgs\$\d+\$\*([^$*]+)\$([^$*]+)\$[^\s]*/.exec(line);
    if (tgs) {
      out.push({ kind: 'krb5tgs', username: tgs[1], domain: tgs[2], hash: tgs[0] });
      continue;
    }
    const as = /\$krb5asrep\$(?:\d+\$)?([^@:$\s]+)(?:@([^:\s]+))?:\S+/.exec(line);
    if (as) out.push({ kind: 'krb5asrep', username: as[1], ...(as[2] ? { domain: as[2] } : {}), hash: as[0] });
  }
  return out;
}
