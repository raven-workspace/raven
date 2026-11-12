import { describe, expect, it } from "vitest";
import {
  addNewEvidence,
  buildTargetDraft,
  defaultKeep,
  evidenceIdsIn,
  isDeadEnd,
  provingEntries,
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
    credentials: [],
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

/** The entry ids of the evidence nodes under one phase heading. */
function evidenceUnder(doc: ReportNode, phase: string, hostId = H): string[] {
  const out: string[] = [];
  let inPhase = false;
  for (const n of doc.content ?? []) {
    if (n.type === "phase") inPhase = n.attrs?.phase === phase && n.attrs?.hostId === hostId;
    else if (inPhase && n.type === "evidence") out.push(n.attrs?.entryId as string);
  }
  return out;
}

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

const STEP_SLOT = { type: "slot", attrs: { hint: "What you do next, and why" } };

/** The page as a readable outline: phases, slots (S), evidence ids, vulns (V:id), generated kinds (G:kind). */
const outline = (doc: ReportNode) =>
  (doc.content ?? []).map((n) => {
    if (n.type === "phase") return `# ${n.attrs?.phase}`;
    if (n.type === "slot") return n.attrs?.label ? `S:${n.attrs.label}` : "S";
    if (n.type === "evidence") return n.attrs?.entryId as string;
    if (n.type === "vuln") return `V:${n.attrs?.findingId}`;
    if (n.type === "exploit") return `X:${n.attrs?.fileId}`;
    return `G:${n.attrs?.kind}`;
  });

describe("buildTargetDraft", () => {
  it("lays a standalone host out in OffSec's sample order", () => {
    const doc = buildTargetDraft(windowsHost(), target([H]), {});
    expect(doc.type).toBe("doc");
    expect(outline(doc)).toEqual([
      "G:facts",
      "# enum", "G:port-scan", "S", "nmap",
      "# foothold", "S", "ferox", "shot", "S", "curl",
      "# privesc", "S", "whoami", "S", "printspoofer",
      "# tested", "G:tested",
      "# post", "flag",
    ]);
  });

  it("puts the slot before each step, one per step, and never references the private entry", () => {
    const doc = buildTargetDraft(windowsHost(), target([H]), {});
    const nodes = doc.content ?? [];
    nodes.forEach((n, i) => {
      if (n.type === "evidence" && n.attrs?.entryId !== "flag" && n.attrs?.entryId !== "shot") expect(nodes[i - 1]).toEqual(STEP_SLOT);
    });
    expect(JSON.stringify(doc)).not.toContain('"private"');
    expect(evidenceIdsIn(doc).has("private")).toBe(false);
  });

  it("shares one slot between a command's blocks and the screenshot that came along with it", () => {
    const d = windowsHost();
    d.log[3] = entry("ferox", H, 10, cmd("a", "b"));
    const doc = buildTargetDraft(d, target([H]), {});
    const at = outline(doc).indexOf("ferox");
    expect(outline(doc).slice(at - 1, at + 3)).toEqual(["S", "ferox", "ferox", "shot"]);
    expect(doc.content![at].attrs?.block).toBe(0);
    expect(doc.content![at + 1].attrs?.block).toBe(1);
  });

  it("puts only port scans in Service Enumeration, after the Port Scan Results table", () => {
    const d = windowsHost();
    d.log.push(entry("rustscan", H, 1, { kind: "command", blocks: [{ command: "rustscan -a 10.0.0.5", output: "22 open" }] }));
    d.checklist.push(goal(H, ["rustscan"]));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "enum")).toEqual(["nmap", "rustscan"]);
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "curl"]);
  });

  it("closes Initial Access with the local flag and opens Post-Exploitation with the proof flag", () => {
    const d = windowsHost();
    // The local flag was logged after privesc had started; it still closes Initial Access.
    d.log.push(entry("local", H, 45, { kind: "flag", flagKind: "local", value: "xyz" }), entry("dump", H, 60, cmd("hashes")));
    d.checklist.push(goal(H, ["dump"]));
    d.grants = [grant(H, "user", "curl", 20), grant(H, "system", "printspoofer", 50)];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "curl", "local"]);
    expect(evidenceUnder(doc, "privesc")).toEqual(["whoami", "printspoofer"]);
    expect(evidenceUnder(doc, "post")).toEqual(["flag", "dump"]);
    // A flag prints its own label: no slot before it.
    const local = outline(doc).indexOf("local");
    expect(outline(doc)[local - 1]).toBe("curl");
  });

  it("starts long outputs trimmed to the first 40 lines", () => {
    const d = windowsHost();
    const long = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const twelve = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    d.log[3] = entry("ferox", H, 10, cmd(long, twelve));
    const nodes = (buildTargetDraft(d, target([H]), {}).content ?? []).filter((n) => n.attrs?.entryId === "ferox");
    expect(nodes.map((n) => n.attrs?.keep)).toEqual([[[0, 39]], null]);
    expect(nodes[0].attrs).toEqual({ entryId: "ferox", block: 0, keep: [[0, 39]], emphasis: [], appendix: "inline" });
  });

  it("brings along a screenshot taken between two kept entries, not one outside them", () => {
    const d = windowsHost();
    d.log.push(entry("midshot", H, 17, shot), entry("lateshot", H, 90, shot), entry("earlyshot", H, -10, shot), entry("flagshot", H, 56, shot));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "midshot", "curl"]);
    expect(evidenceUnder(doc, "post")).toEqual(["flag", "flagshot"]);
    expect(evidenceIdsIn(doc).has("lateshot")).toBe(false);
    expect(evidenceIdsIn(doc).has("earlyshot")).toBe(false);
  });

  it("does not treat access given before anything was logged as the foothold", () => {
    const d = windowsHost();
    d.grants = [{ ...grant(H, "user", "", -60), logEntryId: null }];
    d.checklist.push(goal(H, ["curl", "printspoofer"]));
    expect(phasesOf(buildTargetDraft(d, target([H]), {}))).toEqual(["enum", "foothold", "tested", "post"]);
  });

  it("puts every step under Initial Access when no access was granted", () => {
    const d = windowsHost();
    d.grants = [];
    d.checklist.push(goal(H, ["curl", "printspoofer"]));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).toEqual(["enum", "foothold", "tested", "post"]);
    expect(evidenceUnder(doc, "foothold")).toEqual(["ferox", "shot", "curl", "whoami", "printspoofer"]);
  });

  it("leaves Also tested out when nothing was tried and failed", () => {
    const d = windowsHost();
    d.attempts = [];
    expect(phasesOf(buildTargetDraft(d, target([H]), {}))).toEqual(["enum", "foothold", "privesc", "post"]);
  });

  it("opens a phase with its finding's vulnerability and the reproduce slot, its exploit after the steps", () => {
    const d = windowsHost();
    d.findings = [{ id: "f1", hostIds: [H], serviceIds: [], stepEntryIds: ["whoami", "printspoofer"] } as unknown as Finding];
    d.findingFiles = [{ id: "file1", findingId: "f1", modified: true } as FindingFile];
    const doc = buildTargetDraft(d, target([H]), {});
    const lines = outline(doc);
    const privesc = lines.indexOf("# privesc");
    expect(lines.slice(privesc, lines.indexOf("# tested"))).toEqual([
      "# privesc", "V:f1", "S:Steps to reproduce the attack:", "S", "whoami", "S", "printspoofer", "X:file1", "S",
    ]);
    expect(doc.content![privesc + 2]).toEqual({
      type: "slot",
      attrs: { hint: "A short summary of the attack, start to finish", label: "Steps to reproduce the attack:" },
    });
    expect(doc.content![lines.indexOf("X:file1") + 1]).toEqual({ type: "slot", attrs: { hint: "Explain each change" } });
  });

  it("has no generated appendices or old blocks", () => {
    const kinds = (buildTargetDraft(windowsHost(), target([H]), {}).content ?? []).filter((n) => n.type === "generated").map((n) => n.attrs?.kind);
    expect(kinds).toEqual(["facts", "port-scan", "tested"]);
  });
});

describe("addNewEvidence", () => {
  it("appends a new step to the end of its phase, its slot before it, and leaves everything else alone", () => {
    const d = windowsHost();
    const doc = buildTargetDraft(d, target([H]), {});
    const firstSlot = doc.content!.findIndex((n) => n.type === "slot");
    doc.content![firstSlot] = { ...doc.content![firstSlot], content: [{ type: "text", text: "A full port scan first." }] };
    const before = structuredClone(doc);

    d.log.push(entry("whoami2", H, 45, cmd("SeImpersonate")));
    d.checklist.push(goal(H, ["whoami2"]));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);

    expect(added).toEqual(["whoami2"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["whoami", "printspoofer", "whoami2"]);
    expect(doc).toEqual(before);
    const inserted = next.content!.findIndex((n) => n.attrs?.entryId === "whoami2");
    expect(next.content![inserted - 1]).toEqual(STEP_SLOT);
    expect(next.content!.slice(0, inserted - 1)).toEqual(before.content!.slice(0, inserted - 1));
    expect(next.content!.slice(inserted + 1)).toEqual(before.content!.slice(inserted - 1));
  });

  it("adds a step after the admin access to Post-Exploitation and a new local flag at the end of Initial Access", () => {
    const d = windowsHost();
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("local", H, 25, { kind: "flag", flagKind: "local", value: "xyz" }), entry("dump", H, 60, cmd("hashes")));
    d.checklist.push(goal(H, ["dump"]));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["local", "dump"]);
    expect(evidenceUnder(next, "foothold")).toEqual(["ferox", "shot", "curl", "local"]);
    expect(evidenceUnder(next, "post")).toEqual(["flag", "dump"]);
  });

  it("puts a new entry-phase step before the local flag, and a new proof flag first in Post-Exploitation", () => {
    const d = windowsHost();
    d.log.push(entry("local", H, 25, { kind: "flag", flagKind: "local", value: "xyz" }), entry("dump", H, 60, cmd("hashes")));
    d.checklist.push(goal(H, ["dump"]));
    d.log = d.log.filter((e) => e.id !== "flag");
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("upload", H, 19, cmd("ok")), entry("flag", H, 55, proofFlag));
    d.checklist.push(goal(H, ["upload"]));
    const { doc: next } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(evidenceUnder(next, "foothold")).toEqual(["ferox", "shot", "curl", "upload", "local"]);
    expect(evidenceUnder(next, "post")).toEqual(["flag", "dump"]);
  });

  it("does not re-add removed entries or ones already on the page", () => {
    const d = windowsHost();
    const doc = buildTargetDraft(d, target([H]), {});
    const withoutWhoami: ReportNode = {
      ...doc,
      content: doc.content!.filter((n, i, all) => n.attrs?.entryId !== "whoami" && all[i + 1]?.attrs?.entryId !== "whoami"),
    };
    expect(addNewEvidence(doc, d, target([H]), {}, []).added).toEqual([]);
    const res = addNewEvidence(withoutWhoami, d, target([H]), {}, ["whoami"]);
    expect(res.added).toEqual([]);
    expect(res.doc).toEqual(withoutWhoami);
  });

  it("creates a missing phase heading in the sample's order", () => {
    const d = windowsHost();
    d.grants = [];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).toEqual(["enum", "foothold", "tested", "post"]);
    d.grants = [grant(H, "user", "curl", 20), grant(H, "system", "printspoofer", 50)];
    d.checklist.push(goal(H, ["curl", "printspoofer"]));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["curl", "printspoofer"]);
    expect(phasesOf(next)).toEqual(["enum", "foothold", "privesc", "tested", "post"]);
    expect(evidenceUnder(next, "foothold")).toEqual(["ferox", "shot", "whoami", "curl"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["printspoofer"]);
  });
});

describe("AD set draft", () => {
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

  it("opens with one Port Scan Results table, names phases by how each machine was entered, ends with the attack chain", () => {
    const doc = buildTargetDraft(adSet(), target(["h-ad02", "h-dc01", "h-ms01"], "ad-set"), {});
    const nodes = doc.content ?? [];
    expect(nodes[0]).toEqual({ type: "generated", attrs: { kind: "port-scan", hostId: null, appendix: "inline" } });
    expect(nodes[nodes.length - 1].attrs?.kind).toBe("attack-chain");
    const facts = nodes.filter((n) => n.attrs?.kind === "facts").map((n) => n.attrs?.hostId);
    expect(facts).toEqual(["h-ad02", "h-dc01", "h-ms01"]);
    const firstPhase = (hostId: string) => nodes.find((n) => n.type === "phase" && n.attrs?.hostId === hostId)?.attrs?.phase;
    expect(firstPhase("h-ms01")).toBe("foothold");
    expect(firstPhase("h-ad02")).toBe("lateral");
    expect(firstPhase("h-dc01")).toBe("domain");
    // No Service Enumeration per machine: a machine's scans are in its first phase.
    expect(evidenceUnder(doc, "foothold", "h-ms01")).toEqual(["ms-scan", "ms-rce"]);
    expect(evidenceUnder(doc, "lateral", "h-ad02")).toEqual(["ad-winrm"]);
    expect(evidenceUnder(doc, "privesc", "h-ad02")).toEqual(["ad-dump"]);
    expect(evidenceUnder(doc, "domain", "h-dc01")).toEqual(["dc-psexec"]);
    expect(evidenceUnder(doc, "post", "h-dc01")).toEqual(["dc-flag"]);
  });

  it("places a finding on several machines once, at the machine of its first step", () => {
    const d = adSet();
    d.findings = [
      { id: "f-da", hostIds: ["h-ad02", "h-dc01"], serviceIds: [], stepEntryIds: ["ad-dump", "dc-psexec"] } as unknown as Finding,
    ];
    const doc = buildTargetDraft(d, target(["h-ad02", "h-dc01", "h-ms01"], "ad-set"), {});
    const nodes = doc.content ?? [];
    const vulns = nodes.flatMap((n, i) => (n.type === "vuln" ? [i] : []));
    expect(vulns).toHaveLength(1);
    const heading = [...nodes.slice(0, vulns[0])].reverse().find((n) => n.type === "phase");
    expect(heading?.attrs).toEqual({ phase: "privesc", hostId: "h-ad02" });
  });

  it("takes the last host in the hop chain as the DC when no host runs Kerberos and LDAP", () => {
    const d = adSet();
    d.services = [];
    const doc = buildTargetDraft(d, target(["h-ad02", "h-dc01", "h-ms01"], "ad-set"), {});
    const firstPhase = (hostId: string) => doc.content?.find((n) => n.type === "phase" && n.attrs?.hostId === hostId)?.attrs?.phase;
    expect(firstPhase("h-dc01")).toBe("domain");
    expect(firstPhase("h-ad02")).toBe("lateral");
  });
});
