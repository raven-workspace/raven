import type { Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";

/** `DOMAIN\user`, "(owner unknown)" for a secret with no owner, "(hash)" for a hash. */
export const credLabel = (c: Pick<Credential, "domain" | "username" | "type">): string =>
  `${c.domain ? `${c.domain}\\` : ""}${c.username || "(owner unknown)"}${c.type === "hash" ? " (hash)" : ""}`;

/** `credLabel` without the "(hash)" suffix, for places where a Type column already says so. */
export const credName = (c: Pick<Credential, "domain" | "username">): string =>
  `${c.domain ? `${c.domain}\\` : ""}${c.username || "(owner unknown)"}`;

export const usernameLabel = (u: Pick<Username, "domain" | "username">): string =>
  `${u.domain ? `${u.domain}\\` : ""}${u.username}`;

/** A local credential whose host was deleted (the store keeps it, with no host). */
export const isHostDeleted = (c: Pick<Credential, "scope" | "localHostId">): boolean => c.scope === "local" && !c.localHostId;

/** A credential's scope as shown: "local (host deleted)" once its host is gone, never an empty host name. */
export const scopeLabel = (c: Pick<Credential, "scope" | "localHostId">): string => (isHostDeleted(c) ? "local (host deleted)" : c.scope);

/**
 * A local username's scope as shown: "local to WEB01", or "local (host deleted)" once its host is gone (the store keeps
 * it, with no host). Null for a domain or unknown username.
 */
export function usernameScopeLabel(u: Pick<Username, "scope" | "localHostId">, hosts: Pick<Host, "id" | "name" | "ip">[]): string | null {
  if (u.scope !== "local") return null;
  const host = u.localHostId ? hosts.find((h) => h.id === u.localHostId) : undefined;
  return host ? `local to ${host.name || host.ip || host.id}` : "local (host deleted)";
}
