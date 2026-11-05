import { describe, it, expect } from "vitest";
import type { ChecklistState } from "../../../types/checklist";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";
import { applicableGoals } from "../../../engines/checklist";
import { hostStuck } from "../../../engines/stuck";

const host = (p: Partial<Host> = {}): Host => ({
  id: "h1", engagementId: "e1", name: "BOX", ip: "10.10.10.5", os: "linux", boardColumn: "enumerate", boardManual: false,
  access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (port: number, p: Partial<Service> = {}): Service => ({
  id: `s${n++}`, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: "http", nmapVersion: "Apache 2.4", confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, createdAt: 0, updatedAt: 0, ...p,
});
const engagement = { id: "e1", kind: "lab" } as Engagement;
const cmd = (command: string, hostIds = ["h1"]): LogEntry =>
  ({ id: `l${n++}`, engagementId: "e1", kind: "command", title: "", titleEdited: false, ranOn: null, hostIds, observations: null,
    returnedNothing: false, private: false, content: { kind: "command", blocks: [{ command, output: "" }] }, at: 0, createdAt: 0, updatedAt: 0 }) as LogEntry;

const run = (o: { host?: Host; services?: Service[]; state?: ChecklistState; entries?: LogEntry[]; note?: string } = {}) => {
  const h = o.host ?? host();
  const servicesByHost = new Map([[h.id, o.services ?? []]]);
  return hostStuck({ host: h, engagement, hosts: [h], servicesByHost, state: o.state ?? {}, entries: o.entries ?? [], hostNote: o.note ?? "" });
};
const goalIds = (h: Host, services: Service[], stage: string) =>
  applicableGoals(h, engagement, [h], new Map([[h.id, services]])).find((s) => s.stage.id === stage)?.goals.map((g) => g.id) ?? [];

describe("hostStuck before a foothold", () => {
  it("lists na goals, guessed and versionless services with filled nudges, untouched services, threads", () => {
    const services = [
      svc(80),
      svc(9999, { nmapService: "abyss?", nmapVersion: null }),
      svc(7777, { nmapService: "unknown", nmapVersion: null }),
    ];
    const enumGoal = goalIds(host(), services, "enumerate")[0]!;
    const r = run({ services, state: { [enumGoal]: { status: "na" } }, note: "x\n? what runs on 9999\n" });
    expect(r.phase).toBe("before-foothold");
    expect(r.skipped.map((s) => s.goalId)).toEqual([enumGoal]);
    expect(r.unidentified.map((u) => [u.service.port, u.reason])).toEqual([[9999, "guess"], [7777, "no-version"]]);
    expect(r.unidentified[0]!.nudges).toEqual([
      { label: "Talk to it", command: "nc -nv 10.10.10.5 9999  # then type help" },
      { label: "Rescan just these ports", command: "nmap -sV --version-all -p 9999,7777 10.10.10.5" },
      { label: "Grab the banner", command: "echo | nc -nv -w 3 10.10.10.5 9999" },
    ]);
    expect(r.unidentified[1]!.nudges[2]!.command).toBe("echo | nc -nv -w 3 10.10.10.5 7777");
    expect(r.untouched.map((s) => s.port)).toEqual([80, 9999, 7777]);
    expect(r.threads.map((t) => t.text)).toEqual(["what runs on 9999"]);
    expect(r.commands).toEqual([]);
  });

  it("uses the host name when there is no IP, and skips confirmed or closed services", () => {
    const services = [svc(9999, { nmapVersion: null }), svc(1234, { nmapVersion: null, confirmedProduct: "Foo" }), svc(5555, { nmapVersion: null, state: "closed" })];
    const r = run({ host: host({ ip: null }), services });
    expect(r.unidentified.map((u) => u.service.port)).toEqual([9999]);
    expect(r.unidentified[0]!.nudges[0]!.command).toBe("nc -nv BOX 9999  # then type help");
  });

  it("does not list cover-marked items as skipped", () => {
    const services = [svc(80)];
    const [a, b] = goalIds(host(), services, "enumerate");
    const r = run({ services, state: { [a!]: { status: "na", auto: true }, [b!]: { status: "na" } } });
    expect(r.skipped.map((s) => s.goalId)).toEqual([b]);
  });

  it("a port mentioned in a logged command is not untouched", () => {
    const services = [svc(80), svc(443), svc(8080), svc(22), svc(21)];
    const entries = [
      cmd("nmap -p 80,443 10.10.10.5"),
      cmd("curl http://10.10.10.5:8080/"),
      cmd("nc 10.10.10.22", ["h1"]), // IP octet only
      cmd("ftp 10.10.10.5 21", ["other"]), // another host
    ];
    expect(run({ services, entries }).untouched.map((s) => s.port)).toEqual([22, 21]);
    expect(run({ services: [svc(80)], entries: [cmd("curl 10.0.0.1:8080")] }).untouched.map((s) => s.port)).toEqual([80]);
  });
});

describe("hostStuck after a foothold", () => {
  it("lists todo privesc and loot goals, notes and threads", () => {
    const h = host({ access: "user" });
    const services = [svc(80)];
    const priv = goalIds(h, services, "privesc");
    const loot = goalIds(h, services, "loot");
    expect(priv.length).toBeGreaterThan(1);
    const r = run({ host: h, services, state: { [priv[0]!]: { status: "done" }, [loot[0]!]: { status: "na", auto: true } }, note: "? try sudo\nplain" });
    expect(r.phase).toBe("after-foothold");
    const ids = r.commands.map((c) => c.goalId);
    expect(ids).not.toContain(priv[0]);
    expect(ids).not.toContain(loot[0]);
    expect(ids).toContain(priv[1]);
    expect(r.commands.every((c) => c.title.length > 0)).toBe(true);
    expect(r.notes).toBe("? try sudo\nplain");
    expect(r.threads).toHaveLength(1);
    expect(r.skipped).toEqual([]);
    expect(r.untouched).toEqual([]);
  });

  it("a done foothold goal also means after-foothold", () => {
    expect(run({ state: { "h-foot-shell": { status: "done" } } }).phase).toBe("after-foothold");
  });
});

describe("hostStuck hints", () => {
  it("a bare host gets next-step hints", () => {
    const r = run({ host: host({ os: null }) });
    expect(r.hints).toEqual(["Import a scan to see service steps", "Set the OS to see privesc steps"]);
  });
  it("says nothing is left only when every list and other hint is empty", () => {
    const h = host({ access: "root" });
    const priv = goalIds(h, [svc(80)], "privesc");
    const all = Object.fromEntries(
      ["privesc", "loot", "pivot"].flatMap((s) => goalIds(h, [svc(80)], s)).concat(priv).map((id) => [id, { status: "done" as const }]),
    );
    expect(run({ host: h, services: [svc(80)], state: all }).hints).toEqual(["Nothing obvious left on this host"]);
  });
});
