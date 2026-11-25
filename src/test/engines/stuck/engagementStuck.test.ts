import { describe, it, expect } from "vitest";
import type { ChecklistState } from "../../../types/checklist";
import type { CredAttempt, Credential, Username } from "../../../types/credentials";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { Service } from "../../../types/service";
import type { LibraryCommand } from "../../../engines/library/types";
import { TEST_LIBRARY } from "../../support/library";
import { applicableGoals } from "../../../engines/checklist";
import type { Tunnel } from "../../../types/network";
import { engagementStuck } from "../../../engines/stuck";

const host = (id: string, p: Partial<Host> = {}): Host => ({
  id, engagementId: "e1", name: id, ip: "10.10.10.5", os: "linux", boardColumn: "information-gathering", boardManual: false,
  access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (hostId: string, port: number, nmapService = "http"): Service => ({
  id: `s${n++}`, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion: "x", confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 0, updatedAt: 0,
});
const cred = (p: Partial<Credential> = {}): Credential => ({
  id: "c1", engagementId: "e1", type: "password", username: "alice", domain: null, secret: "pw", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: 0, updatedAt: 0, ...p,
});
const uname = (id: string): Username => ({ id, engagementId: "e1", username: `u-${id}`, domain: null, sourceHostId: null, source: null, createdAt: 0, scope: "unknown", localHostId: null });
const attempt = (p: Partial<CredAttempt>): CredAttempt => ({
  id: `a${n++}`, engagementId: "e1", credId: "c1", usernameId: null, hostId: "A", service: "ssh", port: 22, result: "valid", authMode: "domain",
  detail: null, logEntryId: null, at: 10, ...p,
});
const engagement = { id: "e1", kind: "lab", msfHostId: null } as Engagement;

const run = (o: {
  hosts?: Host[]; services?: Record<string, Service[]>; byOwner?: Record<string, ChecklistState>; credentials?: Credential[];
  attempts?: CredAttempt[]; usernames?: Username[]; tunnels?: Tunnel[]; engagement?: Engagement; library?: LibraryCommand[];
} = {}) => {
  const hosts = o.hosts ?? [];
  return engagementStuck({
    engagement: o.engagement ?? engagement, hosts,
    servicesByHost: new Map(hosts.map((h) => [h.id, o.services?.[h.id] ?? []])),
    byOwner: new Map(Object.entries(o.byOwner ?? {})), credentials: o.credentials ?? [], attempts: o.attempts ?? [],
    usernames: o.usernames ?? [], tunnels: o.tunnels ?? [], library: o.library ?? TEST_LIBRARY,
  });
};
const FOOT_DONE: ChecklistState = { "h-foot-shell": { status: "done" } };

describe("engagementStuck lines", () => {
  it("no foothold with enumeration left", () => {
    const l = run({ hosts: [host("A")], services: { A: [svc("A", 80)] } });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ area: "foothold", hostId: "A" });
    expect(l[0]!.subject).toBe("A");
    expect(l[0]!.text).toMatch(/^no foothold; \d+ enumeration steps? still to do$/);
    expect(l[0]!.goalId).toBeTruthy();
  });

  it("a host with foothold and privesc left is a privesc line; rooted hosts are silent", () => {
    const l = run({ hosts: [host("A")], services: { A: [svc("A", 80)] }, byOwner: { A: FOOT_DONE } });
    expect(l[0]).toMatchObject({ area: "privesc", hostId: "A" });
    expect(l[0]!.subject).toBe("A");
    expect(l[0]!.text).toMatch(/^\d+ privesc steps? still to do$/);
    expect(l[0]!.goalId).not.toBe("h-pe-proof");
    expect(run({ hosts: [host("A")], services: { A: [svc("A", 80)] }, byOwner: { A: { ...FOOT_DONE, "h-pe-proof": { status: "done" } } } })).toEqual([]);
  });

  it("untested credential cells", () => {
    const hosts = [host("A", { name: "" , ip: null }), host("B")];
    const l = run({
      hosts, byOwner: { A: FOOT_DONE, B: FOOT_DONE, e1: { "cred-routine-spray-users": { status: "done" } } },
      services: { A: [svc("A", 22, "ssh")], B: [svc("B", 22, "ssh")] }, credentials: [cred()],
    }).filter((x) => x.area === "credentials");
    expect(l).toEqual([{ area: "credentials", subject: "alice", text: "2 host/service cells untested", hostId: "A" }]);
    // one tested: singular
    const one = run({
      hosts, byOwner: { A: FOOT_DONE, B: FOOT_DONE }, services: { A: [svc("A", 22, "ssh")], B: [svc("B", 22, "ssh")] },
      credentials: [cred()], attempts: [attempt({ hostId: "A", result: "failed" })],
    }).filter((x) => x.text.includes("untested"));
    expect(one[0]).toMatchObject({ subject: "alice", text: "1 host/service cell untested" });
  });

  it("never sprayed at the usernames", () => {
    const hosts = [host("A", { os: "windows" })];
    const base = { hosts, byOwner: { A: FOOT_DONE }, services: { A: [svc("A", 445, "microsoft-ds")] }, credentials: [cred()], usernames: [uname("u1")], attempts: [attempt({ hostId: "A", service: "smb", port: 445 })] };
    const l = run(base).filter((x) => x.text.includes("never sprayed"));
    expect(l).toEqual([{ area: "credentials", subject: "alice", text: "never sprayed at the usernames", hostId: null, goalId: "cred-routine-spray-users" }]);
    const done = run({ ...base, byOwner: { ...base.byOwner, e1: { "cred-routine-spray-users": { status: "done" } } } });
    expect(done.filter((x) => x.text.includes("never sprayed"))).toEqual([]);
  });

  it("credentials read with their domain: CORP\\admin and a local admin are two subjects (RAV-22)", () => {
    const hosts = [host("A", { os: "windows" })];
    const l = run({
      hosts, byOwner: { A: FOOT_DONE }, services: { A: [svc("A", 445, "microsoft-ds")] }, usernames: [uname("u1")],
      credentials: [cred({ id: "c1", username: "admin", domain: "CORP" }), cred({ id: "c2", username: "admin", domain: null, scope: "local", localHostId: "A" })],
      attempts: [attempt({ credId: "c1", hostId: "A", service: "smb", port: 445 }), attempt({ credId: "c2", hostId: "A", service: "smb", port: 445 })],
    }).filter((x) => x.area === "credentials");
    const subjects = l.map((x) => x.subject);
    expect(subjects).toContain("CORP\\admin");
    expect(subjects).toContain("admin");
    expect(new Set(l.map((x) => `${x.subject}|${x.text}`)).size).toBe(l.length);
  });

  it("usernames not AS-REP-checked", () => {
    const hosts = [host("DC", { os: "windows", adSetEffective: true })];
    const base = { hosts, byOwner: { DC: FOOT_DONE }, services: { DC: [svc("DC", 88, "kerberos-sec"), svc("DC", 389, "ldap")] }, usernames: [uname("u1"), uname("u2")] };
    const l = run(base).filter((x) => x.text.includes("AS-REP"));
    expect(l).toEqual([{ area: "credentials", subject: null, text: "2 usernames not yet AS-REP-checked", hostId: null, goalId: "e-ad-user-asrep" }]);
    const nocreds = run({ ...base, usernames: [uname("u1")], byOwner: { ...base.byOwner, e1: { "e-ad-nocreds-asrep": { status: "in_progress" } } } });
    expect(nocreds.find((x) => x.text.includes("AS-REP"))).toMatchObject({ text: "1 username not yet AS-REP-checked", goalId: "e-ad-nocreds-asrep" });
    const done = run({ ...base, byOwner: { ...base.byOwner, e1: { "e-ad-user-asrep": { status: "done" } } } });
    expect(done.filter((x) => x.text.includes("AS-REP"))).toEqual([]);
  });

  it("access you have not reviewed", () => {
    const hosts = [host("A", { name: "WEB" })];
    const common = { hosts, byOwner: { A: { ...FOOT_DONE, "h-pe-proof": { status: "done" as const } } }, services: { A: [] }, credentials: [cred()] };
    const l = run({ ...common, attempts: [attempt({ result: "admin" })] });
    expect(l).toEqual([{ area: "lateral", subject: "WEB", text: "alice has ssh admin access you have not reviewed", hostId: "A" }]);
    expect(run({ ...common, hosts: [host("A", { accessReviewedAt: 99 })], attempts: [attempt({ result: "admin" })] })).toEqual([]);
    const byName = run({ ...common, credentials: [], usernames: [uname("u1")], attempts: [attempt({ usernameId: "u1", credId: "c9" })] });
    expect(byName[0]).toMatchObject({ subject: "WEB", text: "u-u1 has ssh valid access you have not reviewed" });
  });

  it("dual-homed without a tunnel", () => {
    const hosts = [host("A", { dualHomed: true })];
    const l = run({ hosts, byOwner: { A: { ...FOOT_DONE, "h-pe-proof": { status: "done" } } } });
    expect(l).toEqual([{ area: "lateral", subject: "A", text: "dual-homed, no tunnel recorded", hostId: "A", goalId: "h-pivot-tunnel" }]);
    const tunnel = { viaHostId: "A", engagementId: "e1" } as Tunnel;
    expect(run({ hosts, byOwner: { A: { ...FOOT_DONE, "h-pe-proof": { status: "done" } } }, tunnels: [tunnel] })).toEqual([]);
  });

  it("ignores another engagement's credentials, usernames and attempts", () => {
    const l = run({ hosts: [host("A")], byOwner: { A: { ...FOOT_DONE, "h-pe-proof": { status: "done" } } }, services: { A: [svc("A", 22, "ssh")] }, credentials: [cred({ engagementId: "other" })] });
    expect(l).toEqual([]);
  });

  it("lines are ordered foothold, credentials, privesc, lateral", () => {
    const hosts = [host("A", { dualHomed: true }), host("B"), host("C")];
    const l = run({
      hosts, byOwner: { B: FOOT_DONE },
      services: { A: [svc("A", 80)], B: [svc("B", 80), svc("B", 22, "ssh")], C: [] }, credentials: [cred()],
    });
    const areas = l.map((x) => x.area);
    const order = ["foothold", "credentials", "privesc", "lateral"];
    expect(new Set(areas)).toEqual(new Set(order));
    expect([...areas].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(areas);
  });

  it("the subject is its own field: no line joins it to the state with a dash", () => {
    const hosts = [host("A", { dualHomed: true }), host("B")];
    const l = run({ hosts, byOwner: { B: FOOT_DONE }, services: { A: [svc("A", 80)], B: [svc("B", 80), svc("B", 22, "ssh")] }, credentials: [cred()] });
    expect(l.length).toBeGreaterThan(3);
    for (const x of l) expect(x.text).not.toMatch(/ (—|·|→) /);
  });

  it("a tunnel of another engagement does not count", () => {
    const hosts = [host("A", { dualHomed: true })];
    const l = run({ hosts, byOwner: { A: { ...FOOT_DONE, "h-pe-proof": { status: "done" } } }, tunnels: [{ viaHostId: "A", engagementId: "other" } as Tunnel] });
    expect(l).toHaveLength(1);
  });

  it("a host with access set has a foothold even with no foothold goal done", () => {
    const l = run({ hosts: [host("A", { access: "user" })], services: { A: [svc("A", 80)] } });
    expect(l[0]).toMatchObject({ area: "privesc", hostId: "A" });
  });

  it("an ownerless secret is never sprayed, and an unknown subject is 'a credential'", () => {
    const hosts = [host("A", { os: "windows", access: "root" })];
    const l = run({
      hosts, byOwner: { A: { "h-pe-proof": { status: "done" } } }, services: { A: [svc("A", 445, "microsoft-ds")] },
      credentials: [cred({ username: "" })], usernames: [uname("u1")],
    });
    expect(l.find((x) => x.text.includes("never sprayed"))).toMatchObject({ subject: "secret with no owner", text: "never sprayed at the usernames" });
    const flag = run({
      hosts: [host("A", { name: "WEB", access: "root" })], byOwner: { A: { "h-pe-proof": { status: "done" } } },
      credentials: [cred({ id: "c9", username: "" })], attempts: [attempt({ credId: "c9" })],
    });
    expect(flag[0]).toMatchObject({ subject: "WEB", text: "a credential has ssh valid access you have not reviewed" });
  });

  describe("exam bans", () => {
    const h = host("A");
    const services = { A: [svc("A", 80)] };
    const goals = applicableGoals(h, engagement, [h], new Map([["A", services.A]]));
    const enumId = goals.find((s) => s.stage.id === "information-gathering")!.goals[0]!.id;
    const lib: LibraryCommand[] = [
      { id: "b", title: "b", tool: "t", template: "x", os: "any", runFrom: "attacker", goals: [enumId], exam: "banned", source: "raven" },
    ];
    const exam = { ...engagement, kind: "exam-sim" } as Engagement;
    const count = (l: ReturnType<typeof run>) => Number(/(\d+) enumeration/.exec(l[0]?.text ?? "")?.[1] ?? 0);
    it("excludes a goal with only banned commands in exam sim but counts it in lab", () => {
      const lab = run({ hosts: [h], services, library: lib });
      const ex = run({ hosts: [h], services, library: lib, engagement: exam });
      // The exam kind also adds the command-free Metasploit decision step, so compare like with like.
      const exWithoutBan = run({ hosts: [h], services, library: [], engagement: exam });
      expect(count(exWithoutBan)).toBe(count(ex) + 1);
      expect(count(lab)).toBe(count(ex));
      expect(ex[0]?.goalId).not.toBe(enumId);
    });
  });
});
