import { describe, expect, it } from "vitest";
import { targetCredentials, type ReportData } from "../engines/report";
import type { LogEntry } from "../types/log";

const H = "h1";
const cred = (id: string, username: string, secret: string, extra = {}) =>
  ({ id, username, secret, domain: null, type: "password", localHostId: null, sourceHostId: null, createdAt: 1, ...extra });
const cmd = (id: string, command: string, extra = {}) =>
  ({ id, kind: "command", title: id, hostIds: [H], private: false, content: { kind: "command", blocks: [{ command, output: "" }] }, ...extra }) as unknown as LogEntry;

function data(log: LogEntry[], credentials = [cred("c1", "bob", "Spring2026!"), cred("c2", "alice", "Other1!")]): ReportData {
  return {
    hosts: [{ id: H, name: "ms01", ip: "10.0.0.5" }, { id: "h2", name: "dc01", ip: "10.0.0.10" }],
    credentials,
    credAttempts: [],
    usernames: [],
    grants: [],
    log,
  } as unknown as ReportData;
}
const tied = (d: ReportData) => targetCredentials(d, [H]).credentials.map((c) => [c.username, c.ties.join("; ")]);

describe("targetCredentials: direct logins", () => {
  it.each([
    ["ssh user@ip (password typed at the prompt)", "ssh bob@10.0.0.5"],
    ["ssh user@name", "ssh bob@ms01"],
    ["evil-winrm -u -p", "evil-winrm -i 10.0.0.5 -u bob -p 'Spring2026!'"],
    ["xfreerdp /u: /p:", "xfreerdp /v:10.0.0.5 /u:bob /p:Spring2026! /cert:ignore"],
    ["impacket user:pass@ip", "impacket-psexec corp.local/bob:'Spring2026!'@10.0.0.5"],
  ])("ties the credential a login names: %s", (_shape, command) => {
    expect(tied(data([cmd("e", command)]))).toEqual([["bob", "used on ms01"]]);
  });

  it("ties a hash passed as its NT half", () => {
    const nt = "7f1e4bd3c2a95e608d1f2b4c6a8e0d93";
    const d = data([cmd("e", `impacket-psexec corp/da_admin@10.0.0.5 -hashes :${nt}`)], [cred("h", "da_admin", nt, { type: "hash" })]);
    expect(tied(d)).toEqual([["da_admin", "used on ms01"]]);
  });

  it("ties only the credential whose secret a login passes, never every one of that username", () => {
    const nt = "7f1e4bd3c2a95e608d1f2b4c6a8e0d93";
    const creds = [cred("a1", "administrator", nt, { type: "hash" }), cred("a2", "administrator", "aad3b435b51404eeaad3b435b51404ee:0123456789abcdef0123456789abcdef", { type: "hash" })];
    const d = data([cmd("e", `impacket-psexec corp/administrator@10.0.0.5 -hashes :${nt}`)], creds);
    expect(targetCredentials(d, [H]).credentials.map((c) => c.key)).toEqual(["a1"]);
  });

  it("ties nothing by user@host when that username has more than one credential, or the command passes a secret", () => {
    const roots = [cred("r1", "root", "toor1234"), cred("r2", "root", "Other#2026")];
    expect(tied(data([cmd("e", "ssh root@10.0.0.5")], roots))).toEqual([]);
    // A secret passed that isn't the credential's: the account alone proves nothing.
    expect(tied(data([cmd("e", "sshpass -p 'Wrong1!' ssh bob@10.0.0.5")]))).toEqual([]);
    // ssh's -p is a port.
    expect(tied(data([cmd("e", "ssh -p 2222 bob@10.0.0.5")]))).toEqual([["bob", "used on ms01"]]);
  });

  it("matches a secret as a whole word, a short one only as the exact -p or /p: argument", () => {
    const short = [cred("s", "bob", "pw1")];
    expect(tied(data([cmd("e", "evil-winrm -i 10.0.0.5 -u bob -p pw1")], short))).toEqual([["bob", "used on ms01"]]);
    expect(tied(data([cmd("e", "xfreerdp /v:10.0.0.5 /u:bob /p:pw1")], short))).toEqual([["bob", "used on ms01"]]);
    expect(tied(data([cmd("e", "evil-winrm -i 10.0.0.5 -u bob -p pw12")], short))).toEqual([]);
    expect(tied(data([cmd("e", "nxc smb 10.0.0.5 -u bob -p 'Spring2026!x'")]))).toEqual([]);
  });

  it("ignores a username alone, another host, a private entry, and a username inside a longer word", () => {
    expect(tied(data([cmd("e", "ssh bob@10.0.0.10")]))).toEqual([]);
    expect(tied(data([cmd("e", "evil-winrm -i 10.0.0.5 -u bob -p wrong")]))).toEqual([]);
    expect(tied(data([cmd("e", "ssh bob@10.0.0.5", { private: true })]))).toEqual([]);
    expect(tied(data([cmd("e", "ssh bobby@10.0.0.5")]))).toEqual([]);
    expect(tied(data([cmd("e", "evil-winrm -i 10.0.0.5 -u bob -p 'Spring2026!'", { hostIds: ["h2"] })]))).toEqual([]);
  });
});
