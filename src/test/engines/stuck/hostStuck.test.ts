import { describe, it, expect } from "vitest";
import type { ChecklistState } from "../../../types/checklist";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { LibraryCommand } from "../../../engines/library/types";
import { TEST_LIBRARY } from "../../support/library";
import type { Service } from "../../../types/service";
import { applicableGoals } from "../../../engines/checklist";
import { hostStuck } from "../../../engines/stuck";

const host = (p: Partial<Host> = {}): Host => ({
  id: "h1", engagementId: "e1", name: "BOX", ip: "10.10.10.5", os: "linux", boardColumn: "information-gathering", boardManual: false,
  access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (port: number, p: Partial<Service> = {}): Service => ({
  id: `s${n++}`, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: "http", nmapVersion: "Apache 2.4", confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 0, updatedAt: 0, ...p,
});
const engagement = { id: "e1", kind: "lab" } as Engagement;
const cmd = (command: string, hostIds = ["h1"]): LogEntry =>
  ({ id: `l${n++}`, engagementId: "e1", kind: "command", title: "", titleEdited: false, ranOn: null, hostIds, observations: null,
    returnedNothing: false, private: false, content: { kind: "command", blocks: [{ command, output: "" }] }, at: 0, createdAt: 0, updatedAt: 0 }) as LogEntry;

const run = (o: { host?: Host; services?: Service[]; state?: ChecklistState; entries?: LogEntry[]; note?: string; engagement?: Engagement; library?: LibraryCommand[] } = {}) => {
  const h = o.host ?? host();
  const servicesByHost = new Map([[h.id, o.services ?? []]]);
  return hostStuck({ host: h, engagement: o.engagement ?? engagement, library: o.library ?? TEST_LIBRARY, hosts: [h], servicesByHost, state: o.state ?? {}, entries: o.entries ?? [], hostNote: o.note ?? "" });
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
    const enumGoal = goalIds(host(), services, "information-gathering")[0]!;
    const r = run({ services, state: { [enumGoal]: { status: "na" } }, note: "x\n? what runs on 9999\n" });
    expect(r.phase).toBe("before-foothold");
    expect(r.skipped.map((s) => s.goalId)).toEqual([enumGoal]);
    expect(r.unidentified.map((u) => [u.service.port, u.reason])).toEqual([[9999, "guess"], [7777, "no-version"]]);
    expect(r.unidentified[0]!.nudges).toEqual([
      { label: "Talk to it (then type help)", command: "nc -nv 10.10.10.5 9999" },
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
    expect(r.unidentified[0]!.nudges[0]!.command).toBe("nc -nv BOX 9999");
  });

  it("does not list cover-marked items as skipped", () => {
    const services = [svc(80)];
    const [a, b] = goalIds(host(), services, "information-gathering");
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
    const priv = goalIds(h, services, "privilege-escalation");
    const loot = goalIds(h, services, "post-exploitation");
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

describe("hostStuck after-foothold stages", () => {
  it("after a foothold, commands come from privilege-escalation, post-exploitation and lateral-movement", () => {
    const h = host({ access: "user", dualHomed: true });
    const services = [svc(80)];
    const r = run({ host: h, services });
    const stageOf = (goalId: string) =>
      applicableGoals(h, engagement, [h], new Map([[h.id, services]])).find((s) => s.goals.some((g) => g.id === goalId))!.stage.id;
    const stages = new Set(r.commands.map((c) => stageOf(c.goalId)));
    expect([...stages].sort()).toEqual(["lateral-movement", "post-exploitation", "privilege-escalation"]);
    expect(r.commands.map((c) => c.goalId)).toContain("h-pivot-tunnel");
  });
});

describe("hostStuck hints", () => {
  it("a bare host gets next-step hints", () => {
    const r = run({ host: host({ os: null }) });
    expect(r.hints).toEqual(["Import a scan to see service steps", "Set the OS to see privesc steps"]);
  });
  it("says nothing is left only when every list and other hint is empty", () => {
    const h = host({ access: "root" });
    const priv = goalIds(h, [svc(80)], "privilege-escalation");
    const all = Object.fromEntries(
      ["privilege-escalation", "post-exploitation", "lateral-movement"].flatMap((s) => goalIds(h, [svc(80)], s)).concat(priv).map((id) => [id, { status: "done" as const }]),
    );
    expect(run({ host: h, services: [svc(80)], state: all }).hints).toEqual(["Nothing obvious left on this host"]);
  });

  it("quotes the target and gives no nudges when there is neither IP nor name", () => {
    const services = [svc(9999, { nmapVersion: null })];
    expect(run({ host: host({ ip: null, name: "" }), services }).unidentified[0]!.nudges).toEqual([]);
    const spaced = run({ host: host({ ip: null, name: "my box" }), services }).unidentified[0]!.nudges;
    expect(spaced[0]!.command).toBe("nc -nv 'my box' 9999");
    expect(spaced[1]!.command).toBe("nmap -sV --version-all -p 9999 'my box'");
  });

  it("a bare host with no services, OS, note or IP does not throw", () => {
    const r = run({ host: host({ ip: null, name: "", os: null }) });
    expect(r.unidentified).toEqual([]);
    expect(r.hints).toHaveLength(2);
  });
});

describe("hostStuck port ranges", () => {
  const ports = [22, 80, 85, 8080];
  const untouched = (command: string) => run({ services: ports.map((p) => svc(p)), entries: [cmd(command)] }).untouched.map((s) => s.port);
  it("-p- touches every port", () => expect(untouched("nmap -p- 10.10.10.5")).toEqual([]));
  it("-p 1-1000 touches 80 but not 8080", () => expect(untouched("nmap -p 1-1000 10.10.10.5")).toEqual([8080]));
  it("-p 22,80-90 touches 22, 80 and 85", () => expect(untouched("nmap -p 22,80-90 10.10.10.5")).toEqual([8080]));
  it("an IP octet range is not a port range", () => expect(untouched("nmap 10.10.10.1-100")).toEqual([22, 80, 85, 8080]));
  it("--ports=1-100 touches 22, 80 and 85", () => expect(untouched("nmap --ports=1-100 10.10.10.5")).toEqual([8080]));
  it("--ports 20-30 touches only 22", () => expect(untouched("nmap --ports 20-30 10.10.10.5")).toEqual([80, 85, 8080]));
  it("-p22,80-90 without a space works", () => expect(untouched("nmap -p22,80-90 10.10.10.5")).toEqual([8080]));
  it("a protocol prefix and an open-ended range work", () => expect(untouched("nmap -p T:80-90,8000- 10.10.10.5")).toEqual([22]));
  it("a range outside -p / --ports does not count", () => {
    expect(untouched("sed -n 1-200p linpeas.out")).toEqual([22, 80, 85, 8080]);
    expect(untouched("searchsploit CVE-2021-3156")).toEqual([22, 80, 85, 8080]);
    expect(untouched("ping 10.0.0.1-254")).toEqual([22, 80, 85, 8080]);
    expect(untouched("seq 1-1000")).toEqual([22, 80, 85, 8080]);
  });
  it("a whole-number token still counts anywhere", () => expect(untouched("curl http://10.10.10.5:8080/x ; ssh -p 22 u@h")).toEqual([80, 85]));
});

describe("hostStuck exam bans", () => {
  const h = host({ access: "user" });
  const services = [svc(80)];
  const [banned, free] = goalIds(h, services, "privilege-escalation");
  const lib = (exam?: "banned" | "metasploit"): LibraryCommand[] => [
    { id: "b", title: "b", tool: "t", template: "x", os: "any", runFrom: "attacker", goals: [banned!], ...(exam ? { exam } : {}), source: "raven" },
  ];
  const exam = { id: "e1", kind: "exam-sim", msfHostId: null } as Engagement;
  it("drops a goal with only banned commands in exam sim, keeps it in lab", () => {
    const inExam = run({ host: h, services, engagement: exam, library: lib("banned") }).commands.map((c) => c.goalId);
    expect(inExam).not.toContain(banned);
    expect(inExam).toContain(free);
    expect(run({ host: h, services, library: lib("banned") }).commands.map((c) => c.goalId)).toContain(banned);
  });
  it("a metasploit-only goal stays legal on the locked host and is hidden elsewhere", () => {
    const here = { ...exam, msfHostId: "h1" } as Engagement;
    const other = { ...exam, msfHostId: "h2" } as Engagement;
    expect(run({ host: h, services, engagement: here, library: lib("metasploit") }).commands.map((c) => c.goalId)).toContain(banned);
    expect(run({ host: h, services, engagement: other, library: lib("metasploit") }).commands.map((c) => c.goalId)).not.toContain(banned);
  });
});
