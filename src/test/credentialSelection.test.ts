import { describe, it, expect } from "vitest";
import { defaultCredentialId, dockTabs, resolveSelection } from "../features/credentials/selection";
import { att, byHost, cred, hostWith, NT, user } from "./engines/credentials/fixtures";

const smb = hostWith("h1", "10.0.0.5", [445]);
const ctx = { hosts: [smb.host], servicesByHost: byHost(smb), attempts: [] };
const bare = { hosts: [], servicesByHost: new Map(), attempts: [] };

describe("credential selection", () => {
  it("defaultCredentialId prefers the newest sprayable with commands", () => {
    const old = cred({ id: "old", createdAt: 1 });
    const newer = cred({ id: "newer", createdAt: 5 });
    const ticket = cred({ id: "t", type: "ticket", createdAt: 9 });
    expect(defaultCredentialId([old, newer, ticket], ctx)).toBe("newer");
    // the newest was already tried in both modes everywhere, so nothing is left to run; the older one wins
    const done = (authMode: "domain" | "local") => att({ credId: "newer", hostId: "h1", service: "smb", authMode, result: "failed" });
    const tested = { ...ctx, attempts: [done("domain"), done("local")] };
    expect(defaultCredentialId([old, newer], tested)).toBe("old");
  });

  it("falls back to newest sprayable, then newest of any kind, then undefined", () => {
    const a = cred({ id: "a", createdAt: 1 });
    const b = cred({ id: "b", createdAt: 2 });
    expect(defaultCredentialId([a, b], bare)).toBe("b");
    const t1 = cred({ id: "t1", type: "ticket", createdAt: 1 });
    const t2 = cred({ id: "t2", type: "ticket", createdAt: 3 });
    expect(defaultCredentialId([t1, t2], bare)).toBe("t2");
    expect(defaultCredentialId([], bare)).toBeUndefined();
  });

  it("resolveSelection keeps a known id and replaces an unknown or deleted one", () => {
    const a = cred({ id: "a", createdAt: 1 });
    const b = cred({ id: "b", createdAt: 2 });
    expect(resolveSelection("a", [a, b], bare)).toBe("a");
    expect(resolveSelection("gone", [a, b], bare)).toBe("b");
    expect(resolveSelection(null, [a, b], bare)).toBe("b");
    expect(resolveSelection("a", [], bare)).toBeUndefined();
  });

  it("an uncracked NTLM hash gets crack first, then test tabs", () => {
    const h = cred({ type: "hash", secret: NT, hashType: "NTLM" });
    expect(dockTabs(h, { ...ctx, usernames: [] }).slice(0, 3)).toEqual(["crack", "test", "shares"]);
  });

  it("an uncrackable hash puts crack last", () => {
    const h = cred({ type: "hash", secret: NT, hashType: "NTLM", crackStatus: "uncrackable" });
    expect(dockTabs(h, { ...ctx, usernames: [] })).toEqual(["crack"]);
    const mixed = dockTabs(cred({ type: "hash", secret: NT, hashType: "NTLM", crackStatus: "uncrackable" }), { ...ctx, usernames: [user("u1", "x")] });
    expect(mixed[mixed.length - 1]).toBe("crack");
  });

  it("a machine-account hash gets no crack", () => {
    const h = cred({ type: "hash", username: "DC01$", secret: NT, hashType: "NTLM" });
    expect(dockTabs(h, { ...ctx, usernames: [] })).toEqual([]);
  });

  it("a ticket gets no tabs", () => {
    expect(dockTabs(cred({ type: "ticket" }), { ...ctx, usernames: [] })).toEqual([]);
  });

  it("roast only when it applies", () => {
    const ldap = hostWith("h2", "10.0.0.6", [445, 389]);
    const withLdap = { hosts: [ldap.host], servicesByHost: byHost(ldap), usernames: [] };
    expect(dockTabs(cred(), withLdap)).toEqual(["test", "shares", "roast"]);
    expect(dockTabs(cred(), { ...ctx, usernames: [] })).toEqual(["test", "shares"]);
    expect(dockTabs(cred(), { ...ctx, usernames: [user("u1", "x")] })).toEqual(["test", "shares", "spray"]);
  });
});
