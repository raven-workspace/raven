import type { CredAttempt, Credential, Username } from "../../types/credentials";
import { identifyHash } from "./hashes";
import { hashCaptureKind } from "./matrix";

/**
 * A username's grouping key: engagement + case-insensitive username + case-insensitive domain. It names a planned
 * username and groups equal spellings; it does not decide identity (the store does, by same domain: GLOSSARY).
 */
export function usernameKey(u: Pick<Username, "engagementId" | "username" | "domain">): string {
  return `${u.engagementId ?? ""}|${u.username.trim().toLowerCase()}|${(u.domain ?? "").trim().toLowerCase()}`;
}

/** Ruling F-R1: a secret keeps its spaces; only leading and trailing line breaks go. Agrees with Rust. */
export const stripLineBreaks = (s: string): string => s.replace(/^[\r\n]+|[\r\n]+$/g, "");

/** A hash loses all edge whitespace; any other secret only edge line breaks. Agrees with Rust `clean_secret`. */
const cleanSecret = (c: Pick<Credential, "type" | "secret">): string => (c.type === "hash" ? c.secret.trim() : stripLineBreaks(c.secret));

/**
 * A credential's grouping key: type, username, secret (hashes case-insensitive, a captured hash by its kind) and the
 * domain as spelled. It groups the lines of one output that name one credential; it does not decide identity (the
 * store does: same credential, GLOSSARY).
 */
export function credKey(c: Pick<Credential, "type" | "username" | "secret" | "domain" | "hashType">): string {
  // A captured hash (Kerberoast, AS-REP, NetNTLM) differs per capture: the account and kind identify it.
  const kind = hashCaptureKind(c);
  const secret = kind ? `capture:${kind}` : c.type === "hash" ? cleanSecret(c).toLowerCase() : cleanSecret(c);
  return `${c.type}|${c.username.trim().toLowerCase()}|${secret}|${(c.domain ?? "").trim().toLowerCase()}`;
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
