import type { Credential, Username } from "../../types/credentials";

/** `DOMAIN\user`, "(owner unknown)" for a secret with no owner, "(hash)" for a hash. */
export const credLabel = (c: Pick<Credential, "domain" | "username" | "type">): string =>
  `${c.domain ? `${c.domain}\\` : ""}${c.username || "(owner unknown)"}${c.type === "hash" ? " (hash)" : ""}`;

/** `credLabel` without the "(hash)" suffix, for places where a Type column already says so. */
export const credName = (c: Pick<Credential, "domain" | "username">): string =>
  `${c.domain ? `${c.domain}\\` : ""}${c.username || "(owner unknown)"}`;

export const usernameLabel = (u: Pick<Username, "domain" | "username">): string =>
  `${u.domain ? `${u.domain}\\` : ""}${u.username}`;
