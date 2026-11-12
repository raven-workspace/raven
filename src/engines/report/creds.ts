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
 *  - a credential used in a non-private command on one of them: its username and secret both in the command (`evil-winrm
 *    -u bob -p pw`, `xfreerdp /u:bob /p:pw`, `psexec corp/bob:pw@ip`), or its username at one of their IPs or names
 *    (`ssh bob@10.0.0.5`, whose password is typed at the prompt). A direct login leaves no attempt or grant;
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
  // Direct logins: the command names the credential.
  const hosts = data.hosts.filter((h) => ids.has(h.id));
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = (x: string) => new RegExp(`(?<![\\w.-])${esc(x)}(?![\\w-])`, "i");
  const commands = data.log.filter((e) => !e.private && e.content.kind === "command" && e.hostIds.some((h) => ids.has(h)));
  for (const c of data.credentials) {
    if (c.username.trim() === "" || c.secret.trim() === "") continue;
    // A hash is passed as its NT half (`-H <nt>`, `-hashes :<nt>`).
    const secrets = c.type === "hash" ? [c.secret, c.secret.split(":").pop() ?? ""].filter((x) => x.length >= 16) : [c.secret];
    const user = word(c.username);
    for (const e of commands) {
      if (e.content.kind !== "command") continue;
      const on = e.hostIds.find((h) => ids.has(h))!;
      const used = e.content.blocks.some((b) => {
        const cmd = b.command ?? "";
        if (!user.test(cmd)) return false;
        if (secrets.some((x) => cmd.includes(x))) return true;
        return hosts.some((h) => [h.ip, h.name].some((t) => t && new RegExp(`(?<![\\w.-])${esc(c.username)}@${esc(t)}(?![\\w-]|\\.\\d)`, "i").test(cmd)));
      });
      if (used) tie(c.id, { username: c.username, domain: c.domain, type: c.type, at: c.createdAt }, `used on ${name(on)}`);
    }
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
