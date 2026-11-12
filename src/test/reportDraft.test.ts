import { describe, expect, it } from "vitest";
import {
  addNewEvidence,
  buildTargetDraft,
  defaultKeep,
  DRAFT_LAYOUT,
  endOfPhase,
  evidenceBlocks,
  evidenceIdsIn,
  findingPhaseMap,
  isDeadEnd,
  placingEntries,
  provingEntries,
  REPRODUCE_LABEL,
  STEP_HINT,
  stepNode,
  stepsNode,
} from "../engines/report";
import type { ReportData, ReportNode, ReportTarget } from "../engines/report";
import type { AccessGrant } from "../types/credentials";
import type { ChecklistItem } from "../types/checklist";
import type { FailedAttempt, Finding, FindingFile } from "../types/findings";
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
  ({ id: `s-${hostId}-${port}`, hostId, port, confirmedEntryId }) as Service;
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

const phasesOf = (doc: ReportNode) =>
  (doc.content ?? []).filter((n) => n.type === "phase").map((n) => n.attrs?.phase as string);

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

describe("defaultKeep", () => {
  it("keeps everything up to 60 lines, else the first 40", () => {
    expect(defaultKeep(12)).toBeNull();
    expect(defaultKeep(60)).toBeNull();
    expect(defaultKeep(61)).toEqual([[0, 39]]);
  });
});

const STEP_HINT_TEXT = "Say what this step does";
const FLAG_HINT_TEXT = "Say where you read the flag";
const EXPLAIN_HINT_TEXT = "Explain each change";

const topLevel = (doc: ReportNode) => doc.content ?? [];

/** Every node of the page, depth first. */
function allNodes(doc: ReportNode): ReportNode[] {
  const out: ReportNode[] = [];
  const walk = (n: ReportNode) => {
    out.push(n);
    n.content?.forEach(walk);
  };
  topLevel(doc).forEach(walk);
  return out;
}

/** The step that holds an entry's evidence (or was drafted from it). */
function stepOf(doc: ReportNode, entryId: string): ReportNode {
  const step = allNodes(doc).find(
    (n) => n.type === "step" && (n.attrs?.entryId === entryId || (n.content ?? []).some((c) => c.type === "evidence" && c.attrs?.entryId === entryId)),
  );
  if (!step) throw new Error(`no step holds ${entryId}`);
  return step;
}

const firstSteps = (doc: ReportNode) => topLevel(doc).find((n) => n.type === "steps")!;

/** The page as a readable outline: phases, steps lists ([ … ]) and their steps (-), slots (S: a step's sentence, SF: a
 *  flag's, S:<hint> any other), evidence ids, vulns (V:id), exploits (X:id), generated kinds (G:kind). */
function outline(doc: ReportNode): string[] {
  const out: string[] = [];
  const walk = (n: ReportNode) => {
    if (n.type === "phase") out.push(`# ${n.attrs?.phase}`);
    else if (n.type === "steps") {
      out.push("[");
      n.content?.forEach(walk);
      out.push("]");
    } else if (n.type === "step") {
      out.push("-");
      n.content?.forEach(walk);
    } else if (n.type === "slot") {
      const hint = n.attrs?.hint;
      out.push(hint === STEP_HINT_TEXT ? "S" : hint === FLAG_HINT_TEXT ? "SF" : `S:${hint}`);
    } else if (n.type === "evidence") out.push(n.attrs?.entryId as string);
    else if (n.type === "vuln") out.push(`V:${n.attrs?.findingId}`);
    else if (n.type === "exploit") out.push(`X:${n.attrs?.fileId}`);
    else if (n.type === "paragraph") out.push("P");
    else out.push(`G:${n.attrs?.kind}`);
  };
  topLevel(doc).forEach(walk);
  return out;
}

/** The entry ids of the evidence under one phase heading, steps included. */
function evidenceUnder(doc: ReportNode, phase: string, hostId = H): string[] {
  const out: string[] = [];
  let inPhase = false;
  const collect = (n: ReportNode) => {
    if (n.type === "evidence") out.push(n.attrs?.entryId as string);
    n.content?.forEach(collect);
  };
  for (const n of topLevel(doc)) {
    if (n.type === "phase") inPhase = n.attrs?.phase === phase && n.attrs?.hostId === hostId;
    else if (inPhase) collect(n);
  }
  return out;
}

const uniquePhases = (doc: ReportNode) => [...new Set(phasesOf(doc))];

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

const standalone = (hostId: string): ReportTarget => target([hostId]);

describe("the short draft (layout 4)", () => {
  const H1 = "h1";
  function lab(): ReportData {
    const d = empty();
    d.hosts = [host(H1, "lnx")];
    d.log = [
      entry("e1", H1, 0, { kind: "command", blocks: [{ command: "nmap -sV 10.0.0.9", output: "80/tcp open http" }] }),
      entry("e2", H1, 10, { kind: "command", blocks: [{ command: "nc -lvnp 443", output: "uid=33(www-data)" }] }),
      entry("e3", H1, 20, { kind: "flag", flagKind: "local", value: "f00" }),
    ];
    d.checklist = [goal(H1, ["e1"])];
    d.services = [service(H1, 80, "e1")];
    d.grants = [grant(H1, "user", "e2", 10)];
    return d;
  }
  const data = lab();
  const doc = buildTargetDraft(data, standalone(H1), {});

  it("places only access, hop, flag and finding-step entries; goal and service entries stay off the page", () => {
    expect([...placingEntries(data, H1)].sort()).toEqual(["e2", "e3"]);
    expect([...evidenceIdsIn(doc)].sort()).toEqual(["e2", "e3"]);
  });

  it("puts a finding's walkthrough in one numbered steps list, one step per placed entry", () => {
    const steps = topLevel(doc).filter((n) => n.type === "steps");
    expect(steps).toHaveLength(1);
    expect(steps[0].content!.map((s) => s.attrs!.entryId)).toEqual(["e2", "e3"]);
    expect(steps[0].content![0].content![0]).toMatchObject({ type: "slot", attrs: { hint: "Say what this step does" } });
    expect(steps[0].content![1].content![0]).toMatchObject({ type: "slot", attrs: { hint: "Say where you read the flag" } });
    expect(JSON.stringify(doc)).not.toContain("Steps to reproduce");
  });

  it("a screenshot joins the step before it", () => {
    const d = lab();
    d.log.push(entry("shot1", H1, 12, shot));
    const withShot = buildTargetDraft(d, standalone(H1), {});
    expect(stepOf(withShot, "e2").content!.map((n) => n.attrs?.entryId)).toContain("shot1");
    expect(firstSteps(withShot).content).toHaveLength(2);
  });

  it("opens every machine with facts, result, enum heading and ports, and never emits port-scan or attack-chain", () => {
    expect(topLevel(doc).slice(0, 4).map((n) => n.attrs?.kind ?? n.attrs?.phase)).toEqual(["facts", "result", "enum", "ports"]);
    expect(topLevel(doc)[3]).toEqual({ type: "generated", attrs: { kind: "ports", hostId: H1, appendix: "inline", notes: {} } });
    const adDoc = buildTargetDraft(adSet(), target(AD_HOSTS, "ad-set"), {});
    expect(JSON.stringify(adDoc)).not.toMatch(/"port-scan"|"attack-chain"/);
    for (const id of AD_HOSTS) {
      const facts = topLevel(adDoc).findIndex((n) => n.attrs?.kind === "facts" && n.attrs?.hostId === id);
      expect(topLevel(adDoc).slice(facts, facts + 4).map((n) => n.attrs?.kind ?? n.attrs?.phase)).toEqual(["facts", "result", "enum", "ports"]);
    }
  });

  it("opens the AD set with the attack-path table", () => {
    const adDoc = buildTargetDraft(adSet(), target(AD_HOSTS, "ad-set"), {});
    expect(adDoc.content![0]).toMatchObject({ type: "generated", attrs: { kind: "attack-path", hostId: null } });
  });

  it("an exploit file sits inside the step whose command names it", () => {
    const d = lab();
    d.log.push(entry("run46153", H1, 8, { kind: "command", blocks: [{ command: "python3 46153.py -t 10.0.0.9", output: "sent" }] }));
    d.findings = [{ id: "f1", title: "RCE", hostIds: [H1], serviceIds: [], stepEntryIds: ["run46153", "e2"], severity: "high", refs: [] } as unknown as Finding];
    d.findingFiles = [{ id: "edb", findingId: "f1", name: "exploits/46153.py", modified: true } as FindingFile];
    const withExploit = buildTargetDraft(d, standalone(H1), {});
    expect(stepOf(withExploit, "run46153").content!.some((n) => n.type === "exploit")).toBe(true);
    expect(stepOf(withExploit, "e2").content!.some((n) => n.type === "exploit")).toBe(false);
  });

  it("addNewEvidence appends a new placed entry as the last step of its phase's list, before the local flag step", () => {
    const withNewStep = lab();
    withNewStep.log.push(entry("e9", H1, 5, cmd("found creds")));
    withNewStep.findings = [{ id: "f9", title: "Creds in config", hostIds: [H1], serviceIds: [], stepEntryIds: ["e9"], severity: "high", refs: [] } as unknown as Finding];
    const { doc: next, added } = addNewEvidence(doc, withNewStep, standalone(H1), {}, []);
    expect(added).toEqual(["e9"]);
    const ids = firstSteps(next).content!.map((s) => s.attrs!.entryId);
    expect(ids).toEqual(["e2", "e9", "e3"]);
    expect(ids.indexOf("e9")).toBe(ids.indexOf("e3") - 1);
  });

  it("endOfPhase returns a path inside the phase's steps list", () => {
    const d = lab();
    const late = entry("late", H1, 8, cmd("id"));
    d.log.push(late);
    const { at, nodes } = endOfPhase(doc, d, standalone(H1), late);
    expect(at.length).toBe(2);
    expect(at).toEqual([topLevel(doc).indexOf(firstSteps(doc)), 1]);
    expect(nodes[0].type).toBe("step");
    expect(nodes[0].attrs).toEqual({ entryId: "late" });
  });

  it("endOfPhase puts a flag's companion into the flag's step", () => {
    const d = lab();
    d.log = d.log.map((e) => (e.id === "e3" ? ({ ...e, content: { kind: "flag", flagKind: "local", value: "0123456789abcdef", attachmentId: "", proof: null } } as LogEntry) : e));
    const fresh = buildTargetDraft(d, standalone(H1), {});
    const read = entry("read", H1, 21, { kind: "command", blocks: [{ command: "cat local.txt", output: "0123456789abcdef" }] });
    d.log.push(read);
    const { at, nodes } = endOfPhase(fresh, d, standalone(H1), read);
    expect(at).toEqual([topLevel(fresh).indexOf(firstSteps(fresh)), 1, 2]);
    expect(nodes.map((n) => n.type)).toEqual(["evidence"]);
  });

  it("evidenceIdsIn finds evidence nested in steps", () => {
    expect(evidenceIdsIn(doc).has("e2")).toBe(true);
  });

  it("stepNode and stepsNode build the step vocabulary", () => {
    const e2 = data.log.find((e) => e.id === "e2")!;
    expect(stepNode([e2])).toEqual({
      type: "step",
      attrs: { entryId: "e2" },
      content: [{ type: "slot", attrs: { hint: STEP_HINT } }, ...evidenceBlocks(e2)],
    });
    const said = { ...e2, observations: "The listener caught the shell." };
    expect(stepNode([said]).content![0]).toMatchObject({ type: "paragraph", attrs: { fromEntry: "e2", fromField: "observations" } });
    expect(stepNode([])).toEqual({ type: "step", attrs: { entryId: null }, content: [{ type: "slot", attrs: { hint: STEP_HINT } }] });
    expect(stepsNode([stepNode([])])).toEqual({ type: "steps", content: [stepNode([])] });
  });

  it("keeps REPRODUCE_LABEL exported and moves the layout to 4", () => {
    expect(typeof REPRODUCE_LABEL).toBe("string");
    expect(DRAFT_LAYOUT).toBe(4);
  });
});

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

describe("buildTargetDraft", () => {
  it("lays a standalone host out in OffSec's sample order", () => {
    const doc = buildTargetDraft(walked(), target([H]), {});
    expect(doc.type).toBe("doc");
    expect(outline(doc)).toEqual([
      "G:facts", "G:result",
      "# enum", "G:ports",
      "# foothold", "V:rce", "[", "-", "S", "ferox", "shot", "-", "S", "curl", "]",
      "# privesc", "V:priv", "[", "-", "S", "whoami", "-", "S", "printspoofer", "]",
      "# post", "[", "-", "SF", "flag", "]",
      "# tested", "G:tested",
    ]);
  });

  it("starts each step with its sentence slot (a flag's says where it was read) and never references the private entry", () => {
    const doc = buildTargetDraft(walked(), target([H]), {});
    for (const step of allNodes(doc).filter((n) => n.type === "step")) {
      const flag = step.attrs?.entryId === "flag";
      expect(step.content![0]).toEqual({ type: "slot", attrs: { hint: flag ? FLAG_HINT_TEXT : STEP_HINT_TEXT } });
    }
    expect(JSON.stringify(doc)).not.toContain('"private"');
    expect(evidenceIdsIn(doc).has("private")).toBe(false);
  });

  it("shares one step between a command's blocks and the screenshot that came along with it", () => {
    const d = walked();
    d.log[3] = entry("ferox", H, 10, cmd("a", "b"));
    const step = stepOf(buildTargetDraft(d, target([H]), {}), "ferox");
    expect(step.content!.map((n) => (n.type === "slot" ? "S" : `${n.attrs?.entryId}:${n.attrs?.block}`))).toEqual(["S", "ferox:0", "ferox:1", "shot:null"]);
  });

  it("leaves port scans and goal evidence off the page: Service Enumeration holds the ports table only", () => {
    const d = walked();
    d.log.push(entry("rustscan", H, 1, { kind: "command", blocks: [{ command: "rustscan -a 10.0.0.5", output: "22 open" }] }));
    d.checklist.push(goal(H, ["rustscan"]));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "enum")).toEqual([]);
    expect(outline(doc).slice(2, 5)).toEqual(["# enum", "G:ports", "# foothold"]);
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "curl"]);
  });

  it("keeps a port scan a finding names as a step of Service Enumeration", () => {
    const d = walked();
    d.findings[0].stepEntryIds = ["nmap", "ferox", "curl"];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "enum")).toEqual(["nmap"]);
    expect(outline(doc).slice(2, 9)).toEqual(["# enum", "G:ports", "[", "-", "S", "nmap", "]"]);
  });

  it("ends Initial Access with the local flag's step and starts Post-Exploitation with the proof flag's", () => {
    const d = walked();
    // The local flag was logged after privesc had started; it still closes Initial Access.
    d.log.push(entry("local", H, 45, { kind: "flag", flagKind: "local", value: "xyz" }), entry("dump", H, 60, cmd("hashes")));
    d.findings[1].stepEntryIds.push("dump");
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "curl", "local"]);
    expect(evidenceUnder(doc, "privesc")).toEqual(["whoami", "printspoofer"]);
    expect(evidenceUnder(doc, "post")).toEqual(["flag", "dump"]);
    const footSteps = topLevel(doc).filter((n) => n.type === "steps")[0];
    expect(footSteps.content!.at(-1)!.attrs).toEqual({ entryId: "local" });
    const postSteps = topLevel(doc).filter((n) => n.type === "steps").at(-1)!;
    expect(postSteps.content!.map((s) => s.attrs?.entryId)).toEqual(["flag", "dump"]);
  });

  it("starts long outputs trimmed to the first 40 lines", () => {
    const d = walked();
    const long = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const twelve = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    d.log[3] = entry("ferox", H, 10, cmd(long, twelve));
    const nodes = allNodes(buildTargetDraft(d, target([H]), {})).filter((n) => n.type === "evidence" && n.attrs?.entryId === "ferox");
    expect(nodes.map((n) => n.attrs?.keep)).toEqual([[[0, 39]], null]);
    expect(nodes[0].attrs).toEqual({ entryId: "ferox", block: 0, keep: [[0, 39]], emphasis: [], appendix: "inline" });
  });

  it("brings along a screenshot taken between two placed entries, not one outside them", () => {
    const d = walked();
    d.log.push(entry("midshot", H, 17, shot), entry("lateshot", H, 90, shot), entry("earlyshot", H, -10, shot), entry("flagshot", H, 56, shot));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "midshot", "curl"]);
    expect(evidenceUnder(doc, "post")).toEqual(["flag", "flagshot"]);
    expect(evidenceIdsIn(doc).has("lateshot")).toBe(false);
    expect(evidenceIdsIn(doc).has("earlyshot")).toBe(false);
  });

  it("does not treat access given before anything was logged as the foothold", () => {
    const d = walked();
    d.grants = [{ ...grant(H, "user", "", -60), logEntryId: null }];
    expect(uniquePhases(buildTargetDraft(d, target([H]), {}))).toEqual(["enum", "foothold", "post", "tested"]);
  });

  it("puts every step under Initial Access when no access was granted", () => {
    const d = walked();
    d.grants = [];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(uniquePhases(doc)).toEqual(["enum", "foothold", "post", "tested"]);
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "curl", "whoami", "printspoofer"]);
  });

  it("leaves Also tested out when nothing was tried and failed", () => {
    const d = walked();
    d.attempts = [];
    expect(uniquePhases(buildTargetDraft(d, target([H]), {}))).toEqual(["enum", "foothold", "privesc", "post"]);
  });

  it("opens a phase with its finding's vulnerability, then its steps; an exploit no step names goes inside the access step", () => {
    const d = windowsHost();
    d.findings = [finding("f1", { stepEntryIds: ["whoami", "printspoofer"] })];
    d.findingFiles = [{ id: "file1", findingId: "f1", name: "exploit.c", modified: true } as FindingFile];
    const lines = outline(buildTargetDraft(d, target([H]), {}));
    expect(lines.slice(lines.indexOf("# privesc"), lines.indexOf("# post"))).toEqual([
      "# privesc", "V:f1", "[", "-", "S", "whoami", "-", "S", "X:file1", `S:${EXPLAIN_HINT_TEXT}`, "printspoofer", "]",
    ]);
  });

  it("puts an exploit inside the step whose command runs it, else in a step of its own at the end of the phase", () => {
    const d = windowsHost();
    d.log[3] = entry("ferox", H, 10, { kind: "command", blocks: [{ command: "python3 46153.py -u admin -i http://10.0.0.5", output: "ok" }] });
    d.findings = [finding("f1", { stepEntryIds: ["ferox"] })];
    d.findingFiles = [
      { id: "edb", findingId: "f1", name: "exploits/46153.py", modified: true } as FindingFile,
      { id: "other", findingId: "f1", name: "notes.txt", modified: false } as FindingFile,
    ];
    d.grants = [];
    const doc = buildTargetDraft(d, target([H]), {});
    const lines = outline(doc);
    expect(lines.slice(lines.indexOf("# foothold"), lines.indexOf("# post"))).toEqual([
      "# foothold", "V:f1", "[", "-", "S", "X:edb", `S:${EXPLAIN_HINT_TEXT}`, "ferox", "shot", "-", "S", "X:other", "]",
    ]);
    expect(stepOf(doc, "ferox").attrs).toEqual({ entryId: "ferox" });
    expect(firstSteps(doc).content!.at(-1)!.attrs).toEqual({ entryId: null });
  });

  describe("findings, one per heading", () => {
    const f = finding;

    it("puts a second finding that enabled the phase under its own heading, with its own steps", () => {
      const d = windowsHost();
      d.findings = [f("f1", { stepEntryIds: ["ferox"] }), f("f2", { stepEntryIds: ["curl"] })];
      const doc = buildTargetDraft(d, target([H]), {});
      const lines = outline(doc);
      const at = lines.indexOf("# foothold");
      expect(lines.slice(at, lines.indexOf("# privesc"))).toEqual([
        "# foothold", "V:f1", "[", "-", "S", "ferox", "shot", "]",
        "# foothold", "V:f2", "[", "-", "S", "curl", "]",
      ]);
      const heads = doc.content!.filter((n) => n.type === "phase" && n.attrs?.phase === "foothold");
      expect(heads.map((n) => n.attrs?.findingId ?? null)).toEqual([null, "f2"]);
    });

    it("puts findings that enabled no phase under Additional findings, after Post-Exploitation, info last", () => {
      const d = windowsHost();
      d.findings = [
        f("rce", { stepEntryIds: ["curl"] }),
        f("winrm", { severity: "info", stepEntryIds: [] }),
        f("relay", { severity: "low", stepEntryIds: ["curl"] }),
        f("old", { severity: "medium", stepEntryIds: ["nmap"] }),
      ];
      const doc = buildTargetDraft(d, target([H]), {});
      const lines = (doc.content ?? []).map((n) => (n.type === "phase" ? `# ${n.attrs?.phase}${n.attrs?.findingId ? `:${n.attrs.findingId}` : ""}` : n.type === "vuln" ? `V:${n.attrs?.findingId}` : null)).filter(Boolean);
      expect(lines).toEqual([
        "# enum", "# foothold", "V:rce", "# privesc", "# post",
        "# additional", "# additional:old", "V:old", "# additional:relay", "V:relay", "# additional:winrm", "V:winrm",
        "# tested",
      ]);
    });

    it("puts an unlinked finding whose words are privilege escalation under Privilege Escalation, never Initial Access", () => {
      const d = windowsHost();
      d.findings = [
        f("potato", { severity: "critical", title: "SeImpersonatePrivilege to SYSTEM", createdAt: 1 }),
        f("rce", { severity: "critical", title: "File upload to RCE", createdAt: 2 }),
      ];
      const lines = outline(buildTargetDraft(d, target([H]), {}));
      expect(lines[lines.indexOf("# foothold") + 1]).toBe("V:rce");
      expect(lines[lines.indexOf("# privesc") + 1]).toBe("V:potato");
    });

    it("never lets a privilege escalation finding open Initial Access on severity, even when Privilege Escalation has its own", () => {
      const d = windowsHost();
      d.findings = [
        f("linked", { severity: "high", title: "Unquoted service path", stepEntryIds: ["whoami", "printspoofer"] }),
        f("potato", { severity: "critical", title: "SeImpersonatePrivilege to SYSTEM" }),
        f("rce", { severity: "medium", title: "File upload to RCE" }),
      ];
      const lines = outline(buildTargetDraft(d, target([H]), {}));
      expect(lines[lines.indexOf("# foothold") + 1]).toBe("V:rce");
      expect(lines[lines.indexOf("# privesc") + 1]).toBe("V:linked");
      expect(lines.indexOf("V:potato")).toBeGreaterThan(lines.indexOf("# additional"));
    });

    it("puts a new step under the finding it belongs to, not the phase's last finding", () => {
      const d = windowsHost();
      d.findings = [f("f1", { stepEntryIds: ["ferox", "late"] }), f("f2", { stepEntryIds: ["curl"] })];
      const doc = buildTargetDraft(d, target([H]), {});
      d.log.push(entry("late", H, 15, cmd("more")));
      const res = addNewEvidence(doc, d, target([H]), {}, []);
      expect(res.added).toEqual(["late"]);
      const lines = outline(res.doc);
      const second = lines.findIndex((l, i) => l === "# foothold" && i > lines.indexOf("# foothold"));
      expect(lines.slice(lines.indexOf("V:f1"), second)).toEqual(["V:f1", "[", "-", "S", "ferox", "shot", "-", "S", "late", "]"]);
    });

    it("keeps an unlinked finding (an imported one) as the one that opened the box when no finding did", () => {
      const d = windowsHost();
      d.findings = [f("note", { severity: "info" }), f("rce", { severity: "critical" }), f("weak", { severity: "medium" })];
      const lines = outline(buildTargetDraft(d, target([H]), {}));
      expect(lines.slice(lines.indexOf("# foothold"), lines.indexOf("# foothold") + 2)).toEqual(["# foothold", "V:rce"]);
      expect(lines.filter((l) => l.startsWith("V:"))).toEqual(["V:rce", "V:weak", "V:note"]);
    });
  });

  describe("a flag's companions", () => {
    const HASH = "0123456789abcdef0123456789abcdef";
    const withBareFlag = () => {
      const d = walked();
      d.log = d.log.map((e) => (e.id === "flag" ? ({ ...e, content: { kind: "flag", flagKind: "proof", value: HASH, attachmentId: "", proof: null } } as LogEntry) : e));
      d.log.push(
        entry("read", H, 56, { kind: "command", blocks: [{ command: "type proof.txt; whoami; ipconfig", output: `${HASH}\nnt authority\\system` }] }),
        entry("proofshot", H, 57, shot),
      );
      return d;
    };

    it("never moves a placed entry: a finding's step that prints the flag stays in its phase, and its finding with it", () => {
      const d = withBareFlag();
      // The root session that ran the exploit also read proof.txt: it is the finding's step.
      d.log = d.log.map((e) => (e.id === "printspoofer" ? ({ ...e, content: { kind: "command", blocks: [{ command: "PrintSpoofer64.exe -i -c cmd", output: "nt authority\\system" }, { command: "type proof.txt", output: HASH }] } } as LogEntry) : e));
      d.log = d.log.filter((e) => e.id !== "read");
      const doc = buildTargetDraft(d, target([H]), {});
      expect(evidenceUnder(doc, "privesc")).toEqual(["whoami", "printspoofer", "printspoofer"]);
      expect(evidenceUnder(doc, "post")).toEqual(["flag", "proofshot"]);
      expect(outline(doc).filter((l) => l === "V:priv")).toHaveLength(1);
      expect(outline(doc)[outline(doc).indexOf("# privesc") + 1]).toBe("V:priv");
      expect(phasesOf(doc)).not.toContain("additional");
    });

    it("go into the flag's step, once, and never as steps of their own", () => {
      const doc = buildTargetDraft(withBareFlag(), target([H]), {});
      expect(stepOf(doc, "flag").content!.map((n) => (n.type === "slot" ? "SF" : n.attrs?.entryId))).toEqual(["SF", "flag", "read", "proofshot"]);
      expect(outline(doc).filter((l) => l === "read")).toHaveLength(1);
      expect(allNodes(doc).filter((n) => n.type === "step" && (n.attrs?.entryId === "read" || n.attrs?.entryId === "proofshot"))).toEqual([]);
    });

    it("pulls in a goal's evidence that prints the flag: only placed entries stay out of the flag's step", () => {
      const d = withBareFlag();
      d.checklist.push(goal(H, ["read"]));
      const doc = buildTargetDraft(d, target([H]), {});
      expect(evidenceUnder(doc, "post")).toEqual(["flag", "read", "proofshot"]);
    });

    it("join a flag already on the page when they come later, after the flag and before its screenshots", () => {
      const d = withBareFlag();
      const later = d.log.filter((e) => e.id !== "read");
      const doc = buildTargetDraft({ ...d, log: later }, target([H]), {});
      const res = addNewEvidence(doc, d, target([H]), {}, []);
      expect(res.added).toEqual(["read"]);
      // As a fresh draft orders the block: the command before the screenshot.
      expect(evidenceUnder(res.doc, "post")).toEqual(["flag", "read", "proofshot"]);
      expect(stepOf(res.doc, "flag").content!.map((n) => n.attrs?.entryId ?? "SF")).toEqual(["SF", "flag", "read", "proofshot"]);
    });
  });

  it("generates the facts, result, ports and Also tested blocks and none of the old ones", () => {
    const kinds = allNodes(buildTargetDraft(walked(), target([H]), {})).filter((n) => n.type === "generated").map((n) => n.attrs?.kind);
    expect(kinds).toEqual(["facts", "result", "ports", "tested"]);
  });
});

describe("addNewEvidence", () => {
  it("adds the Also tested heading and list once something was tried and failed", () => {
    const d = walked();
    d.attempts = [];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).not.toContain("tested");
    d.attempts = [{ id: "a2", hostId: H, title: "Kerberoasting", reasonKind: "precondition", reason: "", private: false, logEntryId: null } as FailedAttempt];
    const res = addNewEvidence(doc, d, target([H]), {}, []);
    expect(res.added).toEqual([]);
    expect(res.addedTested).toEqual([H]);
    expect(phasesOf(res.doc)).toEqual(["enum", "foothold", "privesc", "post", "tested"]);
    expect(addNewEvidence(res.doc, d, target([H]), {}, []).addedTested).toEqual([]);
  });

  it("puts a new step that runs an exploit on the page right after the step holding the exploit", () => {
    const d = windowsHost();
    d.findings = [finding("f1", { stepEntryIds: ["curl"] })];
    d.findingFiles = [{ id: "edb", findingId: "f1", name: "46153.py", modified: true } as FindingFile];
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("run", H, 19, { kind: "command", blocks: [{ command: "python3 46153.py", output: "ok" }] }));
    d.findings[0].stepEntryIds = ["run", "curl"];
    const lines = outline(addNewEvidence(doc, d, target([H]), {}, []).doc);
    const x = lines.indexOf("X:edb");
    expect(lines.slice(x - 2, x + 7)).toEqual(["-", "S", "X:edb", `S:${EXPLAIN_HINT_TEXT}`, "curl", "-", "S", "run", "]"]);
  });

  it("appends a new step to the end of its phase's steps and leaves everything else alone", () => {
    const d = walked();
    const doc = buildTargetDraft(d, target([H]), {});
    const firstStep = firstSteps(doc).content![0];
    firstStep.content![0] = { ...firstStep.content![0], content: [{ type: "text", text: "Feroxbuster found the upload page." }] };
    const before = structuredClone(doc);

    d.log.push(entry("whoami2", H, 45, cmd("SeImpersonate")));
    d.findings[1].stepEntryIds.push("whoami2");
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);

    expect(added).toEqual(["whoami2"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["whoami", "printspoofer", "whoami2"]);
    expect(doc).toEqual(before);
    const privSteps = next.content!.findIndex((n, i) => n.type === "steps" && i > next.content!.findIndex((p) => p.type === "phase" && p.attrs?.phase === "privesc"));
    expect(next.content!.length).toBe(before.content!.length);
    next.content!.forEach((n, i) => {
      if (i !== privSteps) expect(n).toEqual(before.content![i]);
    });
    expect(next.content![privSteps].content!.slice(0, -1)).toEqual(before.content![privSteps].content);
    expect(next.content![privSteps].content!.at(-1)).toEqual({
      type: "step",
      attrs: { entryId: "whoami2" },
      content: [{ type: "slot", attrs: { hint: STEP_HINT_TEXT } }, { type: "evidence", attrs: { entryId: "whoami2", block: 0, keep: null, emphasis: [], appendix: "inline" } }],
    });
  });

  it("adds a step after the admin access to Post-Exploitation and a new local flag at the end of Initial Access", () => {
    const d = walked();
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("local", H, 25, { kind: "flag", flagKind: "local", value: "xyz" }), entry("dump", H, 60, cmd("hashes")));
    d.findings[1].stepEntryIds.push("dump");
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["local", "dump"]);
    expect(evidenceUnder(next, "foothold")).toEqual(["ferox", "shot", "curl", "local"]);
    expect(evidenceUnder(next, "post")).toEqual(["flag", "dump"]);
  });

  it("puts a new entry-phase step before the local flag, and a new proof flag first in Post-Exploitation", () => {
    const d = walked();
    d.log.push(entry("local", H, 25, { kind: "flag", flagKind: "local", value: "xyz" }), entry("dump", H, 60, cmd("hashes")));
    d.findings[1].stepEntryIds.push("dump");
    d.log = d.log.filter((e) => e.id !== "flag");
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("upload", H, 19, cmd("ok")), entry("flag", H, 55, proofFlag));
    d.findings[0].stepEntryIds.push("upload");
    const { doc: next } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(evidenceUnder(next, "foothold")).toEqual(["ferox", "shot", "curl", "upload", "local"]);
    expect(evidenceUnder(next, "post")).toEqual(["flag", "dump"]);
    expect(stepOf(next, "flag").content![0]).toEqual({ type: "slot", attrs: { hint: FLAG_HINT_TEXT } });
  });

  it("puts a screenshot logged after a step on the page into that step", () => {
    const d = walked();
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("curlshot", H, 22, shot));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["curlshot"]);
    expect(stepOf(next, "curl").content!.map((n) => n.attrs?.entryId ?? "S")).toEqual(["S", "curl", "curlshot"]);
  });

  it("does not re-add removed entries or ones already on the page", () => {
    const d = walked();
    const doc = buildTargetDraft(d, target([H]), {});
    const withoutWhoami: ReportNode = {
      ...doc,
      content: doc.content!.map((n) => (n.type === "steps" ? { ...n, content: n.content!.filter((s) => s.attrs?.entryId !== "whoami") } : n)),
    };
    expect(addNewEvidence(doc, d, target([H]), {}, []).added).toEqual([]);
    const res = addNewEvidence(withoutWhoami, d, target([H]), {}, ["whoami"]);
    expect(res.added).toEqual([]);
    expect(res.doc).toEqual(withoutWhoami);
  });

  it("creates a missing phase heading in the sample's order, with its steps list", () => {
    const d = windowsHost();
    d.grants = [];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).toEqual(["enum", "post", "tested"]);
    d.grants = [grant(H, "user", "curl", 20), grant(H, "system", "printspoofer", 50)];
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["curl", "printspoofer"]);
    expect(phasesOf(next)).toEqual(["enum", "foothold", "privesc", "post", "tested"]);
    expect(evidenceUnder(next, "foothold")).toEqual(["curl"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["printspoofer"]);
    const lines = outline(next);
    expect(lines.slice(lines.indexOf("# foothold"), lines.indexOf("# post"))).toEqual([
      "# foothold", "[", "-", "S", "curl", "]", "# privesc", "[", "-", "S", "printspoofer", "]",
    ]);
  });
});

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

describe("AD set draft", () => {
  /** A machine's first phase after its Service Enumeration heading. */
  const firstPhase = (doc: ReportNode, hostId: string) =>
    doc.content?.find((n) => n.type === "phase" && n.attrs?.hostId === hostId && n.attrs?.phase !== "enum")?.attrs?.phase;

  it("opens with the attack-path table, names phases by how each machine was entered, and places only placing entries", () => {
    const doc = buildTargetDraft(adSet(), target(AD_HOSTS, "ad-set"), {});
    const nodes = doc.content ?? [];
    expect(nodes[0]).toEqual({ type: "generated", attrs: { kind: "attack-path", hostId: null, appendix: "inline" } });
    expect(nodes.filter((n) => n.type === "generated" && n.attrs?.hostId === null)).toHaveLength(1);
    const facts = nodes.filter((n) => n.attrs?.kind === "facts").map((n) => n.attrs?.hostId);
    // The attack path: the entry machine, then by when each was reached, the DC last.
    expect(facts).toEqual(["h-ms01", "h-ad02", "h-dc01"]);
    expect(firstPhase(doc, "h-ms01")).toBe("foothold");
    expect(firstPhase(doc, "h-ad02")).toBe("lateral");
    expect(firstPhase(doc, "h-dc01")).toBe("domain");
    // Scans and goal evidence stay in the rail; the ports table covers the scan.
    expect(evidenceIdsIn(doc).has("ms-scan")).toBe(false);
    expect(evidenceIdsIn(doc).has("ad-dump")).toBe(false);
    expect(evidenceUnder(doc, "foothold", "h-ms01")).toEqual(["ms-rce"]);
    expect(evidenceUnder(doc, "lateral", "h-ad02")).toEqual(["ad-winrm"]);
    expect(evidenceUnder(doc, "domain", "h-dc01")).toEqual(["dc-psexec"]);
    expect(evidenceUnder(doc, "post", "h-dc01")).toEqual(["dc-flag"]);
  });

  it("places a finding on several machines once, at the machine of its first step", () => {
    const d = adSet();
    d.findings = [
      { id: "f-da", hostIds: ["h-ad02", "h-dc01"], serviceIds: [], stepEntryIds: ["ad-dump", "dc-psexec"] } as unknown as Finding,
    ];
    const doc = buildTargetDraft(d, target(AD_HOSTS, "ad-set"), {});
    const nodes = doc.content ?? [];
    const vulns = nodes.flatMap((n, i) => (n.type === "vuln" ? [i] : []));
    expect(vulns).toHaveLength(1);
    const heading = [...nodes.slice(0, vulns[0])].reverse().find((n) => n.type === "phase");
    expect(heading?.attrs).toEqual({ phase: "privesc", hostId: "h-ad02" });
    expect(evidenceUnder(doc, "privesc", "h-ad02")).toEqual(["ad-dump"]);
  });

  it("takes the last host in the hop chain as the DC when no host runs Kerberos and LDAP", () => {
    const d = adSet();
    d.services = [];
    const doc = buildTargetDraft(d, target(AD_HOSTS, "ad-set"), {});
    expect(firstPhase(doc, "h-dc01")).toBe("domain");
    expect(firstPhase(doc, "h-ad02")).toBe("lateral");
  });
});
