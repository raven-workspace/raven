import type { CredAttempt } from "../../types/credentials";

/**
 * The stored marker of password reuse (GLOSSARY.md): a dumped local account whose name and secret match a local
 * credential stored for another host is filed as an attempt of that credential on the new host, with this service and
 * this detail. A dump names no service, so `other` stands in. Rust's `attempts::PASSWORD_REUSE_*` are the same text.
 */
export const PASSWORD_REUSE_SERVICE = "other" satisfies CredAttempt["service"];
export const PASSWORD_REUSE_DETAIL = "password reuse";

/** Whether an attempt is password reuse rather than a result on a service. Rust's `attempts::is_reuse` is the same rule. */
export function isReuseAttempt(a: Pick<CredAttempt, "service" | "detail">): boolean {
  return a.service === PASSWORD_REUSE_SERVICE && a.detail === PASSWORD_REUSE_DETAIL;
}

/**
 * Password reuse, worded: the host it was reused on and, when known, the host the credential is stored for.
 * `reused on SQL01 (same password as WEB01)`.
 */
export function reuseWording(onHost: string, storedHost: string | null): string {
  return storedHost ? `reused on ${onHost} (same password as ${storedHost})` : `reused on ${onHost}`;
}
