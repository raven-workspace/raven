import { describe, expect, it } from "vitest";
import { identityBlocksOf, isIdentityBlockFor, isIdentityEntryFor, parseIdentity, usableIdentity } from "../../../engines/facts";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";

const flag = (proof: string | null, ranOn: string | null, over: Partial<LogEntry> = {}): LogEntry => ({
  id: "f1", engagementId: "e1", kind: "flag", title: "proof", titleEdited: false, ranOn, hostIds: ["h1"], observations: null,
  returnedNothing: false, private: false, content: { kind: "flag", flagKind: "proof", value: "x", proof }, at: 1, createdAt: 1, updatedAt: 1, ...over,
});

const AERO_PROOF = "# id\nuid=0(root) gid=0(root) groups=0(root)\n# cat /root/proof.txt\n918eef4c77a6e2903e0a3f4ff8554182";
const VEGA = { id: "h1", name: "Vega", os: "linux" } as Host;
const ONYX = { id: "h1", name: "Onyx", os: "windows" } as Host;

/** Usernames the entry's eligible blocks yield for the host. */
function usernames(entry: LogEntry, host: Host): string[] {
  return identityBlocksOf(entry).flatMap((b) => (isIdentityBlockFor(entry, host, b) ? [usableIdentity(b)?.username ?? ""] : [])).filter(Boolean);
}

describe("flag proof as a transcript", () => {
  it("Vega shape: bare `# ` root prompt, Ran on = host name, yields root", () => {
    expect(usernames(flag(AERO_PROOF, "Vega"), VEGA)).toEqual(["root"]);
  });

  it("a bare `# ` prompt is an ordinary sh prompt, not a target shell: Ran on Kali (VM) rejects bare id", () => {
    expect(usernames(flag(AERO_PROOF, "Kali (VM)"), VEGA)).toEqual([]);
  });

  it("proof null contributes nothing and is not an identity entry", () => {
    const e = flag(null, "Vega");
    expect(identityBlocksOf(e)).toEqual([]);
    expect(isIdentityEntryFor(e, VEGA)).toBe(false);
    expect(isIdentityEntryFor(flag("", "Vega"), VEGA)).toBe(false);
  });

  it("still requires exactly one linked host", () => {
    expect(isIdentityEntryFor(flag(AERO_PROOF, "Vega", { hostIds: ["h1", "h2"] }), VEGA)).toBe(false);
    expect(isIdentityEntryFor(flag(AERO_PROOF, "Vega"), VEGA)).toBe(true);
  });

  it("Windows cmd chain in a proof yields the administrator", () => {
    const proof = "C:\\Users\\offsec\\Desktop> whoami & hostname & ipconfig\nonyx\\administrator\nONYX\n\nWindows IP Configuration";
    expect(usernames(flag(proof, "Kali (VM)"), ONYX)).toEqual(["onyx\\administrator"]);
  });
});

describe("parseIdentity on chains led by whoami / id", () => {
  it("whoami & hostname & ipconfig reads the first output line", () => {
    expect(parseIdentity("C:\\Users\\offsec\\Desktop> whoami & hostname & ipconfig", "onyx\\administrator\nONYX\n...")).toEqual({
      username: "onyx\\administrator", privileges: [], groups: [],
    });
  });
  it("whoami; hostname; ip a; cat proof.txt", () => {
    expect(parseIdentity("whoami; hostname; ip a; cat proof.txt", "root\nVega\n...")?.username).toBe("root");
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
    expect(parseIdentity("hostname & whoami", "ONYX\nroot")).toBeNull();
    expect(parseIdentity("whoami /priv & hostname", "x")).toBeNull();
  });
  it("error output is still rejected", () => {
    expect(usableIdentity({ command: "whoami & hostname", output: "'whoami' is not recognized as an internal or external command" })).toBeNull();
  });
});

describe("Kali shell blocks", () => {
  const KALI_HDR = "┌──(kali㉿kali)-[~]\n└─# ";
  it("a root prompt under a Kali header with Ran on blank yields no identity", () => {
    const e = flag(`${KALI_HDR}id\nuid=0(root) gid=0(root) groups=0(root)\n${KALI_HDR}cat /root/proof.txt\n918eef4c77a6e2903e0a3f4ff8554182`, "");
    expect(identityBlocksOf(e).some((b) => b.shell === "kali@kali")).toBe(true);
    expect(usernames(e, VEGA)).toEqual([]);
  });
  it("Windows-only whoami /all under a Kali shell is rejected too", () => {
    const out = "USER INFORMATION\n----------------\n\nUser Name  SID\n========== ====\nonyx\\administrator S-1-5-21";
    const e = flag(`${KALI_HDR}whoami /all\n${out}`, "");
    expect(usernames(e, ONYX)).toEqual([]);
  });
  it("identityBlocksOf does not mutate a deep-frozen flag entry", () => {
    const e = flag(AERO_PROOF, "Vega");
    Object.freeze(e.content);
    Object.freeze(e);
    expect(() => identityBlocksOf(e)).not.toThrow();
    expect(e.content.kind === "flag" && e.content.proof).toBe(AERO_PROOF);
  });
  it("a cat'ed file with a literal `# whoami` line is read as a prompt: its following text becomes whoami output (current behaviour)", () => {
    const proof = "# cat notes.txt\n# whoami\nnot-a-user\n# cat /root/proof.txt\n918eef4c77a6e2903e0a3f4ff8554182";
    expect(usernames(flag(proof, "Vega"), VEGA)).toEqual(["not-a-user"]);
  });
});
