import { describe, expect, it } from "vitest";
import { attackPathRows, findingRows, portRows, resultLine, scopeRows } from "../engines/report";
import type { ReportData, ReportTarget } from "../engines/report";
import type { AccessGrant } from "../types/credentials";
import type { Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { LogContent, LogEntry } from "../types/log";
import type { Hop } from "../types/network";
import type { Service } from "../types/service";

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const host = (id: string, name: string, extra: Partial<Host> = {}): Host => ({ id, name, adSetEffective: false, ...extra }) as Host;

let seq = 0;
const entry = (id: string, hostId: string, at: number, content: LogContent, extra: Partial<LogEntry> = {}): LogEntry =>
  ({
    id,
    engagementId: "e1",
    kind: content.kind,
    title: id,
    hostIds: [hostId],
    private: false,
    returnedNothing: false,
    content,
    at: T0 + at * MIN,
    createdAt: ++seq,
    ...extra,
  }) as LogEntry;

const cmd: LogContent = { kind: "command", blocks: [{ command: "cmd", output: "out" }] };
const flag = (flagKind: "local" | "proof", value: string): LogContent => ({ kind: "flag", flagKind, value });
const service = (hostId: string, port: number, extra: Partial<Service> = {}): Service =>
  ({ id: `s-${hostId}-${port}`, hostId, port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null, confirmedProduct: null, confirmedVersion: null, ...extra }) as Service;
const grant = (hostId: string, level: AccessGrant["level"], usernameId: string, logEntryId: string, at: number, via = "shell"): AccessGrant =>
  ({ id: `gr-${logEntryId}`, hostId, level, usernameId, via, logEntryId, at: T0 + at * MIN }) as AccessGrant;
const hop = (fromHostId: string | null, toHostId: string, logEntryId: string, at: number, via: string): Hop =>
  ({ id: `hop-${logEntryId}`, fromHostId, toHostId, logEntryId, at: T0 + at * MIN, via }) as Hop;
const finding = (id: string, title: string, severity: Finding["severity"], hostIds: string[], stepEntryIds: string[], createdAt = 1): Finding =>
  ({ id, title, severity, hostIds, stepEntryIds, createdAt, lessons: "private notes", serviceIds: [] }) as unknown as Finding;

const empty = (): ReportData =>
  ({
    engagement: { id: "e1", kind: "exam-sim" },
    hosts: [], services: [], log: [], checklist: [], findings: [], findingFiles: [], attempts: [], ruledOut: [],
    grants: [], usernames: [], hops: [], cleanup: [], notes: [], credentials: [], credAttempts: [],
  }) as unknown as ReportData;

const standalone = (id: string): ReportTarget => ({ key: id, kind: "standalone", hostIds: [id] });

/** quartz: one shell as ronan, then root, flags; three findings (entry, privesc, none). */
function lab(): ReportData {
  const d = empty();
  d.hosts = [host("h1", "quartz", { ip: "172.31.166.144", os: "linux" }), host("h2", "onyx", { ip: "172.31.166.145", os: "windows" })];
  d.usernames = [{ id: "u1", username: "ronan" }, { id: "u2", username: "jo.parker" }] as never;
  d.services = [
    service("h1", 22, { nmapService: "ssh", nmapVersion: "OpenSSH 8" }),
    service("h1", 21, { nmapService: "ftp", confirmedProduct: "vsftpd", confirmedVersion: "3.0.5" }),
    service("h1", 8080, { state: "closed" }),
    service("h1", 53, { protocol: "udp", state: "open|filtered" }),
  ];
  d.log = [
    entry("git", "h1", 10, cmd),
    entry("shell", "h1", 20, cmd),
    entry("local", "h1", 21, flag("local", "860f")),
    entry("ovl", "h1", 30, cmd),
    entry("root", "h1", 31, cmd),
    entry("proof", "h1", 32, flag("proof", "ee23")),
    entry("secret", "h1", 33, flag("proof", "private-one"), { private: true }),
  ];
  d.grants = [grant("h1", "user", "u1", "shell", 20), grant("h1", "admin", "u1", "root", 31)];
  d.findings = [
    finding("f1", "Exposed .git", "high", ["h1"], ["git", "shell"], 1),
    finding("f2", "sudo find", "high", ["h1"], ["ovl", "root"], 2),
    finding("f3", "Anonymous FTP", "low", ["h1"], [], 3),
  ];
  return d;
}

describe("portRows", () => {
  it("lists open services by port with confirmed values over nmap's", () => {
    const rows = portRows(lab(), "h1");
    expect(rows[0]).toEqual({ serviceId: "s-h1-21", port: "21/tcp", service: "vsftpd", version: "3.0.5" });
    expect(rows[1]).toEqual({ serviceId: "s-h1-22", port: "22/tcp", service: "ssh", version: "OpenSSH 8" });
    expect(rows.map((r) => r.port)).toEqual(["21/tcp", "22/tcp", "53/udp"]);
  });
});

describe("resultLine", () => {
  it("joins grants in time order and prints non-private expected flags, local first", () => {
    expect(resultLine(lab(), standalone("h1"), "h1", {})).toEqual({
      access: "shell as `ronan`, then root",
      flags: [{ kind: "local", value: "860f" }, { kind: "proof", value: "ee23" }],
    });
  });

  it("names a hop-entered machine by the hop's via and writes Windows levels", () => {
    const d = lab();
    d.hosts = [host("ms01", "MS01", { os: "windows", adSetEffective: true }), host("ms02", "MS02", { os: "windows", adSetEffective: true })];
    d.hops = [hop("ms01", "ms02", "winrm", 40, "WinRM")];
    d.grants = [grant("ms02", "user", "u2", "winrm", 40), grant("ms02", "admin", "u2", "adm", 50), grant("ms02", "system", "u1", "sys", 60)];
    d.log = [];
    const target: ReportTarget = { key: "ad-set", kind: "ad-set", hostIds: ["ms01", "ms02"] };
    expect(resultLine(d, target, "ms02", {})).toEqual({
      access: "WinRM as `jo.parker`, then local administrator as `jo.parker`, then SYSTEM",
      flags: [],
    });
  });

  it("is empty with no grants and omits a missing expected flag", () => {
    const d = lab();
    d.grants = [];
    d.log = d.log.filter((e) => e.id !== "proof");
    expect(resultLine(d, standalone("h1"), "h1", {})).toEqual({ access: "", flags: [{ kind: "local", value: "860f" }] });
  });
});

describe("findingRows", () => {
  const targets = [standalone("h1")];

  it("ranks by severity, then grading order, with each finding's result", () => {
    const rows = findingRows(lab(), targets);
    expect(rows.map((r) => [r.title, r.result])).toEqual([["Exposed .git", "Initial access"], ["sudo find", "Root"], ["Anonymous FTP", "None"]]);
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ findingId: "f1", host: "quartz", severity: "high" });
  });

  it("never carries lessons", () => {
    expect(findingRows(lab(), targets).every((r) => !("lessons" in r))).toBe(true);
  });

  it("orders equal severities by target grading order and lists a finding once", () => {
    const d = lab();
    d.findings = [finding("a", "On onyx", "high", ["h2"], []), finding("b", "On quartz", "high", ["h1"], []), finding("c", "Both", "critical", ["h1", "h2"], [])];
    const rows = findingRows(d, [standalone("h2"), standalone("h1")]);
    expect(rows.map((r) => r.title)).toEqual(["Both", "On onyx", "On quartz"]);
  });

  it("calls a domain-compromise finding Domain Admin and names both machines of an AD finding", () => {
    const d = empty();
    d.hosts = [host("ms01", "MS01", { os: "windows", adSetEffective: true }), host("dc01", "DC01", { os: "windows", adSetEffective: true })];
    d.usernames = [{ id: "u1", username: "tom" }] as never;
    d.services = [service("dc01", 88), service("dc01", 389)];
    d.log = [entry("up", "ms01", 5, cmd), entry("dcsync", "dc01", 90, cmd)];
    d.hops = [hop(null, "ms01", "up", 5, "upload"), hop("ms01", "dc01", "dcsync", 90, "pass-the-hash")];
    d.grants = [grant("ms01", "user", "u1", "up", 5), grant("dc01", "admin", "u1", "dcsync", 90)];
    d.findings = [finding("f", "Reused admin", "critical", ["ms01", "dc01"], ["dcsync"])];
    const rows = findingRows(d, [{ key: "ad-set", kind: "ad-set", hostIds: ["ms01", "dc01"] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].host).toBe("MS01 / DC01");
    expect(rows[0].result).toBe("Domain Admin");
  });
});

describe("scopeRows", () => {
  it("lists every target machine in grading order, AD last", () => {
    const d = lab();
    d.hosts.push(host("a1", "MS01", { ip: "10.10.130.141", os: "windows", adSetEffective: true }));
    const rows = scopeRows(d, [standalone("h1"), standalone("h2"), { key: "ad-set", kind: "ad-set", hostIds: ["a1"] }]);
    expect(rows).toEqual([
      { host: "quartz", ip: "172.31.166.144", os: "Linux", set: "Independent" },
      { host: "onyx", ip: "172.31.166.145", os: "Windows", set: "Independent" },
      { host: "MS01", ip: "10.10.130.141", os: "Windows", set: "AD" },
    ]);
  });
});

describe("attackPathRows", () => {
  function ad(): ReportData {
    const d = empty();
    d.hosts = ["ms01", "ms02", "dc01"].map((id) => host(id, id, { adSetEffective: true }));
    d.usernames = [{ id: "u1", username: "jo.parker" }, { id: "u2", username: "sam" }] as never;
    d.hops = [hop(null, "ms01", "e1", 10, "APS file upload"), hop("ms01", "ms02", "e3", 40, "WinRM")];
    d.grants = [
      grant("ms01", "user", "u1", "e1", 10, "upload"),
      grant("ms01", "system", "u1", "e2", 20, "PrintSpoofer"),
      grant("ms02", "user", "u2", "e3", 40, "winrm"),
    ];
    return d;
  }

  it("merges hops and grants in time order, folding a hop's own grant into its row", () => {
    const rows = attackPathRows(ad(), ["ms01", "ms02", "dc01"]);
    expect(rows[0]).toEqual({ step: 1, from: "Kali", technique: "APS file upload", to: "ms01", access: "`jo.parker` (user)" });
    expect(rows[1]).toEqual({ step: 2, from: "ms01", technique: "PrintSpoofer", to: "ms01", access: "`jo.parker` (system)" });
    expect(rows[2]).toEqual({ step: 3, from: "ms01", technique: "WinRM", to: "ms02", access: "`sam` (user)" });
    expect(rows).toHaveLength(3);
  });

  it("gives a hop with no grant an empty access", () => {
    const d = ad();
    d.grants = [];
    expect(attackPathRows(d, ["ms01", "ms02"]).map((r) => r.access)).toEqual(["", ""]);
  });
});
