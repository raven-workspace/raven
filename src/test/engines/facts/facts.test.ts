import { describe, expect, it } from "vitest";
import {
  effectiveVerdict,
  foldServices,
  isIdentityBlockFor,
  parseIdentity,
  phaseOf,
  serviceIdentity,
  sortServices,
  vectorsFromIdentity,
} from "../../../engines/facts";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";

function svc(over: Partial<Service>): Service {
  return {
    id: `s${over.port}${over.protocol ?? "tcp"}`,
    hostId: "h1",
    port: 80,
    protocol: "tcp",
    state: "open",
    nmapService: "http",
    nmapVersion: null,
    confirmedProduct: null,
    confirmedVersion: null,
    confirmedEntryId: null,
    verdict: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const PRIV = `
PRIVILEGES INFORMATION
----------------------

Privilege Name                Description                               State
============================= ========================================= ========
SeAssignPrimaryTokenPrivilege Replace a process level token             Disabled
SeIncreaseQuotaPrivilege      Adjust memory quotas for a process        Disabled
SeImpersonatePrivilege        Impersonate a client after authentication Enabled
SeCreateGlobalPrivilege       Create global objects                     Enabled
`;
const GROUPS = `
GROUP INFORMATION
-----------------

Group Name                             Type             SID          Attributes
====================================== ================ ============ ==================================================
Everyone                               Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group
BUILTIN\\Users                          Alias            S-1-5-32-545 Mandatory group, Enabled by default, Enabled group
`;
const GROUPS_TABLE = GROUPS.replace("GROUP INFORMATION\n-----------------\n\n", "");
const ALL = `
USER INFORMATION
----------------

User Name        SID
================ ============================================
iis apppool\\web  S-1-5-82-2971860391-1388105351
${GROUPS}
${PRIV}`;

describe("phaseOf", () => {
  it("phase follows access, not board column", () => {
    const host = { access: "none" as const, column: "privilege-escalation" };
    expect(phaseOf(host)).toBe("before");
    expect(phaseOf({ access: "user" })).toBe("after");
    expect(phaseOf({ access: "root" })).toBe("after");
  });
});

describe("serviceIdentity / effectiveVerdict", () => {
  it("prefers confirmed product", () => {
    const s = svc({ nmapService: "http", nmapVersion: "Apache", confirmedProduct: "nginx", confirmedVersion: "1.18" });
    expect(serviceIdentity(s)).toEqual({ label: "nginx 1.18", confirmed: true, unidentified: false });
  });
  it("flags unidentified services", () => {
    for (const n of [null, "unknown", "tcpwrapped?"]) {
      expect(serviceIdentity(svc({ nmapService: n })).unidentified).toBe(true);
    }
    expect(effectiveVerdict(svc({ nmapService: null }))).toBe("identify");
    expect(effectiveVerdict(svc({ nmapService: null, verdict: "dead_end" }))).toBe("dead_end");
    expect(effectiveVerdict(svc({}))).toBe("untested");
  });
});

describe("foldServices", () => {
  it("folds msrpc 4966x and UDP", () => {
    const rpcs = Array.from({ length: 7 }, (_, i) => svc({ port: 49664 + i, nmapService: "msrpc" }));
    const udps = Array.from({ length: 17 }, (_, i) => svc({ port: 100 + i, protocol: "udp" }));
    const keep = [
      svc({ port: 135, nmapService: "msrpc" }),
      svc({ port: 49670, nmapService: "msrpc", verdict: "dead_end" }),
      svc({ port: 53, protocol: "udp", verdict: "candidate" }),
      svc({ port: 445 }),
    ];
    const r = foldServices([...rpcs, ...udps, ...keep]);
    expect(r.rpc).toHaveLength(7);
    expect(r.udp).toHaveLength(17);
    expect(r.rows).toHaveLength(4);
  });
});

describe("sortServices", () => {
  it("orders candidate, identify, untested, dead_end, then port", () => {
    const out = sortServices([
      svc({ port: 22, verdict: "dead_end" }),
      svc({ port: 80 }),
      svc({ port: 9999, nmapService: null }),
      svc({ port: 8080, verdict: "candidate" }),
      svc({ port: 21, verdict: "candidate" }),
      svc({ port: 25 }),
    ]);
    expect(out.map((s) => s.port)).toEqual([21, 8080, 9999, 25, 80, 22]);
  });
});

describe("parseIdentity", () => {
  it("whoami", () => {
    expect(parseIdentity("whoami", "corp\\svc_sql\r\n")).toEqual({ username: "corp\\svc_sql", privileges: [], groups: [] });
  });
  it("whoami /priv lists enabled and disabled", () => {
    const r = parseIdentity("whoami /priv", PRIV);
    expect(r?.privileges).toEqual(["SeAssignPrimaryTokenPrivilege", "SeIncreaseQuotaPrivilege", "SeImpersonatePrivilege", "SeCreateGlobalPrivilege"]);
    expect(r?.username).toBeUndefined();
  });
  it("whoami /groups", () => {
    expect(parseIdentity("whoami /groups", GROUPS_TABLE)?.groups).toEqual(["Everyone", "BUILTIN\\Users"]);
  });
  it("whoami /all", () => {
    const r = parseIdentity("whoami /all", ALL);
    expect(r?.username).toBe("iis apppool\\web");
    expect(r?.groups).toEqual(["Everyone", "BUILTIN\\Users"]);
    expect(r?.privileges).toContain("SeImpersonatePrivilege");
  });
  it("id", () => {
    const r = parseIdentity("id", "uid=1001(tom) gid=1001(tom) groups=1001(tom),27(sudo),999(docker)\n");
    expect(r).toEqual({ username: "tom", privileges: [], groups: ["tom", "sudo", "docker"] });
  });
  it("returns null for other commands", () => {
    expect(parseIdentity("ls -la", "total 0\ndrwxr-xr-x 2 tom tom 40 .")).toBeNull();
  });
});

describe("parseIdentity prompts and filters", () => {
  it("tolerates a leading PowerShell, Evil-WinRM or cmd prompt in the command text", () => {
    const out = "Privilege Name  Description  State\n=== === ===\nSeDebugPrivilege  Debug programs  Enabled";
    for (const prefix of ["PS C:\\WINDOWS\\system32> ", "*Evil-WinRM* PS C:\\Users\\x\\Documents> ", "C:\\Windows\\system32>"]) {
      expect(parseIdentity(`${prefix}whoami /priv`, out)?.privileges).toEqual(["SeDebugPrivilege"]);
    }
  });
  it("returns null for piped or filtered commands", () => {
    expect(parseIdentity('whoami /groups | findstr /i "High"', "Mandatory Label\\High Mandatory Level  Label  S-1-16-12288")).toBeNull();
    expect(parseIdentity('PS C:\\WINDOWS\\system32> whoami /groups | findstr /i "High"', "x")).toBeNull();
  });
});

describe("isIdentityBlockFor", () => {
  const win = { id: "h1", name: "Onyx", os: "windows" } as Host;
  const unknownOs = { id: "h1", name: "Onyx", os: null } as Host;
  const lin = { id: "h1", name: "web01", os: "linux" } as Host;
  const e = (ranOn: string, hostIds = ["h1"]) => ({ kind: "command", hostIds, ranOn, content: { kind: "command", blocks: [] } }) as unknown as LogEntry;
  it("accepts Windows-only forms whatever Ran on says, on a windows or unknown-OS host", () => {
    expect(isIdentityBlockFor(e("Kali (VM)"), win, { command: "whoami /all", output: "" })).toBe(true);
    expect(isIdentityBlockFor(e("Kali (VM)"), unknownOs, { command: "whoami /priv", output: "" })).toBe(true);
    expect(isIdentityBlockFor(e("Kali (VM)"), lin, { command: "whoami /all", output: "" })).toBe(false);
  });
  it("accepts a block from a target-side shell", () => {
    expect(isIdentityBlockFor(e("Kali (VM)"), win, { command: "whoami", output: "", shell: "evil-winrm" })).toBe(true);
    expect(isIdentityBlockFor(e("Kali (VM)"), win, { command: "*Evil-WinRM* PS C:\\Users\\x> whoami", output: "" })).toBe(true);
  });
  it("bare whoami/id depend on Ran on", () => {
    expect(isIdentityBlockFor(e("Kali (VM)"), win, { command: "whoami", output: "" })).toBe(false);
    expect(isIdentityBlockFor(e(""), win, { command: "whoami", output: "" })).toBe(true);
    expect(isIdentityBlockFor(e("Onyx"), win, { command: "whoami", output: "" })).toBe(true);
    expect(isIdentityBlockFor(e("web01"), win, { command: "id", output: "" })).toBe(false);
  });
  it("needs exactly this one host", () => {
    expect(isIdentityBlockFor(e("", ["h1", "h2"]), win, { command: "whoami /all", output: "" })).toBe(false);
  });
});

describe("vectorsFromIdentity", () => {
  it("maps privileges and groups to titles", () => {
    expect(vectorsFromIdentity({ privileges: ["SeImpersonatePrivilege", "SeChangeNotifyPrivilege"], groups: [] })).toEqual(["SeImpersonatePrivilege abuse"]);
    expect(vectorsFromIdentity({ privileges: [], groups: ["tom", "sudo", "docker"] })).toEqual(["sudo group", "docker group"]);
  });
});
