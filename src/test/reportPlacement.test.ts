import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import { buildPlainTarget, companionStepAt, targetChecks, isDeadEnd, joinsAStep, missingEntries, phaseInsertAt, proofCompanions, reportTargets, sourceOf, placedIn } from "../engines/report";
import type { ReportData, ReportNode, ReportTarget } from "../engines/report";
import { placementPlan, type PlacementPlan } from "../engines/report/placement";
import type { AccessGrant } from "../types/credentials";
import type { ChecklistItem } from "../types/checklist";
import type { FailedAttempt, Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { LogContent, LogEntry } from "../types/log";
import type { Hop } from "../types/network";
import type { Service } from "../types/service";

/** The entries a page or block places. */
const entriesOnPage = (n: ReportNode) => placedIn(n).entries;

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

/** Each of the plan's entries as `id role` (with its reason when not placed), in log order. */
const roles = (plan: PlacementPlan, d: ReportData) =>
  Object.fromEntries(d.log.flatMap((e) => {
    const p = plan.at(e.id);
    return p ? [[e.id, p.reason ? `${p.role} (${p.reason})` : p.role]] : [];
  }));

describe("placement plan roles", () => {
  it("gives every entry of the target one role, and a reason to each one not placed", () => {
    const d = windowsHost();
    expect(roles(placementPlan(d, target([H])), d)).toEqual({
      nmap: "scan",
      hydra: "not-placed (dead-end)",
      smbclient: "not-placed (dead-end)",
      ferox: "not-placed (proves-without-placing)",
      shot: "not-placed (not-near-a-step)",
      curl: "leads",
      winpeas: "not-placed (proves-nothing)",
      whoami: "not-placed (proves-without-placing)",
      printspoofer: "leads",
      flag: "leads",
      private: "not-placed (kept)",
    });
  });

  it("leads a step with hops into the host and finding steps", () => {
    const d = windowsHost();
    d.log.push(entry("psexec", H, 60, cmd("ok")), entry("step", H, 61, cmd("ok")));
    d.hops = [hop("other", H, "psexec", 60)];
    d.findings = [{ id: "f1", hostIds: [H], serviceIds: [], stepEntryIds: ["step"], refs: [] } as unknown as Finding];
    const plan = placementPlan(d, target([H]));
    expect(plan.at("psexec")?.role).toBe("leads");
    expect(plan.at("step")?.role).toBe("leads");
  });

  it("is built once per data and target", () => {
    const d = windowsHost();
    expect(placementPlan(d, target([H]))).toBe(placementPlan(d, { ...target([H]) }));
    expect(placementPlan(d, target([H]))).not.toBe(placementPlan({ ...d }, target([H])));
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

describe("placement plan findings", () => {
  it("names the machine and phase each finding was placed under; one that enabled none is additional", () => {
    const d = walked();
    d.findings.push(finding("info", { severity: "info", stepEntryIds: ["curl"] }));
    const map = placementPlan(d, target([H])).findings;
    expect(Object.fromEntries(map)).toEqual({
      rce: { hostId: H, phase: "foothold" },
      priv: { hostId: H, phase: "privesc" },
      info: { hostId: H, phase: "additional" },
    });
  });

  it("places an AD finding once, at the machine of its first step", () => {
    const d = adSet();
    d.findings = [{ id: "f-da", hostIds: ["h-ad02", "h-dc01"], serviceIds: [], stepEntryIds: ["ad-dump", "dc-psexec"], severity: "critical", refs: [] } as unknown as Finding];
    expect(placementPlan(d, target(AD_HOSTS, "ad-set")).findings.get("f-da")).toEqual({ hostId: "h-ad02", phase: "privesc" });
  });
});

describe("each step names its finding section", () => {
  it("a step of the phase's first finding goes under it, even after a step of another", () => {
    const d = windowsHost();
    d.log.push(entry("upload", H, 15, cmd("uploaded")));
    d.findings = [
      finding("rce", { title: "File upload to RCE", stepEntryIds: ["ferox", "curl"], createdAt: 1 }),
      finding("creds", { title: "Default credentials", stepEntryIds: ["upload"], createdAt: 2 }),
    ];
    const plan = placementPlan(d, target([H]));
    expect(plan.at("ferox")?.section?.finding?.id).toBe("rce");
    expect(plan.at("upload")?.section?.finding?.id).toBe("creds");
    expect(plan.at("curl")?.section?.finding?.id).toBe("rce");
  });

  it("a step of no finding goes under the section of the step before it", () => {
    const d = windowsHost();
    d.log.push(entry("upload", H, 15, cmd("uploaded")), entry("hop-in", H, 25, cmd("ok")));
    d.hops = [hop(null, H, "hop-in", 25)];
    d.findings = [
      finding("rce", { title: "File upload to RCE", stepEntryIds: ["ferox"], createdAt: 1 }),
      finding("creds", { title: "Default credentials", stepEntryIds: ["upload"], createdAt: 2 }),
    ];
    const plan = placementPlan(d, target([H]));
    expect(plan.at("curl")?.section?.finding?.id).toBe("creds");
  });
});

/** The exam engagement's report data as the audit serves it. */
function examData(): ReportData {
  const E = "e-exam";
  const hosts = FIXTURES.hosts.filter((h) => h.engagementId === E);
  const ids = new Set(hosts.map((h) => h.id));
  return {
    engagement: FIXTURES.engagements.find((e) => e.id === E)!,
    hosts,
    services: FIXTURES.services.filter((s) => ids.has(s.hostId)),
    log: FIXTURES.log.filter((e) => e.engagementId === E),
    checklist: FIXTURES.checklist.filter((c) => ids.has(c.ownerId) || c.ownerId === E),
    findings: FIXTURES.findings.filter((f) => f.engagementId === E),
    findingFiles: FIXTURES.findingFiles,
    attempts: FIXTURES.failedAttempts.filter((a) => a.engagementId === E),
    ruledOut: FIXTURES.ruledOut.filter((r) => r.engagementId === E),
    grants: FIXTURES.accessGrants.filter((g) => g.engagementId === E),
    usernames: FIXTURES.usernames.filter((u) => u.engagementId === E),
    hops: FIXTURES.hops.filter((h) => h.engagementId === E),
    cleanup: FIXTURES.cleanup.filter((c) => c.engagementId === E),
    notes: FIXTURES.notes.filter((n) => n.engagementId === E),
    credentials: FIXTURES.credentials.filter((c) => c.engagementId === E),
    credAttempts: FIXTURES.credAttempts.filter((c) => c.engagementId === E),
  };
}

const exam = examData();
const garnet = garnetFixtures(1_700_000_000_000);
const garnetTarget: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
const examCases: [string, ReportData, ReportTarget][] = [
  ["garnet", garnet, garnetTarget],
  ...reportTargets(exam, {}).map((t): [string, ReportData, ReportTarget] => [t.key, exam, t]),
];
const ofTarget = (d: ReportData, t: ReportTarget) => d.log.filter((e) => e.hostIds.some((h) => t.hostIds.includes(h)));

/** A plan as text: each machine, its scan, its sections in page order with their numbered steps (each entry with its
 *  role and phase), its Additional findings, then the entries it doesn't place with their reason and phase. */
function outline(d: ReportData, plan: PlacementPlan): string[] {
  const label = (id: string) => {
    const p = plan.at(id)!;
    return `${id} ${p.role} ${p.phase}`;
  };
  const out: string[] = [];
  for (const m of plan.machines) {
    out.push(`machine ${m.hostId}`);
    if (m.scan) out.push(`  scan ${m.scan.id}`);
    for (const s of m.sections) {
      out.push(`  ${s.phase}${s.finding ? `: ${s.finding.title}` : ""}`);
      s.steps.forEach((st, i) => {
        out.push(`    ${i + 1}. lead ${st.lead.id}`);
        for (const e of st.entries) out.push(`       ${label(e.id)}`);
      });
    }
    for (const f of m.additional) out.push(`  additional: ${f.title}`);
  }
  for (const e of ofTarget(d, plan.target)) {
    const p = plan.at(e.id)!;
    if (p.role === "not-placed") out.push(`not placed ${e.id} ${p.reason} ${p.hostId} ${p.phase}`);
  }
  return out;
}

describe("the placement plan on the exam fixtures", () => {
  it.each(examCases)("%s: machines, phases, finding sections, steps and roles", (_, d, t) => {
    expect(outline(d, placementPlan(d, t))).toMatchSnapshot();
  });

  it.each(examCases)("%s: places each entry of the target exactly once, and answers for every one", (_, d, t) => {
    const plan = placementPlan(d, t);
    const inSteps = plan.machines.flatMap((m) => m.sections.flatMap((s) => s.steps.flatMap((st) => st.entries.map((e) => e.id))));
    const scans = plan.machines.flatMap((m) => (m.scan ? [m.scan.id] : []));
    const withFindings = [...plan.findingFigures.values()].flat().map((e) => e.id);
    const placed = [...inSteps, ...scans, ...withFindings];
    expect(placed.length).toBe(new Set(placed).size);
    expect(new Set(placed)).toEqual(new Set(plan.placed));
    for (const e of ofTarget(d, t)) {
      const p = plan.at(e.id)!;
      expect([e.id, p.role === "not-placed"]).toEqual([e.id, !plan.placed.has(e.id)]);
      expect([e.id, p.reason === null]).toEqual([e.id, p.role !== "not-placed"]);
    }
  });

  it("garnet: steps lead, screenshots and the proof read go with their flag, dead ends and kept entries never place", () => {
    const plan = placementPlan(garnet, garnetTarget);
    const at = (k: string) => plan.at(`l-garnet-${k}`)!;
    expect(at("nmap").role).toBe("scan");
    for (const k of ["version", "ferox", "console", "revshell", "shell", "sudo", "gtfo", "find", "root"]) expect([k, at(k).role]).toEqual([k, "leads"]);
    for (const k of ["local-shot", "proof-read", "proof-shot"]) expect([k, at(k).role]).toEqual([k, "with-flag"]);
    expect(at("ftp").reason).toBe("dead-end");
    expect(at("private").reason).toBe("kept");
    expect(at("nosudo").reason).toBe("kept");
    expect(at("version").section?.finding?.title).toBe("Jenkins script console with default credentials");
    expect(at("sudo").section?.finding?.title).toBe("Unrestricted sudo rule for find");
    expect(at("proof").phase).toBe("post");
    expect(at("proof").section).toBe(at("root").section);
  });
});

describe("placing on a page that exists: the plan says where, the page says what's there", () => {
  const draft = buildPlainTarget(garnet, garnetTarget, {});
  const gid = (k: string) => `l-garnet-${k}`;
  const holds = (n: ReportNode, k: string) => entriesOnPage(n).has(gid(k));
  const withoutSteps = (...keys: string[]): ReportNode => ({ ...draft, content: draft.content!.filter((n) => !keys.some((k) => holds(n, k))) });
  const logged = (k: string) => garnet.log.find((e) => e.id === gid(k))!;
  const at = (doc: ReportNode, source: string) => doc.content!.findIndex((n) => sourceOf(n) === source);

  it("a new step goes at the end of its phase, before the next heading", () => {
    const page = withoutSteps("find");
    expect(phaseInsertAt(page, garnet, garnetTarget, logged("find"))).toEqual({ index: at(page, `phase:${GARNET_HOST}:additional`), before: [] });
  });

  it("a phase with no heading yet gets its heading and Steps to reproduce first, where the phase belongs", () => {
    const content = draft.content!;
    const from = content.findIndex((n) => (sourceOf(n) ?? "").startsWith(`phase:${GARNET_HOST}:privesc`));
    const to = content.findIndex((n) => sourceOf(n) === `phase:${GARNET_HOST}:additional`);
    const page = { ...draft, content: [...content.slice(0, from), ...content.slice(to)] };
    const { index, before } = phaseInsertAt(page, garnet, garnetTarget, logged("sudo"));
    expect(index).toBe(from);
    expect(before.map((n) => [n.type, sourceOf(n)])).toEqual([
      ["heading", `phase:${GARNET_HOST}:privesc`],
      ["paragraph", `phase-steps:${GARNET_HOST}`],
    ]);
  });

  it("a screenshot that goes with a flag joins the page's step holding that flag", () => {
    const page = { ...draft, content: draft.content!.map((n) => (holds(n, "shell") ? { ...n, content: n.content!.filter((b) => b.type !== "figure") } : n)) };
    const joins = companionStepAt(page, garnet, garnetTarget, logged("local-shot"))!;
    expect(joins.index).toBe(page.content!.findIndex((n) => holds(n, "shell")));
    expect(joins.blocks.map((b) => [b.type, b.attrs?.entryId])).toEqual([["figure", gid("local-shot")]]);
    expect(joinsAStep(garnet, garnetTarget, logged("local-shot"))).toBe(true);
  });

  it("an entry that leads its step, or a page without the step, gets a step of its own", () => {
    expect(companionStepAt(draft, garnet, garnetTarget, logged("version"))).toBeNull();
    expect(joinsAStep(garnet, garnetTarget, logged("version"))).toBe(false);
    expect(companionStepAt(withoutSteps("shell"), garnet, garnetTarget, logged("local-shot"))).toBeNull();
  });
});

describe("screenshots on findings: each placed once, only with its finding", () => {
  const gid = (k: string) => `l-garnet-${k}`;
  const logged = (d: ReportData, k: string) => d.log.find((e) => e.id === gid(k))!;
  /** garnet with a screenshot logged at `at` (minutes after `after`'s time; negative: before) and linked to a finding's
   *  steps at `index`. */
  function withShot(findingTitle: string, index: number, after: string, minutes: number, caption = "the repository listing"): ReportData {
    const at = logged(garnet, after).at + minutes * 60_000;
    const shot: LogEntry = {
      ...logged(garnet, "local-shot"),
      id: gid("fshot"), title: caption, at, createdAt: at, updatedAt: at,
      content: { kind: "screenshot", attachmentId: "a-fshot", caption, fileName: "fshot.png" },
    };
    const findings = garnet.findings.map((f) =>
      f.title === findingTitle ? { ...f, stepEntryIds: [...f.stepEntryIds.slice(0, index), shot.id, ...f.stepEntryIds.slice(index)] } : f,
    );
    return { ...garnet, log: [...garnet.log, shot], findings };
  }
  const figuresOf = (doc: ReportNode, id: string): ReportNode[] => {
    const out: ReportNode[] = [];
    const walk = (n: ReportNode) => {
      if (n.type === "figure" && n.attrs?.entryId === id) out.push(n);
      n.content?.forEach(walk);
    };
    walk(doc);
    return out;
  };
  const stepHolding = (doc: ReportNode, id: string) => doc.content!.filter((n) => n.type === "list" && n.attrs?.kind === "ordered" && entriesOnPage(n).has(id));

  it("one linked to a finding and taken within the tag-along window of another step appears exactly once, with its finding's step", () => {
    // Taken a minute after the dump (that step's tag-along window), linked after `show` in the git finding's steps.
    const d = withShot("Jenkins script console with default credentials", 3, "ferox", 1);
    const plan = placementPlan(d, garnetTarget);
    const p = plan.at(gid("fshot"))!;
    expect(p.role).toBe("illustrates");
    expect(p.step?.lead.id).toBe(gid("console"));
    expect(p.step?.entries.at(-1)?.id).toBe(gid("fshot"));
    const doc = buildPlainTarget(d, garnetTarget, {});
    expect(figuresOf(doc, gid("fshot"))).toHaveLength(1);
    expect(stepHolding(doc, gid("fshot"))).toHaveLength(1);
    expect(entriesOnPage(stepHolding(doc, gid("fshot"))[0]).has(gid("console"))).toBe(true);
  });

  it("one listed before every other step goes with the step after it", () => {
    const d = withShot("Jenkins script console with default credentials", 0, "version", -1);
    expect(placementPlan(d, garnetTarget).at(gid("fshot"))?.step?.lead.id).toBe(gid("version"));
  });

  it("never goes with a flag, even when it names one and was taken beside it", () => {
    const d = withShot("Unrestricted sudo rule for find", 4, "proof", 1, "proof.txt on garnet");
    const plan = placementPlan(d, garnetTarget);
    expect(plan.at(gid("fshot"))?.role).toBe("illustrates");
    expect(plan.at(gid("fshot"))?.step?.lead.id).toBe(gid("root"));
    expect(proofCompanions(d, GARNET_HOST, logged(d, "proof")).map((e) => e.id)).not.toContain(gid("fshot"));
    expect(figuresOf(buildPlainTarget(d, garnetTarget, {}), gid("fshot"))).toHaveLength(1);
  });

  it("a flag's screenshot that is also goal evidence stays with the flag's proof, placed once", () => {
    // proof.txt's screenshot also ticks a checklist goal: it proves something without placing.
    const d: ReportData = {
      ...garnet,
      checklist: [...garnet.checklist, { ...garnet.checklist[0], goalId: "h-root", evidence: [{ entryId: gid("proof-shot") }] }],
    };
    expect(proofCompanions(d, GARNET_HOST, logged(d, "proof")).map((e) => e.id)).toContain(gid("proof-shot"));
    expect(placementPlan(d, garnetTarget).at(gid("proof-shot"))?.role).toBe("with-flag");
    expect(figuresOf(buildPlainTarget(d, garnetTarget, {}), gid("proof-shot"))).toHaveLength(1);
    // The checks read the proof from these too: it has its screenshot.
    const page = buildPlainTarget(d, garnetTarget, {});
    expect(targetChecks({ data: d, target: garnetTarget, doc: page, meta: { expectedFlags: { [GARNET_HOST]: ["proof"] } }, sectionId: "s" }).map((c) => c.id)).not.toContain(
      `proof-screenshot:garnet:proof`,
    );
  });

  it("on an Additional finding, goes under that finding's bullet", () => {
    const d = withShot("Weak backup password", 0, "sudo", 2, "the backup archive");
    const plan = placementPlan(d, garnetTarget);
    const p = plan.at(gid("fshot"))!;
    expect(p.role).toBe("with-finding");
    expect(p.finding?.title).toBe("Weak backup password");
    expect(p.step).toBeNull();
    const doc = buildPlainTarget(d, garnetTarget, {});
    expect(figuresOf(doc, gid("fshot"))).toHaveLength(1);
    const bullet = doc.content!.find((n) => sourceOf(n) === "finding:f-garnet-zip")!;
    expect(figuresOf(bullet, gid("fshot"))).toHaveLength(1);
    expect(stepHolding(doc, gid("fshot"))).toEqual([]);
  });

  it("Add new evidence puts it back where the draft has it, once", () => {
    const d = withShot("Weak backup password", 0, "sudo", 2, "the backup archive");
    const draft = buildPlainTarget(d, garnetTarget, {});
    const page = { ...draft, content: draft.content!.map((n) => (sourceOf(n) === "finding:f-garnet-zip" ? { ...n, content: n.content!.filter((b) => b.type !== "figure") } : n)) };
    expect(missingEntries(page, d, garnetTarget, []).map((e) => e.id)).toEqual([gid("fshot")]);
    const joins = companionStepAt(page, d, garnetTarget, logged(d, "fshot"))!;
    expect(sourceOf(page.content![joins.index])).toBe("finding:f-garnet-zip");
    expect(joins.blocks.map((b) => [b.type, b.attrs?.entryId])).toEqual([["figure", gid("fshot")]]);
    expect(joinsAStep(d, garnetTarget, logged(d, "fshot"))).toBe(true);
  });

  it("one kept from the report is never placed", () => {
    const base = withShot("Jenkins script console with default credentials", 3, "ferox", 1);
    const d = { ...base, log: base.log.map((e) => (e.id === gid("fshot") ? { ...e, private: true } : e)) };
    expect(placementPlan(d, garnetTarget).at(gid("fshot"))?.reason).toBe("kept");
    expect(figuresOf(buildPlainTarget(d, garnetTarget, {}), gid("fshot"))).toEqual([]);
  });
});
