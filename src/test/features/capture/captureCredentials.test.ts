import { describe, expect, it } from "vitest";
import { credentialsInPaste } from "../../../engines/capture";
import { resolveCapture } from "../../../features/capture/resolve";
import { EMPTY_DRAFT, type PanelDraft } from "../../../features/capture/useCaptureStore";
import type { Host } from "../../../types/host";

const NT = "0123456789abcdef0123456789abcdef";

const WEB: Host = {
  id: "h1", engagementId: "e1", name: "web01", ip: "192.0.2.10", os: null, boardColumn: "initial-foothold",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "none", createdAt: 1, updatedAt: 1,
};

const DC: Host = { ...WEB, id: "h2", name: "dc01.corp.example.test", ip: "192.0.2.5" };

const resolve = (text: string, over: Partial<PanelDraft> = {}, hosts: Host[] = [WEB]) =>
  resolveCapture({ ...EMPTY_DRAFT, text, ...over }, {
    hosts, scope: [], domain: "", machines: [], lastRanOn: null, presetHostId: "h1",
  });

describe("credentialsInPaste", () => {
  it("reads user:pass", () => {
    expect(credentialsInPaste("admin:Summer2026!")).toEqual([{ username: "admin", domain: null, secret: "Summer2026!", type: "password" }]);
  });

  it("reads DOMAIN\\user:pass with its domain", () => {
    expect(credentialsInPaste("CORP\\svc_sql:P@ss")).toEqual([{ username: "svc_sql", domain: "CORP", secret: "P@ss", type: "password" }]);
  });

  it("reads user:<32 hex> as a hash", () => {
    expect(credentialsInPaste(`jdoe:${NT}`)).toEqual([{ username: "jdoe", domain: null, secret: NT, type: "hash" }]);
  });

  it("reads an account named like a service, which is no command line", () => {
    expect(credentialsInPaste("ftp:ftp")).toHaveLength(1);
  });

  it("reads .\\user:pass as a local account, with no domain", () => {
    expect(credentialsInPaste(".\\Administrator:Passw0rd!")).toEqual([
      { username: "Administrator", domain: null, secret: "Passw0rd!", type: "password", local: true },
    ]);
  });

  it("reads an all-digit password unless the name is a known host's", () => {
    expect(credentialsInPaste("admin:1234", ["web01", "192.0.2.10"])).toEqual([{ username: "admin", domain: null, secret: "1234", type: "password" }]);
    expect(credentialsInPaste("web01:8080", ["web01", "192.0.2.10"])).toEqual([]);
    expect(credentialsInPaste("WEB01:8080", ["web01"])).toEqual([]);
    expect(credentialsInPaste("198.51.100.20:445")).toEqual([]);
  });

  it("reads each line of a multi-line paste", () => {
    expect(credentialsInPaste("admin:Summer2026!\r\n\nCORP\\svc_sql:P@ss\n")).toHaveLength(2);
  });

  it.each([
    ["a URL", "http://192.0.2.10:8080"],
    ["a command with a URL", "curl http://192.0.2.10:8080"],
    ["an IP and port", "198.51.100.20:445"],
    ["a host name and port", "files.example.test:8080"],
    ["an ssh-style target", "kali@192.0.2.10:22"],
    ["a command line", "echo admin:Summer2026!"],
    ["a command word and its target", "ssh admin@192.0.2.10:2222"],
    ["a pipe", "admin:x | nc 192.0.2.10 4444"],
    ["shell syntax in the account", "ls;id:Summer2026!"],
    ["a variable assignment", "PATH=/usr/bin:/bin"],
    ["a command substitution", "admin:$(id)"],
    ["a shell prompt", "kali@kali:~$ whoami"],
    ["a sentence", "Note: try this later"],
    ["a mix of credentials and text", "admin:Summer2026!\nworked on the web login"],
    ["nothing", "  \n "],
  ])("never offers %s", (_what, text) => {
    expect(credentialsInPaste(text)).toEqual([]);
  });
});

describe("resolveCapture with pasted credentials", () => {
  it("offers admin:Summer2026! for the linked host and adds it on save", () => {
    const r = resolve("admin:Summer2026!");
    expect(r.edits.kind).toBe("note");
    expect(r.credentials).toHaveLength(1);
    expect(r.credentialsLine).toBe("Adds 1 credential for web01: admin.");
    expect(r.edits.credentials).toEqual([{ username: "admin", domain: null, secret: "Summer2026!", type: "password", hostId: "h1" }]);
    // The secret stays out of the title.
    expect(r.autoTitle).toBe("Credential for admin");
  });

  it("offers every line, with its domain", () => {
    const r = resolve("admin:Summer2026!\nCORP\\svc_sql:P@ss");
    expect(r.credentialsLine).toBe("Adds 2 credentials for web01: admin, CORP\\svc_sql.");
    expect(r.edits.credentials?.map((c) => [c.domain, c.username, c.hostId])).toEqual([[null, "admin", "h1"], ["CORP", "svc_sql", "h1"]]);
  });

  it("save as note keeps today's behaviour: a note, no credentials", () => {
    const r = resolve("admin:Summer2026!", { asNote: true });
    expect(r.credentials).toHaveLength(1);
    expect(r.credentialsLine).toBeNull();
    expect(r.edits.credentials).toBeUndefined();
    expect(r.edits.content).toEqual({ kind: "note", text: "admin:Summer2026!" });
    expect(r.autoTitle).toBe("admin:Summer2026!");
  });

  it("offers nothing for a command, or a host and port", () => {
    for (const text of ["curl http://192.0.2.10:8080", "198.51.100.20:445"]) {
      const r = resolve(text);
      expect(r.credentials).toEqual([]);
      expect(r.edits.credentials).toBeUndefined();
    }
  });

  it("with several linked hosts, the credential goes to the first and the line names it", () => {
    const r = resolve("admin:Summer2026!", { hostIds: ["h2", "h1"] }, [WEB, DC]);
    expect(r.credentialsLine).toBe("Adds 1 credential for dc01.corp.example.test: admin.");
    expect(r.edits.credentials?.[0]?.hostId).toBe("h2");
  });

  it("a known host's name (full, short or IP) followed by digits is host:port; admin:1234 is a credential", () => {
    for (const text of ["dc01:445", "dc01.corp.example.test:445", "web01:8080"]) expect(resolve(text, {}, [WEB, DC]).credentials).toEqual([]);
    expect(resolve("admin:1234", {}, [WEB, DC]).edits.credentials).toHaveLength(1);
  });

  it(".\\Administrator is offered local to the host; with no host linked it is not added", () => {
    const r = resolve(".\\Administrator:Passw0rd!");
    expect(r.credentialsLine).toBe("Adds 1 credential for web01: .\\Administrator.");
    expect(r.edits.credentials).toEqual([{ username: "Administrator", domain: null, secret: "Passw0rd!", type: "password", local: true, hostId: "h1" }]);
    const none = resolve(".\\Administrator:Passw0rd!", { hostIds: [] });
    expect(none.credentials).toHaveLength(1);
    expect(none.edits.credentials).toBeUndefined();
  });

  it("offers nothing once another kind is picked", () => {
    expect(resolve("admin:Summer2026!", { kind: "command" }).edits.credentials).toBeUndefined();
  });
});
