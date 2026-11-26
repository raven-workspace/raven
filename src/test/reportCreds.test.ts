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

  it("never ties a login that failed: an nxc spray marked [-], or ssh answered with Permission denied", () => {
    const out = (command: string, output: string) =>
      ({ id: "e", kind: "command", title: "e", hostIds: [H], private: false, content: { kind: "command", blocks: [{ command, output }] } }) as unknown as LogEntry;
    expect(tied(data([out("nxc smb 10.0.0.5 -u bob -p 'Spring2026!'", "SMB  10.0.0.5  445  MS01  [-] corp.local\\bob:Spring2026! STATUS_LOGON_FAILURE")]))).toEqual([]);
    expect(tied(data([out("ssh bob@10.0.0.5", "bob@10.0.0.5's password: \nPermission denied, please try again.")]))).toEqual([]);
    for (const said of ["Authentication failed.", "Login incorrect", "NT_STATUS_LOGON_FAILURE"]) {
      expect(tied(data([out("evil-winrm -i 10.0.0.5 -u bob -p 'Spring2026!'", said)])), said).toEqual([]);
    }
    // A login that worked still ties.
    expect(tied(data([out("ssh bob@10.0.0.5", "Welcome to Ubuntu\nbob@ms01:~$")]))).toEqual([["bob", "used on ms01"]]);
  });

  describe("a spray over several hosts", () => {
    const spray = (hostIds: string[], output: string) =>
      ({ id: "e", kind: "command", title: "e", hostIds, private: false, content: { kind: "command", blocks: [{ command: "nxc smb 10.0.0.5 10.0.0.10 -u bob -p 'Spring2026!'", output }] } }) as unknown as LogEntry;
    const both = (d: ReportData) => targetCredentials(d, [H, "h2"]).credentials.map((c) => [c.username, c.ties.join("; ")]);

    it("ties each host whose line says [+], never one whose line says it failed", () => {
      const output = "SMB  10.0.0.5   445  MS01  [-] corp.local\\bob:Spring2026! STATUS_LOGON_FAILURE\nSMB  10.0.0.10  445  DC01  [+] corp.local\\bob:Spring2026!";
      expect(both(data([spray([H, "h2"], output)]))).toEqual([["bob", "used on dc01"]]);
      // Named by its name, not its IP, and on both.
      const named = "SMB  ms01  445  [+] corp.local\\bob:Spring2026!\nSMB  dc01  445  [+] corp.local\\bob:Spring2026! (Pwn3d!)";
      expect(both(data([spray([H, "h2"], named)]))).toEqual([["bob", "used on ms01; used on dc01"]]);
    });

    it("with no [+] line naming one of its hosts, ties only an entry with one host", () => {
      const anonymous = "[+] corp.local\\bob:Spring2026!";
      expect(both(data([spray([H, "h2"], anonymous)]))).toEqual([]);
      expect(both(data([spray([H], anonymous)]))).toEqual([["bob", "used on ms01"]]);
      // An IP that only starts like a host's is another host.
      expect(both(data([spray([H, "h2"], "SMB  10.0.0.50  445  [+] corp.local\\bob:Spring2026!")]))).toEqual([]);
    });
  });

  it("never ties a login whose credential (or username) failed on that host", () => {
    const failed = (o: Record<string, unknown>) => ({ id: "a", credId: "c1", usernameId: null, hostId: H, service: "ssh", result: "failed", at: 5, ...o });
    const creds = [cred("c1", "bob", "Spring2026!"), cred("c2", "alice", "Other1!"), cred("c3", "svc", "Spring2026!")];
    const d = (attempt: Record<string, unknown>, usernames: unknown[] = []) =>
      ({ ...data([cmd("e", "ssh bob@10.0.0.5")], creds), credAttempts: [attempt], usernames }) as unknown as ReportData;
    expect(tied(d(failed({})))).toEqual([]);
    // The username bob tried with this credential's secret (svc's, the same password) failed.
    const bob = [{ id: "u1", username: "bob", domain: null }];
    expect(tied(d(failed({ credId: "c3", usernameId: "u1" }), bob))).toEqual([]);
    // bob tried with another secret says nothing about this one.
    expect(tied(d(failed({ credId: "c2", usernameId: "u1" }), bob))).toEqual([["bob", "used on ms01"]]);
    // A failure on another host says nothing about this one.
    expect(tied(d(failed({ hostId: "h2" })))).toEqual([["bob", "used on ms01"]]);
  });
});

describe("targetCredentials: password reuse", () => {
  // zoe's local password, stored for dc01, found again in a dump on ms01: an attempt marked as password reuse.
  const zoe = cred("cj", "zoe", "Winter2024!", { localHostId: "h2" });
  const attempt = (o: Record<string, unknown>) => ({ id: "a", credId: "cj", usernameId: null, hostId: H, port: null, result: "valid", authMode: "local", at: 5, ...o });
  const reuse = attempt({ service: "other", detail: "password reuse" });
  const withAttempts = (credAttempts: unknown[]) => ({ ...data([], [zoe]), credAttempts }) as unknown as ReportData;

  it("words a reuse attempt as reuse, naming the host the credential is stored for, never as works on OTHER", () => {
    expect(tied(withAttempts([reuse]))).toEqual([["zoe", "reused on ms01 (same password as dc01)"]]);
    // With the stored host in the target too, it is local there and reused here.
    const both = targetCredentials(withAttempts([reuse]), [H, "h2"]).credentials.map((c) => c.ties);
    expect(both).toEqual([["local to dc01", "reused on ms01 (same password as dc01)"]]);
  });

  it("words reuse without the stored host when it was deleted", () => {
    const orphan = { ...withAttempts([reuse]), credentials: [{ ...zoe, localHostId: null }] } as unknown as ReportData;
    expect(tied(orphan)).toEqual([["zoe", "reused on ms01"]]);
  });

  it("still words a real result on another service as before", () => {
    expect(tied(withAttempts([attempt({ service: "other", detail: null })]))).toEqual([["zoe", "works on OTHER, ms01"]]);
  });
});
