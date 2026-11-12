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
});

const entry = (id: string, command: string, extra: Partial<LogEntry> = {}) =>
  ({ id, kind: "command", hostIds: [H], private: false, content: { kind: "command", blocks: [{ command, output: "" }] }, ...extra }) as LogEntry;

describe("toolsUsed", () => {
  it("counts first tokens, skipping sudo and private entries", () => {
    const log = [
      entry("a", "nmap -sV 10.0.0.5"),
      entry("b", "sudo nmap -p- 10.0.0.5\nFOO=1 gobuster dir"),
      entry("c", "hydra x", { private: true }),
    ];
    expect(toolsUsed(log, [H])).toEqual([
      { tool: "nmap", count: 2 },
      { tool: "gobuster", count: 1 },
    ]);
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
