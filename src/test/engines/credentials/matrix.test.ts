import { describe, it, expect } from "vitest";
import {
  hostSprayServices, isSprayable, isNtlmHash, isOwnerless, isPlaceholderSecret, authModesFor, cellFor, overallState,
  foldCrackedHashes, dedupeHashCaptures, hashCaptureKind,
} from "../../../engines/credentials/matrix";
import { att, byHost, cred, host, NT, svc } from "./fixtures";

describe("credential matrix", () => {
  it("hostSprayServices reads open services by port and by nmap name", () => {
    const h = host("h1");
    expect(hostSprayServices(h, [svc("h1", 445), svc("h1", 5985), svc("h1", 22)])).toEqual(["smb", "winrm", "ssh"]);
    expect(hostSprayServices(h, [svc("h1", 8080, "ms-sql-s")])).toEqual(["mssql"]);
    expect(hostSprayServices(h, [svc("h1", 445, "", "closed")])).toEqual([]);
    expect(hostSprayServices(h, [])).toEqual([]);
  });

  it("a service the host doesn't run is na", () => {
    const h = host("h1");
    const s = [svc("h1", 445)];
    expect(cellFor(cred(), h, s, "ssh", []).state).toBe("na");
    expect(cellFor(cred(), h, s, "smb", []).state).toBe("untested");
  });

  it("a cell shows the stronger of its domain and local results and flags a difference", () => {
    const c = cellFor(cred(), host("h1"), [svc("h1", 445)], "smb", [
      att({ authMode: "domain", result: "failed" }),
      att({ authMode: "local", result: "admin" }),
    ]);
    expect(c.state).toBe("admin");
    expect(c.modesDiffer).toBe(true);
    expect(c.byMode.local?.result).toBe("admin");
  });

  it("errored-only cell reads errored, not failed; errors never downgrade", () => {
    const h = host("h1");
    const s = [svc("h1", 445)];
    expect(cellFor(cred(), h, s, "smb", [att({ result: "errored" })]).state).toBe("errored");
    const c = cellFor(cred(), h, s, "smb", [att({ result: "valid", at: 1 }), att({ result: "errored", at: 2 })]);
    expect(c.state).toBe("valid");
  });

  it("the latest non-errored result wins, compared numerically", () => {
    const c = cellFor(cred(), host("h1"), [svc("h1", 445)], "smb", [
      att({ result: "valid", at: 9 }), att({ result: "failed", at: 10 }),
    ]);
    expect(c.byMode.domain?.result).toBe("failed");
  });

  it("usernameId scopes attempts", () => {
    const h = host("h1");
    const s = [svc("h1", 445)];
    const a = [att({ result: "admin", usernameId: "u1" })];
    expect(cellFor(cred(), h, s, "smb", a).state).toBe("untested");
    expect(cellFor(cred(), h, s, "smb", a, "u1").state).toBe("admin");
    expect(cellFor(cred(), h, s, "smb", a, "u2").state).toBe("untested");
  });

  it("auth modes: domain password on smb is domain+local; on ssh local; NTLM hash on ssh none; local cred also tries domain", () => {
    const ntlm = cred({ type: "hash", secret: NT, hashType: "NTLM" });
    expect(authModesFor(cred(), "smb")).toEqual(["domain", "local"]);
    expect(authModesFor(cred({ scope: "local" }), "smb")).toEqual(["local", "domain"]);
    expect(authModesFor(cred({ scope: "local" }), "ssh")).toEqual(["local"]);
    expect(authModesFor(cred(), "ssh")).toEqual(["local"]);
    expect(authModesFor(ntlm, "ssh")).toEqual([]);
    expect(authModesFor(ntlm, "winrm")).toEqual(["domain", "local"]);
    expect(authModesFor(cred({ scope: "local" }), "ldap")).toEqual(["domain"]);
    expect(authModesFor(cred(), "ldap")).toEqual(["domain"]);
  });

  it("kerberoast and netntlm hashes are not sprayable until cracked; NTLM hash is", () => {
    expect(isSprayable(cred({ type: "hash", secret: NT, hashType: "NTLM" }))).toBe(true);
    // a 32-hex secret stored as 'MD5' is a legacy auto-identification and stays sprayable;
    // a deliberately chosen raw MD5 or any other type does not.
    expect(isSprayable(cred({ type: "hash", secret: NT, hashType: "MD5" }))).toBe(true);
    expect(isSprayable(cred({ type: "hash", secret: NT, hashType: "MD5 (raw)" }))).toBe(false);
    expect(isSprayable(cred({ type: "hash", secret: "aad3b435b51404eeaad3b435b51404ee:" + NT, hashType: "MD5" }))).toBe(false);
    expect(isSprayable(cred({ type: "hash", secret: "aad3b435b51404eeaad3b435b51404ee:" + NT }))).toBe(true);
    expect(isNtlmHash(cred({ type: "hash", secret: "aad3b435b51404eeaad3b435b51404ee:" + NT }))).toBe(true);
    expect(isSprayable(cred({ type: "hash", secret: "$krb5tgs$23$*x$y", hashType: "Kerberoast TGS-REP (etype 23, RC4)" }))).toBe(false);
    expect(isSprayable(cred({ type: "hash", secret: "a::b:c:d:e", hashType: "NetNTLMv2" }))).toBe(false);
    expect(isSprayable(cred({ type: "hash", secret: "$6$x$y", hashType: "sha512crypt" }))).toBe(false);
    expect(isSprayable(cred({ type: "ticket" }))).toBe(false);
    expect(isSprayable(cred({ type: "key" }))).toBe(false);
    expect(isSprayable(cred({ secret: "" }))).toBe(false);
    expect(isSprayable(cred({ crackStatus: "uncrackable" }))).toBe(false);
    expect(isSprayable(cred())).toBe(true);
  });

  it("overall state: admin anywhere > valid > untested where applicable > dead", () => {
    const h1 = host("h1");
    const h2 = host("h2");
    const sbh = byHost({ host: h1, services: [svc("h1", 445)] }, { host: h2, services: [svc("h2", 445)] });
    const f = (m: string, r: "failed" | "valid" | "admin", mode: "domain" | "local") => att({ hostId: m, result: r, authMode: mode });
    const allFailed = [f("h1", "failed", "domain"), f("h1", "failed", "local"), f("h2", "failed", "domain"), f("h2", "failed", "local")];
    expect(overallState(cred(), [h1, h2], sbh, allFailed)).toBe("dead");
    expect(overallState(cred(), [h1, h2], sbh, allFailed.slice(0, 3))).toBe("untested");
    expect(overallState(cred(), [h1, h2], sbh, [...allFailed, f("h2", "valid", "local")])).toBe("valid");
    expect(overallState(cred(), [h1, h2], sbh, [...allFailed, f("h2", "admin", "local")])).toBe("admin");
    expect(overallState(cred({ secret: "" }), [h1], sbh, [])).toBe("not-sprayable");
  });

  it("overall state: failed on ssh but untested on smb is untested, not dead", () => {
    const h = host("h1");
    const sbh = byHost({ host: h, services: [svc("h1", 445), svc("h1", 22)] });
    expect(overallState(cred(), [h], sbh, [att({ service: "ssh", authMode: "local", result: "failed" })])).toBe("untested");
  });

  it("overall state: failed domain plus errored local is untested, not dead", () => {
    const h = host("h1");
    const sbh = byHost({ host: h, services: [svc("h1", 445)] });
    expect(overallState(cred(), [h], sbh, [
      att({ authMode: "domain", result: "failed" }),
      att({ authMode: "local", result: "errored" }),
    ])).toBe("untested");
  });

  it("overall state: a host with no services entry contributes nothing", () => {
    expect(overallState(cred(), [host("h1")], new Map(), [])).toBe("untested");
  });

  it("a failed cell lists the applicable modes never tried (or only errored)", () => {
    const h = host("h1");
    const s = [svc("h1", 445)];
    const partial = cellFor(cred(), h, s, "smb", [att({ authMode: "domain", result: "failed" })]);
    expect(partial.state).toBe("failed");
    expect(partial.untriedModes).toEqual(["local"]);
    const erroredLocal = cellFor(cred(), h, s, "smb", [att({ authMode: "domain", result: "failed" }), att({ authMode: "local", result: "errored" })]);
    expect(erroredLocal.untriedModes).toEqual(["local"]);
    const both = cellFor(cred(), h, s, "smb", [att({ authMode: "domain", result: "failed" }), att({ authMode: "local", result: "failed" })]);
    expect(both.untriedModes).toEqual([]);
    // a local credential also owes a domain attempt
    expect(cellFor(cred({ scope: "local" }), h, s, "smb", [att({ authMode: "local", result: "failed" })]).untriedModes).toEqual(["domain"]);
    expect(cellFor(cred(), h, s, "smb", []).untriedModes).toEqual(["domain", "local"]);
  });

  it("isNtlmHash requires a hash credential (a 32-hex plaintext password is not a hash)", () => {
    expect(isNtlmHash(cred({ type: "hash", secret: NT }))).toBe(true);
    expect(isNtlmHash(cred({ type: "password", secret: NT }))).toBe(false);
    expect(isSprayable(cred({ type: "password", secret: NT }))).toBe(true);
  });
});

describe("a local credential tested as domain", () => {
  const ms01 = host("ms01");
  const s = [svc("ms01", 445, "microsoft-ds")];
  const mary = cred({ id: "mary", username: "jo.parker", scope: "local", localHostId: "ms01" });

  it("shows the recorded domain result in its cell", () => {
    const cell = cellFor(mary, ms01, s, "smb", [att({ credId: "mary", hostId: "ms01", result: "failed", authMode: "domain" })]);
    expect(cell.state).toBe("failed");
    expect(cell.byMode.domain?.result).toBe("failed");
    // local was never tried: the failure is partial, not dead
    expect(cell.untriedModes).toEqual(["local"]);
  });

  it("flags domain and local disagreeing", () => {
    const cell = cellFor(mary, ms01, s, "smb", [
      att({ credId: "mary", hostId: "ms01", result: "failed", authMode: "domain" }),
      att({ credId: "mary", hostId: "ms01", result: "admin", authMode: "local" }),
    ]);
    expect(cell.state).toBe("admin");
    expect(cell.modesDiffer).toBe(true);
  });

  it("with nothing recorded, both modes are untried (local first)", () => {
    expect(cellFor(mary, ms01, s, "smb", []).untriedModes).toEqual(["local", "domain"]);
  });
});

describe("foldCrackedHashes", () => {
  const hash = cred({ id: "hash1", type: "hash", secret: NT, hashType: "NTLM", crackStatus: "cracked" });
  const plain = cred({ id: "pw1", secret: "Summer1", crackedFrom: "hash1" });

  it("lists the plaintext once and gives it the hash results", () => {
    const other = cred({ id: "c9", username: "bob" });
    const a = att({ credId: "hash1", result: "admin" });
    const folded = foldCrackedHashes([hash, plain, other], [a]);
    expect(folded.creds.map((c) => c.id)).toEqual(["pw1", "c9"]);
    expect(folded.attempts).toEqual([{ ...a, credId: "pw1" }]);
  });

  it("keeps a cracked hash whose plaintext is not recorded", () => {
    const folded = foldCrackedHashes([hash], [att({ credId: "hash1" })]);
    expect(folded.creds.map((c) => c.id)).toEqual(["hash1"]);
    expect(folded.attempts[0].credId).toBe("hash1");
  });
});

describe("dedupeHashCaptures", () => {
  const tgs = (id: string, tail: string, extra = {}) =>
    cred({ id, type: "hash", username: "web_svc", domain: "MOCK.EXAM", hashType: "Kerberoast TGS-REP (etype 23, RC4)", secret: `$krb5tgs$23$*web_svc$MOCK.EXAM$mock.exam/web_svc*$${tail}`, ...extra });

  it("shows one capture per account, preferring the cracked one", () => {
    const list = [tgs("t1", "aa$bb"), tgs("t2", "cc$dd", { crackStatus: "cracked" }), cred({ id: "nt", type: "hash", secret: NT, hashType: "NTLM" })];
    expect(dedupeHashCaptures(list).map((c) => c.id)).toEqual(["t2", "nt"]);
  });

  it("keeps captures of different accounts and leaves NT hashes alone", () => {
    const other = tgs("t3", "ee$ff", { username: "sql_svc" });
    const nt2 = cred({ id: "nt2", type: "hash", secret: NT.replace("3", "4"), hashType: "NTLM" });
    const list = [tgs("t1", "aa$bb"), other, cred({ id: "nt", type: "hash", secret: NT, hashType: "NTLM" }), nt2];
    expect(dedupeHashCaptures(list).map((c) => c.id)).toEqual(["t1", "t3", "nt", "nt2"]);
  });

  it("hashCaptureKind names krb5tgs, krb5asrep and netntlm only", () => {
    expect(hashCaptureKind(cred({ type: "hash", secret: "$krb5asrep$23$u@R:aa$bb" }))).toBe("krb5asrep");
    expect(hashCaptureKind(cred({ type: "hash", secret: "admin::N46:08ca45b7d7ea58ee:88dc:5c78" }))).toBe("netntlm");
    expect(hashCaptureKind(cred({ type: "hash", secret: NT }))).toBeNull();
    expect(hashCaptureKind(cred({ type: "password", secret: "$krb5tgs$23$x" }))).toBeNull();
  });
});

describe("owner-less and placeholder secrets", () => {
  it("placeholder secrets are detected", () => {
    for (const s of ["none", " None ", "N/A", "-", ""]) expect(isPlaceholderSecret(cred({ username: "bob", secret: s }))).toBe(true);
    expect(isPlaceholderSecret(cred({ username: "bob", secret: "hunter2" }))).toBe(false);
    expect(isPlaceholderSecret(cred({ type: "hash", secret: "-" }))).toBe(false);
    expect(isOwnerless(cred({ username: "" }))).toBe(true);
    expect(isOwnerless(cred({ username: " bob " }))).toBe(false);
  });
});
