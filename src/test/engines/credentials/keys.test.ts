import { describe, it, expect } from "vitest";
import { attemptKey, credKey, defaultHashType, findDuplicateCredential, usernameKey } from "../../../engines/credentials/keys";
import { att, cred, NT, user } from "./fixtures";

describe("credKey", () => {
  it("hash secrets compare case-insensitively, passwords case-sensitively", () => {
    const h = (secret: string) => cred({ type: "hash", secret, hashType: "NTLM" });
    expect(credKey(h(NT.toUpperCase()))).toBe(credKey(h(NT)));
    expect(credKey(cred({ secret: "Pw" }))).not.toBe(credKey(cred({ secret: "pw" })));
  });

  it("secrets keep spaces; only leading and trailing line breaks are ignored (F-R1)", () => {
    expect(credKey(cred({ secret: "pass\r\n" }))).toBe(credKey(cred({ secret: "pass" })));
    expect(credKey(cred({ secret: " pass " }))).not.toBe(credKey(cred({ secret: "pass" })));
    expect(findDuplicateCredential([cred({ id: "a", secret: "pass" })], cred({ id: "b", secret: "\npass\n" }))?.id).toBe("a");
    expect(findDuplicateCredential([cred({ id: "a", secret: "pass" })], cred({ id: "b", secret: " pass" }))).toBeUndefined();
  });

  it("captured hashes key on account and kind, not on the capture text", () => {
    const t = (tail: string) => cred({ type: "hash", username: "svc", secret: `$krb5tgs$23$*svc$R$x/y*$${tail}` });
    expect(credKey(t("aa$bb"))).toBe(credKey(t("cc$dd")));
    expect(credKey(t("aa$bb"))).toContain("capture:krb5tgs");
    const a = (tail: string) => cred({ type: "hash", username: "svc", secret: `$krb5asrep$23$svc@R:${tail}` });
    expect(credKey(a("aa$bb"))).toBe(credKey(a("cc$dd")));
    expect(credKey(a("aa$bb"))).not.toBe(credKey(t("aa$bb")));
    const n = (resp: string) => cred({ type: "hash", username: "svc", hashType: "NetNTLMv2", secret: `svc::D:1122334455667788:${resp}:0101` });
    expect(credKey(n("aa"))).toBe(credKey(n("bb")));
    expect(credKey(n("aa"))).toContain("capture:netntlm");
  });
});

describe("usernameKey and attemptKey", () => {
  it("usernameKey is engagement + case-insensitive username + domain", () => {
    expect(usernameKey({ engagementId: "e", username: " Alice ", domain: "CORP" })).toBe("e|alice|corp");
    expect(usernameKey(user("u", "bob"))).toBe("eng1|bob|");
  });

  it("attemptKey identifies cred, username, host, service and mode", () => {
    const a = att({ credId: "c", usernameId: "u", hostId: "h", service: "smb", authMode: "local" });
    expect(attemptKey(a)).toBe("c|u|h|smb|local");
    expect(attemptKey(a)).not.toBe(attemptKey({ ...a, authMode: "domain" }));
    expect(attemptKey(a)).not.toBe(attemptKey({ ...a, usernameId: null }));
  });
});

describe("findDuplicateCredential", () => {
  it("matches by id, or by key within the same engagement and local host", () => {
    const a = cred({ id: "a", secret: "pw" });
    expect(findDuplicateCredential([a], cred({ id: "a", secret: "other" }))?.id).toBe("a");
    expect(findDuplicateCredential([a], cred({ id: "b", secret: "pw" }))?.id).toBe("a");
    expect(findDuplicateCredential([a], cred({ id: "b", engagementId: "eng2" }))).toBeUndefined();
    const loc = cred({ id: "l", scope: "local", localHostId: "h1" });
    expect(findDuplicateCredential([loc], cred({ id: "m", scope: "local", localHostId: "h2" }))).toBeUndefined();
    expect(findDuplicateCredential([loc], cred({ id: "m", scope: "local", localHostId: "h1" }))?.id).toBe("l");
  });

  it("never merges empty secrets by key", () => {
    expect(findDuplicateCredential([cred({ id: "a", secret: "" })], cred({ id: "b", secret: "" }))).toBeUndefined();
  });
});

describe("defaultHashType", () => {
  // Pins the two cases src-tauri/src/credentials.rs derive_hash_type also handles.
  it("agrees with the Rust derive_hash_type: 32 hex is NTLM, LM:NT is pwdump", () => {
    expect(defaultHashType(NT)).toBe("NTLM");
    expect(defaultHashType(NT.toUpperCase())).toBe("NTLM");
    expect(defaultHashType(`aad3b435b51404eeaad3b435b51404ee:${NT}`)).toBe("pwdump (LM:NT)");
  });

  it("falls back to the top identifyHash candidate elsewhere, and undefined when unknown", () => {
    expect(defaultHashType("$6$52450745$k5ka2p8bFuSmoVT1tzOyyuaREkkKBcCNqoDKzYiJL9RaE8yMnPgh2XzzF0NDrUhgrcLwg78xs1w5pJiypEdFX/")).toBe("sha512crypt");
    expect(defaultHashType("not a hash")).toBeUndefined();
  });
});
