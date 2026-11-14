import { describe, expect, it } from "vitest";
import { findingPhaseMap, isDeadEnd, provingEntries } from "../engines/report";
import type { ReportData, ReportTarget } from "../engines/report";
import type { AccessGrant } from "../types/credentials";
import type { ChecklistItem } from "../types/checklist";
import type { FailedAttempt, Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { LogContent, LogEntry } from "../types/log";
import type { Hop } from "../types/network";
import type { Service } from "../types/service";

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const host = (id: string, name: string, adSetEffective = false): Host => ({ id, name, adSetEffective }) as Host;

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

const cmd = (...outputs: string[]): LogContent => ({
  kind: "command",
  blocks: outputs.map((output, i) => ({ command: `cmd ${i}`, output })),
});
const shot: LogContent = { kind: "screenshot", attachmentId: "a1", caption: "login page", fileName: "s.png" };
const proofFlag: LogContent = { kind: "flag", flagKind: "proof", value: "abc" };
const note: LogContent = { kind: "note", text: "secret" };

const goal = (ownerId: string, entryIds: string[]): ChecklistItem =>
  ({ ownerId, goalId: `g-${entryIds.join("-")}`, evidence: entryIds.map((entryId) => ({ entryId })) }) as ChecklistItem;
const service = (hostId: string, port: number, confirmedEntryId: string | null = null): Service =>
  ({ id: `s-${hostId}-${port}`, hostId, port, protocol: "tcp", state: "open", confirmedEntryId }) as Service;
const grant = (hostId: string, level: AccessGrant["level"], logEntryId: string, at: number): AccessGrant =>
  ({ id: `gr-${logEntryId}`, hostId, level, logEntryId, at: T0 + at * MIN }) as AccessGrant;
const hop = (fromHostId: string | null, toHostId: string, logEntryId: string, at: number): Hop =>
  ({ id: `hop-${toHostId}`, fromHostId, toHostId, logEntryId, at: T0 + at * MIN }) as Hop;

const empty = (): ReportData =>
  ({
    engagement: { id: "e1", kind: "exam-sim" },
    hosts: [],
    services: [],
    log: [],
    checklist: [],
    findings: [],
    findingFiles: [],
    attempts: [],
    ruledOut: [],
    grants: [],
    usernames: [],
    hops: [],
    cleanup: [],
    notes: [],
    credentials: [], credAttempts: [],
  }) as unknown as ReportData;

const H = "h-web";

/** One Windows host, worked from nmap to SYSTEM. */
function windowsHost(): ReportData {
  const d = empty();
  d.hosts = [host(H, "web01")];
  d.log = [
    entry("nmap", H, 0, { kind: "command", blocks: [{ command: "sudo nmap -p- 10.0.0.5", output: "80/tcp open http" }] }),
    entry("hydra", H, 5, cmd("0 valid passwords")),
    entry("smbclient", H, 8, cmd(""), { returnedNothing: true }),
    entry("ferox", H, 10, cmd("200 /upload")),
    entry("shot", H, 12, shot),
    entry("curl", H, 20, cmd("uid=web")),
    entry("winpeas", H, 30, cmd("lots")),
    entry("whoami", H, 40, cmd("SeImpersonatePrivilege Enabled")),
    entry("printspoofer", H, 50, cmd("nt authority\\system")),
    entry("flag", H, 55, proofFlag),
    entry("private", H, 56, note, { private: true }),
  ];
  d.checklist = [goal(H, ["nmap", "hydra"]), goal("e1", ["whoami"]), goal(H, ["private"])];
  d.attempts = [{ id: "a1", logEntryId: "hydra", hostId: H, title: "SSH password guessing", reasonKind: "access", reason: "", private: false } as FailedAttempt];
  d.services = [service(H, 80, "ferox"), service(H, 445)];
  d.grants = [grant(H, "user", "curl", 20), grant(H, "system", "printspoofer", 50)];
  return d;
}

const target = (hostIds: string[], kind: ReportTarget["kind"] = "standalone"): ReportTarget => ({
  key: kind === "standalone" ? hostIds[0] : "ad-set",
  kind,
  hostIds,
});

describe("provingEntries", () => {
  it("keeps entries that proved something, never dead ends or private ones", () => {
    const ids = [...provingEntries(windowsHost(), H).keys()].sort();
    expect(ids).toEqual(["curl", "ferox", "flag", "nmap", "printspoofer", "whoami"].sort());
    const reasons = provingEntries(windowsHost(), H);
    expect(reasons.get("ferox")).toEqual(["service"]);
    expect(reasons.get("curl")).toEqual(["access"]);
    expect(reasons.get("flag")).toEqual(["flag"]);
    expect(reasons.has("hydra")).toBe(false);
    expect(reasons.has("smbclient")).toBe(false);
    expect(reasons.has("winpeas")).toBe(false);
    expect(reasons.has("private")).toBe(false);
  });

  it("counts hops into the host and finding steps", () => {
    const d = windowsHost();
    d.log.push(entry("psexec", H, 60, cmd("ok")), entry("step", H, 61, cmd("ok")));
    d.hops = [hop("other", H, "psexec", 60)];
    d.findings = [{ id: "f1", hostIds: [H], serviceIds: [], stepEntryIds: ["step"] } as unknown as Finding];
    const reasons = provingEntries(d, H);
    expect(reasons.get("psexec")).toEqual(["hop"]);
    expect(reasons.get("step")).toEqual(["finding-step"]);
  });
});

describe("isDeadEnd", () => {
  it("is a failed attempt's entry or returned nothing", () => {
    const d = windowsHost();
    const byId = (id: string) => d.log.find((e) => e.id === id)!;
    expect(isDeadEnd(byId("hydra"), d)).toBe(true);
    expect(isDeadEnd(byId("smbclient"), d)).toBe(true);
    expect(isDeadEnd(byId("nmap"), d)).toBe(false);
  });
});

const finding = (id: string, over: Partial<Finding>) =>
  ({ id, title: id, hostIds: [H], serviceIds: [], stepEntryIds: [], severity: "high", refs: [], createdAt: 1, ...over }) as Finding;

/** windowsHost with its walkthrough linked to findings: the upload RCE (ferox, curl) and SeImpersonate (whoami,
 *  printspoofer). Goal evidence and service confirmation alone no longer place an entry. */
function walked(): ReportData {
  const d = windowsHost();
  d.findings = [
    finding("rce", { title: "File upload to RCE", stepEntryIds: ["ferox", "curl"], createdAt: 1 }),
    finding("priv", { title: "SeImpersonatePrivilege to SYSTEM", stepEntryIds: ["whoami", "printspoofer"], createdAt: 2 }),
  ];
  return d;
}

const AD_HOSTS = ["h-ad02", "h-dc01", "h-ms01"];
function adSet(): ReportData {
  const d = empty();
  d.hosts = [host("h-dc01", "dc01", true), host("h-ad02", "ad02", true), host("h-ms01", "ms01", true)];
  d.services = [service("h-dc01", 88), service("h-dc01", 389), service("h-ms01", 80)];
  d.log = [
    entry("ms-scan", "h-ms01", -5, { kind: "command", blocks: [{ command: "nmap 10.0.0.1", output: "80 open" }] }),
    entry("ms-rce", "h-ms01", 0, cmd("uid")),
    entry("ad-winrm", "h-ad02", 10, cmd("ok")),
    entry("ad-dump", "h-ad02", 15, cmd("hash")),
    entry("dc-psexec", "h-dc01", 20, cmd("system")),
    entry("dc-flag", "h-dc01", 25, proofFlag),
  ];
  d.grants = [grant("h-ms01", "user", "ms-rce", 0), grant("h-ad02", "user", "ad-winrm", 10)];
  d.checklist = [goal("h-ad02", ["ad-dump"]), goal("h-ms01", ["ms-scan"])];
  d.hops = [hop("h-ms01", "h-ad02", "ad-winrm", 10), hop("h-ad02", "h-dc01", "dc-psexec", 20)];
  return d;
}

describe("findingPhaseMap", () => {
  it("names the machine and phase each finding was placed under; one that enabled none is additional", () => {
    const d = walked();
    d.findings.push(finding("info", { severity: "info", stepEntryIds: ["curl"] }));
    const map = findingPhaseMap(d, target([H]));
    expect(Object.fromEntries(map)).toEqual({
      rce: { hostId: H, phase: "foothold" },
      priv: { hostId: H, phase: "privesc" },
      info: { hostId: H, phase: "additional" },
    });
  });

  it("places an AD finding once, at the machine of its first step", () => {
    const d = adSet();
    d.findings = [{ id: "f-da", hostIds: ["h-ad02", "h-dc01"], serviceIds: [], stepEntryIds: ["ad-dump", "dc-psexec"], severity: "critical", refs: [] } as unknown as Finding];
    expect(findingPhaseMap(d, target(AD_HOSTS, "ad-set")).get("f-da")).toEqual({ hostId: "h-ad02", phase: "privesc" });
  });
});
