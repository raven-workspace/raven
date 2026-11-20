import type { AccessGrant, Credential, Username } from "../../types/credentials";
import type { ReportData } from "./types";
import { escapeRegExp } from "../regex";

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

/** A command that passes a secret: `-p`, `-H`, `-hashes`, `--password`, `--hashes`, `/p:`, `/pth:`, or `user:pw@host`. */
const SECRET_ARG = /(?:^|\s)(?:-p|-H|-hashes|--password|--hashes|--pass)(?:\s|=|$)|\/p(?:th)?:|[^\s:/@]:[^\s@]+@/i;
/** Whether a command passes a secret. ssh, scp and sftp take `-p`/`-P` as a port, not a password. */
const passesAnySecret = (cmd: string) =>
  SECRET_ARG.test(/^\s*(?:sudo\s+)?(?:ssh|scp|sftp)\b/i.test(cmd) ? cmd.replace(/(?:^|\s)-[pP]\s*\d+(?=\s|$)/g, " ") : cmd);
/** Characters that can't sit next to a secret inside one shell word: it stands alone or behind `-p `, `:`, `/p:`, quotes. */
const AROUND = `\\s'"=:/@\\\\`;

/** Output that says a login failed: nxc's `[-]`, ssh's "Permission denied", SMB's LOGON_FAILURE, WinRM's and FTP's. */
const FAILED_LOGIN = /\[-\]|Permission denied|LOGON_FAILURE|Authentication failed|Login incorrect/i;
/** A login whose output says it failed, unless it also says one worked (`[+]`, a spray over several hosts). */
const loginFailed = (output: string) => FAILED_LOGIN.test(output) && !output.includes("[+]");

/** The username as a whole word of the command (not `bobby` for `bob`). */
const namesUser = (cmd: string, username: string) => new RegExp(`(?<![\\w.-])${escapeRegExp(username)}(?![\\w-])`, "i").test(cmd);

/**
 * Whether the command passes the credential's secret as a whole word (a hash also by its NT half). A secret under 4
 * characters only counts as the exact argument of `-p`/`--password` or `/p:`.
 */
function passesSecret(cmd: string, c: Credential): boolean {
  const secrets = c.type === "hash" ? [c.secret, c.secret.split(":").pop() ?? ""].filter((x) => x.length >= 16) : [c.secret];
  return secrets.some((x) => {
    if (x.length < 4) return new RegExp(`(?:(?:^|\\s)(?:-p|--password)\\s+['"]?|/p:['"]?)${escapeRegExp(x)}['"]?(?:\\s|$)`).test(cmd);
    return new RegExp(`(?<![^${AROUND}])${escapeRegExp(x)}(?![^${AROUND}])`).test(cmd);
  });
}

/**
 * Everything that ties credentials and access to a target's hosts (`hostIds`), however it was captured:
 *  - a credential (or a username tried with its secret) with a valid or admin result on one of them (nxc, hydra:
 *    found elsewhere, it worked here; it often has no source host and no access grant);
 *  - a credential local to one of them, or found on one of them;
 *  - a credential used in a non-private command on one of them: its username and secret both in the command, the secret
 *    as a whole word (`evil-winrm -u bob -p pw`, `xfreerdp /u:bob /p:pw`, `psexec corp/bob:pw@ip`, `-hashes :<nt>`);
 *    or, when the command passes no secret at all, its username at one of their IPs or names (`ssh bob@10.0.0.5`, the
 *    password typed at the prompt), only when that username has exactly one credential. A direct login leaves no
 *    attempt or grant; one whose output says it failed (`[-]`, "Permission denied") ties nothing, nor does a
 *    credential with a failed attempt on that host;
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
  const commands = data.log.filter((e) => !e.private && e.content.kind === "command" && e.hostIds.some((h) => ids.has(h)));
  const sameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // A credential that failed on one of the entry's hosts: its own attempt, or its username tried with its secret.
  const failedOn = (c: Credential, hostIdsOf: string[]) =>
    data.credAttempts.some((a) => {
      if (a.result !== "failed" || !hostIdsOf.includes(a.hostId)) return false;
      if (a.credId === c.id && !a.usernameId) return true;
      const user = a.usernameId ? data.usernames.find((u) => u.id === a.usernameId)?.username : credOf(a.credId)?.username;
      return user != null && sameUser(user, c.username) && credOf(a.credId)?.secret === c.secret;
    });
  for (const e of commands) {
    if (e.content.kind !== "command") continue;
    const on = e.hostIds.find((h) => ids.has(h))!;
    const onIds = e.hostIds.filter((h) => ids.has(h));
    for (const b of e.content.blocks) {
      const cmd = b.command ?? "";
      if (loginFailed(b.output ?? "")) continue;
      const named = data.credentials.filter(
        (c) => c.username.trim() !== "" && c.secret.trim() !== "" && namesUser(cmd, c.username) && !failedOn(c, onIds),
      );
      const bySecret = named.filter((c) => passesSecret(cmd, c));
      for (const c of bySecret) tie(c.id, { username: c.username, domain: c.domain, type: c.type, at: c.createdAt }, `used on ${name(on)}`);
      // `ssh bob@10.0.0.5`: the password is typed at the prompt, so the command names only the account. It ties the
      // credential only when no secret is passed at all, none matched, and the account has exactly one credential.
      if (passesAnySecret(cmd)) continue;
      for (const c of named) {
        if (bySecret.some((x) => sameUser(x.username, c.username))) continue;
        if (data.credentials.filter((x) => sameUser(x.username, c.username)).length !== 1) continue;
        const atHost = hosts.some((h) => [h.ip, h.name].some((t) => t && new RegExp(`(?<![\\w.-])${escapeRegExp(c.username)}@${escapeRegExp(t)}(?![\\w-]|\\.\\d)`, "i").test(cmd)));
        if (atHost) tie(c.id, { username: c.username, domain: c.domain, type: c.type, at: c.createdAt }, `used on ${name(on)}`);
      }
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
