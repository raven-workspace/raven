import { describe, expect, it } from "vitest";
import { identityBlocksOf, isIdentityBlockFor, isIdentityEntryFor, parseIdentity, usableIdentity } from "../../../engines/facts";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";

const flag = (proof: string | null, ranOn: string | null, over: Partial<LogEntry> = {}): LogEntry => ({
  id: "f1", engagementId: "e1", kind: "flag", title: "proof", titleEdited: false, ranOn, hostIds: ["h1"], observations: null,
  returnedNothing: false, private: false, content: { kind: "flag", flagKind: "proof", value: "x", proof }, at: 1, createdAt: 1, updatedAt: 1, ...over,
});

const SRV11_PROOF = "# id\nuid=0(root) gid=0(root) groups=0(root)\n# cat /root/proof.txt\n44444444444444444444444444444444";
const SRV11 = { id: "h1", name: "Srv11", os: "linux" } as Host;
const SRV13 = { id: "h1", name: "Srv13", os: "windows" } as Host;

/** Usernames the entry's eligible blocks yield for the host. */
function usernames(entry: LogEntry, host: Host): string[] {
  return identityBlocksOf(entry).flatMap((b) => (isIdentityBlockFor(entry, host, b) ? [usableIdentity(b)?.username ?? ""] : [])).filter(Boolean);
}

describe("flag proof as a transcript", () => {
  it("Srv11 shape: bare `# ` root prompt, Ran on = host name, yields root", () => {
    expect(usernames(flag(SRV11_PROOF, "Srv11"), SRV11)).toEqual(["root"]);
  });

  it("a bare `# ` prompt is an ordinary sh prompt, not a target shell: Ran on Kali (VM) rejects bare id", () => {
    expect(usernames(flag(SRV11_PROOF, "Kali (VM)"), SRV11)).toEqual([]);
  });

  it("proof null contributes nothing and is not an identity entry", () => {
    const e = flag(null, "Srv11");
    expect(identityBlocksOf(e)).toEqual([]);
    expect(isIdentityEntryFor(e, SRV11)).toBe(false);
    expect(isIdentityEntryFor(flag("", "Srv11"), SRV11)).toBe(false);
  });

  it("still requires exactly one linked host", () => {
    expect(isIdentityEntryFor(flag(SRV11_PROOF, "Srv11", { hostIds: ["h1", "h2"] }), SRV11)).toBe(false);
    expect(isIdentityEntryFor(flag(SRV11_PROOF, "Srv11"), SRV11)).toBe(true);
  });

  it("Windows cmd chain in a proof yields the administrator", () => {
    const proof = "C:\\Users\\jay\\Desktop> whoami & hostname & ipconfig\nsrv13\\administrator\nSRV13\n\nWindows IP Configuration";
    expect(usernames(flag(proof, "Kali (VM)"), SRV13)).toEqual(["srv13\\administrator"]);
  });
});

describe("parseIdentity on chains led by whoami / id", () => {
  it("whoami & hostname & ipconfig reads the first output line", () => {
    expect(parseIdentity("C:\\Users\\jay\\Desktop> whoami & hostname & ipconfig", "srv13\\administrator\nSRV13\n...")).toEqual({
      username: "srv13\\administrator", privileges: [], groups: [],
    });
  });
  it("whoami; hostname; ip a; cat proof.txt", () => {
    expect(parseIdentity("whoami; hostname; ip a; cat proof.txt", "root\nSrv11\n...")?.username).toBe("root");
  });
  it("id; cat /root/proof.txt reads the uid= line", () => {
    const r = parseIdentity("id; cat /root/proof.txt", "uid=0(root) gid=0(root) groups=0(root),27(sudo)\nabc");
    expect(r).toEqual({ username: "root", privileges: [], groups: ["root", "sudo"] });
  });
  it("&& separator with loose spacing", () => {
    expect(parseIdentity("whoami&&hostname", "bob\nbox")?.username).toBe("bob");
  });
  it("pipes still return null", () => {
    expect(parseIdentity("whoami | findstr x", "x")).toBeNull();
    expect(parseIdentity("whoami & hostname | findstr x", "x")).toBeNull();
  });
  it("a chain not led by bare whoami/id returns null", () => {
    expect(parseIdentity("hostname & whoami", "SRV13\nroot")).toBeNull();
    expect(parseIdentity("whoami /priv & hostname", "x")).toBeNull();
  });
  it("error output is still rejected", () => {
    expect(usableIdentity({ command: "whoami & hostname", output: "'whoami' is not recognized as an internal or external command" })).toBeNull();
  });
});

describe("Kali shell blocks", () => {
  const KALI_HDR = "┌──(kali㉿kali)-[~]\n└─# ";
  it("a root prompt under a Kali header with Ran on blank yields no identity", () => {
    const e = flag(`${KALI_HDR}id\nuid=0(root) gid=0(root) groups=0(root)\n${KALI_HDR}cat /root/proof.txt\n44444444444444444444444444444444`, "");
    expect(identityBlocksOf(e).some((b) => b.shell === "kali@kali")).toBe(true);
    expect(usernames(e, SRV11)).toEqual([]);
  });
  it("Windows-only whoami /all under a Kali shell is rejected too", () => {
    const out = "USER INFORMATION\n----------------\n\nUser Name  SID\n========== ====\nsrv13\\administrator S-1-5-21";
    const e = flag(`${KALI_HDR}whoami /all\n${out}`, "");
    expect(usernames(e, SRV13)).toEqual([]);
  });
  it("identityBlocksOf does not mutate a deep-frozen flag entry", () => {
    const e = flag(SRV11_PROOF, "Srv11");
    Object.freeze(e.content);
    Object.freeze(e);
    expect(() => identityBlocksOf(e)).not.toThrow();
    expect(e.content.kind === "flag" && e.content.proof).toBe(SRV11_PROOF);
  });
  it("a cat'ed file with a literal `# whoami` line is read as a prompt: its following text becomes whoami output (current behaviour)", () => {
    const proof = "# cat notes.txt\n# whoami\nnot-a-user\n# cat /root/proof.txt\n44444444444444444444444444444444";
    expect(usernames(flag(proof, "Srv11"), SRV11)).toEqual(["not-a-user"]);
  });
});
