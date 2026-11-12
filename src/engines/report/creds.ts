import type { AccessGrant, Credential, Username } from "../../types/credentials";
import type { ReportData } from "./types";

/** A credential tied to a target, with each way it is tied ("works on SSH, files03", "found on web01"). */
export interface TargetCredential {
  key: string;
  username: string;
  domain: string | null;
  type: Credential["type"];
  ties: string[];
}

export interface TargetAccess {
  grant: AccessGrant;
  user: Username | undefined;
}

/**
 * Everything that ties credentials and access to a target's hosts (`hostIds`), however it was captured:
 *  - a credential (or a username tried with its secret) with a valid or admin result on one of them (nxc, hydra:
 *    found elsewhere, it worked here; it often has no source host and no access grant);
 *  - a credential local to one of them, or found on one of them;
 *  - access grants on them, with their usernames.
 * In the order the credentials were added; access in time order.
 */
export function targetCredentials(data: ReportData, hostIds: string[]): { credentials: TargetCredential[]; access: TargetAccess[] } {
  const ids = new Set(hostIds);
  const name = (id: string) => data.hosts.find((h) => h.id === id)?.name ?? "a host";
  const byKey = new Map<string, TargetCredential & { at: number }>();
  const tie = (key: string, base: Omit<TargetCredential, "key" | "ties"> & { at: number }, why: string) => {
    const row = byKey.get(key) ?? { key, ...base, ties: [] };
    if (!row.ties.includes(why)) row.ties.push(why);
    byKey.set(key, row);
  };
  const credOf = (id: string) => data.credentials.find((c) => c.id === id);

  for (const c of data.credentials) {
    const base = { username: c.username, domain: c.domain, type: c.type, at: c.createdAt };
    if (c.localHostId && ids.has(c.localHostId)) tie(c.id, base, `local to ${name(c.localHostId)}`);
    if (c.sourceHostId && ids.has(c.sourceHostId)) tie(c.id, base, `found on ${name(c.sourceHostId)}`);
  }
  for (const a of [...data.credAttempts].sort((x, y) => x.at - y.at)) {
    if (!ids.has(a.hostId) || (a.result !== "valid" && a.result !== "admin")) continue;
    const c = credOf(a.credId);
    if (!c) continue;
    const why = `${a.result === "admin" ? "admin" : "works"} on ${a.service.toUpperCase()}, ${name(a.hostId)}`;
    // A username tried with this credential's secret: that username is the one that works.
    const user = a.usernameId ? data.usernames.find((u) => u.id === a.usernameId) : undefined;
    if (user) tie(`${user.id}:${c.id}`, { username: user.username, domain: user.domain, type: c.type, at: a.at }, why);
    else tie(c.id, { username: c.username, domain: c.domain, type: c.type, at: c.createdAt }, why);
  }
  const credentials = [...byKey.values()]
    .sort((a, b) => a.at - b.at)
    .map((r): TargetCredential => ({ key: r.key, username: r.username, domain: r.domain, type: r.type, ties: r.ties }));
  const access = data.grants
    .filter((g) => ids.has(g.hostId))
    .sort((a, b) => a.at - b.at)
    .map((grant) => ({ grant, user: data.usernames.find((u) => u.id === grant.usernameId) }));
  return { credentials, access };
}
