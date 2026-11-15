import { describe, expect, it } from "vitest";
import { expectedFlags, isValidOsid, reportDueAt, reportFileName, reportTargets } from "../engines/report";
import type { ReportData, ReportMeta } from "../engines/report";
import type { Engagement, EngagementKind } from "../types/engagement";
import type { BoardColumn, Host } from "../types/host";
import type { LogEntry } from "../types/log";

const host = (id: string, name: string, boardColumn: BoardColumn, adSetEffective = false): Host =>
  ({ id, name, boardColumn, adSetEffective }) as Host;

const flag = (id: string, hostId: string, isPrivate = false): LogEntry =>
  ({
    id,
    kind: "flag",
    hostIds: [hostId],
    private: isPrivate,
    content: { kind: "flag", flagKind: "proof", value: "x" },
  }) as unknown as LogEntry;

const eng = (kind: EngagementKind, extra: Partial<Engagement> = {}): Engagement =>
  ({ id: "e1", kind, timeboxStart: null, timeboxMinutes: null, timeboxPausedMs: 0, timeboxPausedAt: null, ...extra }) as Engagement;

const data = (kind: EngagementKind, hosts: Host[], log: LogEntry[] = []): ReportData =>
  ({
    engagement: eng(kind),
    hosts,
    services: [],
    log,
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
  }) as ReportData;

const hosts = [
  host("h-dc01", "dc01", "privilege-escalation", true),
  host("h-ad02", "ad02", "initial-foothold", true),
  host("h-web", "web01", "initial-foothold"),
  host("h-ms01", "ms01", "information-gathering"),
  host("h-lnx", "lnx02", "initial-foothold"),
];

describe("reportTargets", () => {
  it("exam-sim: standalone in board order then name, then the ad-set", () => {
    const t = reportTargets(data("exam-sim", hosts), {});
    expect(t.map((x) => x.key)).toEqual(["h-ms01", "h-lnx", "h-web", "ad-set"]);
    expect(t[3]).toEqual({ key: "ad-set", kind: "ad-set", hostIds: ["h-ad02", "h-dc01"] });
    expect(t[0].kind).toBe("standalone");
  });

  it("exam-sim: no ad-set target when no host is in the set", () => {
    const t = reportTargets(data("exam-sim", [hosts[2]]), {});
    expect(t.map((x) => x.key)).toEqual(["h-web"]);
  });

  it("lab: hosts with a non-private flag entry; none -> empty", () => {
    const log = [flag("f1", "h-web"), flag("f2", "h-ms01", true)];
    expect(reportTargets(data("lab", hosts, log), {}).map((x) => x.key)).toEqual(["h-web"]);
    expect(reportTargets(data("lab", hosts), {})).toEqual([]);
  });

  it("lab: includedHostIds wins and AD hosts move to an ad-set target", () => {
    const meta: ReportMeta = { includedHostIds: ["h-ms01", "h-web", "h-dc01"] };
    const t = reportTargets(data("lab", hosts, [flag("f1", "h-lnx")]), meta);
    expect(t.map((x) => x.key)).toEqual(["h-ms01", "h-web", "ad-set"]);
    expect(t[2].hostIds).toEqual(["h-dc01"]);
    expect(reportTargets(data("lab", hosts), { includedHostIds: ["h-ms01", "h-web"] })).toHaveLength(2);
  });

  it("drops host ids that no longer exist", () => {
    const t = reportTargets(data("lab", hosts), { includedHostIds: ["h-gone", "h-web"] });
    expect(t.map((x) => x.key)).toEqual(["h-web"]);
  });

  it("client has no targets", () => {
    expect(reportTargets(data("client", hosts, [flag("f", "h-web")]), {})).toEqual([]);
  });
});

describe("expectedFlags", () => {
  const standalone = { key: "h-web", kind: "standalone" as const, hostIds: ["h-web"] };
  const ad = { key: "ad-set", kind: "ad-set" as const, hostIds: ["h-dc01"] };
  it("defaults by target kind", () => {
    expect(expectedFlags(standalone, "h-web", {})).toEqual(["local", "proof"]);
    expect(expectedFlags(ad, "h-dc01", {})).toEqual(["proof"]);
  });
  it("meta overrides", () => {
    expect(expectedFlags(standalone, "h-web", { expectedFlags: { "h-web": ["proof"] } })).toEqual(["proof"]);
  });
});

describe("osid and file name", () => {
  it("validates OSIDs", () => {
    expect(isValidOsid("OS-57211047")).toBe(true);
    for (const bad of ["os-12345", "OS12345", " OS-1"]) expect(isValidOsid(bad)).toBe(false);
  });
  it("builds the file name", () => {
    expect(reportFileName("OS-123")).toBe("OSCP-OS-123-Exam-Report.pdf");
    expect(reportFileName("os-1")).toBe("OSCP-OS-?????-Exam-Report.pdf");
  });
});

describe("reportDueAt", () => {
  it("timebox end plus 24h", () => {
    const e = eng("exam-sim", { timeboxStart: 0, timeboxMinutes: 1425 });
    expect(reportDueAt(e, {})).toBe(1425 * 60_000 + 86_400_000);
  });
  it("examEndAt wins", () => {
    expect(reportDueAt(eng("lab"), { examEndAt: 1000 })).toBe(1000 + 86_400_000);
  });
  it("null for lab without examEndAt, client, and exam-sim without timebox", () => {
    expect(reportDueAt(eng("lab"), {})).toBeNull();
    expect(reportDueAt(eng("client"), { examEndAt: 5 })).toBeNull();
    expect(reportDueAt(eng("exam-sim"), {})).toBeNull();
  });
});
