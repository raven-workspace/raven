import type { CredAttempt, Credential, Username } from "../../types/credentials";
import { identifyHash } from "./hashes";
import { hashCaptureKind } from "./matrix";

/** Dedupe key: engagement + case-insensitive username + case-insensitive domain. */
export function usernameKey(u: Pick<Username, "engagementId" | "username" | "domain">): string {
  return `${u.engagementId ?? ""}|${u.username.trim().toLowerCase()}|${(u.domain ?? "").trim().toLowerCase()}`;
}

/**
 * Dedupe key. Hash secrets compare case-insensitively (hex), everything else is case-sensitive on the
 * secret. sourceHostId is intentionally NOT part of the key: the first capture wins.
 */
/** Ruling F-R1: a secret keeps its spaces; only leading and trailing line breaks go. Agrees with Rust. */
export const stripLineBreaks = (s: string): string => s.replace(/^[\r\n]+|[\r\n]+$/g, "");

/** A hash loses all edge whitespace; any other secret only edge line breaks. Agrees with Rust `clean_secret`. */
const cleanSecret = (c: Pick<Credential, "type" | "secret">): string => (c.type === "hash" ? c.secret.trim() : stripLineBreaks(c.secret));

export function credKey(c: Pick<Credential, "type" | "username" | "secret" | "domain" | "hashType">): string {
  // A captured hash (Kerberoast, AS-REP, NetNTLM) differs per capture: the account and kind identify it.
  const kind = hashCaptureKind(c);
  const secret = kind ? `capture:${kind}` : c.type === "hash" ? cleanSecret(c).toLowerCase() : cleanSecret(c);
  return `${c.type}|${c.username.trim().toLowerCase()}|${secret}|${(c.domain ?? "").trim().toLowerCase()}`;
}

const hasSecret = (c: Pick<Credential, "type" | "secret">): boolean => cleanSecret(c) !== "";

type Scoped = Pick<Credential, "engagementId" | "scope" | "localHostId">;

/** A local credential is per host; any other scope has no host part. */
const localHostPart = (c: Scoped): string => (c.scope === "local" ? (c.localHostId ?? "") : "");

/** Two credentials are the same only inside one engagement (and, for scope 'local', on one host). */
const sameScope = (a: Scoped, b: Scoped): boolean =>
  (a.engagementId ?? "") === (b.engagementId ?? "") && localHostPart(a) === localHostPart(b);

/**
 * Existing credential with the same id, or (for non-empty secrets only) the same credKey in the same
 * engagement (and local host, for local credentials).
 */
export function findDuplicateCredential(list: Credential[], cred: Credential): Credential | undefined {
  const byId = list.find((c) => c.id === cred.id);
  if (byId) return byId;
  if (!hasSecret(cred)) return undefined;
  const key = credKey(cred);
  return list.find((c) => hasSecret(c) && credKey(c) === key && sameScope(c, cred));
}

/**
 * Whether two domain spellings name the same domain (R16): equal ignoring case, or a NetBIOS name (`CORP`) and an FQDN
 * (`corp.lan`) whose first label it is. mimikatz and RID brute print NetBIOS; nxc and secretsdump print the FQDN.
 */
export function sameDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  if (x === y) return true;
  if (!x || !y) return false;
  const [netbios, fqdn] = x.includes(".") ? [y, x] : [x, y];
  return !netbios.includes(".") && fqdn.includes(".") && fqdn.split(".")[0] === netbios;
}

/**
 * `findDuplicateCredential`, where a stored credential whose domain is the same domain spelled the other way
 * (`sameDomain`) also counts as the duplicate.
 */
export function findStoredCredential(list: Credential[], cred: Credential): Credential | undefined {
  return (
    findDuplicateCredential(list, cred) ??
    list.find((c) => !!c.domain && !!cred.domain && sameDomain(c.domain, cred.domain) && !!findDuplicateCredential([c], { ...cred, domain: c.domain }))
  );
}

/** Identity of an attempt: the subject (credential or username), the host, the service and the auth mode. */
export function attemptKey(a: Pick<CredAttempt, "credId" | "usernameId" | "hostId" | "service" | "authMode">): string {
  return `${a.credId}|${a.usernameId ?? ""}|${a.hostId}|${a.service}|${a.authMode}`;
}

/**
 * Default hash type for a new or re-typed hash credential. Agrees with Rust's `derive_hash_type`
 * (src-tauri/src/credentials.rs): a bare 32-hex secret is NTLM (in an engagement it is almost always an NT
 * hash, and MD5 would make it unsprayable); an `LM:NT` pair is pwdump. Elsewhere, where Rust leaves none,
 * this takes identifyHash's top candidate.
 */
export function defaultHashType(secret: string): string | undefined {
  const s = secret.trim();
  if (/^[0-9a-f]{32}$/i.test(s)) return "NTLM";
  if (/^[0-9a-f]{32}:[0-9a-f]{32}$/i.test(s)) return "pwdump (LM:NT)";
  return identifyHash(s)[0]?.name;
}
