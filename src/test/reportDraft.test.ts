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
    entry("nmap", H, 0, cmd("80/tcp open http")),
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
  d.attempts = [{ id: "a1", logEntryId: "hydra", hostId: H } as FailedAttempt];
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

describe("buildTargetDraft", () => {
  it("splits a standalone host into foothold, privesc, tested and proof", () => {
    const doc = buildTargetDraft(windowsHost(), target([H]), {});
    expect(doc.type).toBe("doc");
    expect(doc.content?.slice(0, 2).map((n) => n.attrs?.kind)).toEqual(["facts", "services"]);
    expect(phasesOf(doc)).toEqual(["foothold", "privesc", "tested", "proof"]);
    expect(evidenceUnder(doc, "foothold")).toEqual(["nmap", "ferox", "shot", "curl"]);
    expect(evidenceUnder(doc, "privesc")).toEqual(["whoami", "printspoofer"]);
    expect(evidenceUnder(doc, "proof")).toEqual(["flag"]);
  });

  it("follows every evidence node with an empty slot and never references the private entry", () => {
    const doc = buildTargetDraft(windowsHost(), target([H]), {});
    const nodes = doc.content ?? [];
    nodes.forEach((n, i) => {
      if (n.type === "evidence") {
        expect(nodes[i + 1]).toEqual({ type: "slot", attrs: { hint: "What this shows, and why it matters" } });
      }
    });
    expect(JSON.stringify(doc)).not.toContain('"private"');
    expect(evidenceIdsIn(doc).has("private")).toBe(false);
  });

  it("places generated blocks after the tested and proof headings", () => {
    const nodes = buildTargetDraft(windowsHost(), target([H]), {}).content ?? [];
    const at = (phase: string) => nodes.findIndex((n) => n.type === "phase" && n.attrs?.phase === phase);
    expect(nodes[at("tested") + 1]).toEqual({
      type: "generated",
      attrs: { kind: "tested", hostId: H, appendix: "inline" },
    });
    expect(nodes[at("proof") + 1].attrs?.kind).toBe("proof-table-host");
  });

  it("makes one evidence node per command block", () => {
    const d = windowsHost();
    d.log[0] = entry("nmap", H, 0, cmd("a", "b"));
    const nodes = (buildTargetDraft(d, target([H]), {}).content ?? []).filter(
      (n) => n.type === "evidence" && n.attrs?.entryId === "nmap",
    );
    expect(nodes.map((n) => n.attrs?.block)).toEqual([0, 1]);
    expect(nodes[0].attrs).toEqual({ entryId: "nmap", block: 0, keep: null, emphasis: [], appendix: "inline" });
  });

  it("starts long outputs trimmed to the first 40 lines", () => {
    const d = windowsHost();
    const long = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const twelve = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    d.log[0] = entry("nmap", H, 0, cmd(long, twelve));
    const nodes = (buildTargetDraft(d, target([H]), {}).content ?? []).filter((n) => n.attrs?.entryId === "nmap");
    expect(nodes.map((n) => n.attrs?.keep)).toEqual([[[0, 39]], null]);
  });

  it("keeps a brought-along screenshot with the entry it followed", () => {
    const d = windowsHost();
    d.log.push(entry("curlshot", H, 22, shot), entry("flagshot", H, 56, shot));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "foothold")).toEqual(["nmap", "ferox", "shot", "curl", "curlshot"]);
    expect(evidenceUnder(doc, "privesc")).toEqual(["whoami", "printspoofer"]);
    expect(evidenceUnder(doc, "proof")).toEqual(["flag", "flagshot"]);
  });

  it("brings along a screenshot taken between two kept entries, not one outside them", () => {
    const d = windowsHost();
    d.log.push(entry("midshot", H, 17, shot), entry("lateshot", H, 90, shot), entry("earlyshot", H, -10, shot));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(evidenceUnder(doc, "foothold")).toEqual(["nmap", "ferox", "shot", "midshot", "curl"]);
    expect(evidenceIdsIn(doc).has("lateshot")).toBe(false);
    expect(evidenceIdsIn(doc).has("earlyshot")).toBe(false);
  });

  it("does not treat access given before anything was logged as the foothold", () => {
    const d = windowsHost();
    d.grants = [{ ...grant(H, "user", "", -60), logEntryId: null }];
    d.checklist.push(goal(H, ["curl", "printspoofer"]));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).toEqual(["foothold", "tested", "proof"]);
  });

  it("puts all non-flag evidence under foothold when no access was granted", () => {
    const d = windowsHost();
    d.grants = [];
    d.checklist.push(goal(H, ["curl", "printspoofer"]));
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).toEqual(["foothold", "tested", "proof"]);
    expect(evidenceUnder(doc, "foothold")).toEqual(["nmap", "ferox", "shot", "curl", "whoami", "printspoofer"]);
  });

  it("puts a finding's vulnerability at the top of the phase its steps fall in, its exploit at the end", () => {
    const d = windowsHost();
    d.findings = [
      { id: "f1", hostIds: [H], serviceIds: [], stepEntryIds: ["whoami", "printspoofer"] } as unknown as Finding,
    ];
    d.findingFiles = [{ id: "file1", findingId: "f1", modified: true } as FindingFile];
    const nodes = buildTargetDraft(d, target([H]), {}).content ?? [];
    const privesc = nodes.findIndex((n) => n.type === "phase" && n.attrs?.phase === "privesc");
    expect(nodes[privesc + 1]).toEqual({ type: "vuln", attrs: { findingId: "f1" } });
    const tested = nodes.findIndex((n) => n.type === "phase" && n.attrs?.phase === "tested");
    const exploit = nodes.findIndex((n) => n.type === "exploit");
    expect(nodes[exploit].attrs).toEqual({ fileId: "file1", markedLines: [], appendix: "inline" });
    expect(exploit).toBeGreaterThan(privesc);
    expect(exploit).toBeLessThan(tested);
    expect(nodes[exploit + 1]).toEqual({ type: "slot", attrs: { hint: "Explain each change" } });
  });
});

describe("addNewEvidence", () => {
  it("appends a new proving entry to the end of its phase and leaves everything else alone", () => {
    const d = windowsHost();
    const doc = buildTargetDraft(d, target([H]), {});
    // The owner writes in a slot.
    const firstSlot = doc.content!.findIndex((n) => n.type === "slot");
    doc.content![firstSlot] = { ...doc.content![firstSlot], content: [{ type: "text", text: "Port 80 open." }] };
    const before = structuredClone(doc);

    d.log.push(entry("mimikatz", H, 52, cmd("NTLM hash")));
    d.checklist.push(goal(H, ["mimikatz"]));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);

    expect(added).toEqual(["mimikatz"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["whoami", "printspoofer", "mimikatz"]);
    expect(doc).toEqual(before);
    const inserted = next.content!.findIndex((n) => n.attrs?.entryId === "mimikatz");
    expect(next.content!.slice(0, inserted)).toEqual(before.content!.slice(0, inserted));
    expect(next.content![inserted + 1]).toEqual({ type: "slot", attrs: { hint: "What this shows, and why it matters" } });
    expect(next.content!.slice(inserted + 2)).toEqual(before.content!.slice(inserted));
  });

  it("appends a new flag to the proof region", () => {
    const d = windowsHost();
    const doc = buildTargetDraft(d, target([H]), {});
    d.log.push(entry("local", H, 25, { kind: "flag", flagKind: "local", value: "xyz" }));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["local"]);
    expect(evidenceUnder(next, "proof")).toEqual(["flag", "local"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["whoami", "printspoofer"]);
  });

  it("does not re-add removed entries or ones already on the page", () => {
    const d = windowsHost();
    const doc = buildTargetDraft(d, target([H]), {});
    const withoutWhoami: ReportNode = {
      ...doc,
      content: doc.content!.filter((n, i, all) => n.attrs?.entryId !== "whoami" && all[i - 1]?.attrs?.entryId !== "whoami"),
    };
    expect(addNewEvidence(doc, d, target([H]), {}, []).added).toEqual([]);
    const res = addNewEvidence(withoutWhoami, d, target([H]), {}, ["whoami"]);
    expect(res.added).toEqual([]);
    expect(res.doc).toEqual(withoutWhoami);
  });

  it("creates a missing phase heading in outline order", () => {
    const d = windowsHost();
    d.grants = [];
    const doc = buildTargetDraft(d, target([H]), {});
    expect(phasesOf(doc)).toEqual(["foothold", "tested", "proof"]);
    d.grants = [grant(H, "user", "curl", 20), grant(H, "system", "printspoofer", 50)];
    d.log.push(entry("mimikatz", H, 52, cmd("NTLM hash")));
    d.checklist.push(goal(H, ["mimikatz"]));
    const { doc: next, added } = addNewEvidence(doc, d, target([H]), {}, []);
    expect(added).toEqual(["curl", "printspoofer", "mimikatz"]);
    expect(phasesOf(next)).toEqual(["foothold", "privesc", "tested", "proof"]);
    expect(evidenceUnder(next, "foothold")).toEqual(["nmap", "ferox", "shot", "whoami", "curl"]);
    expect(evidenceUnder(next, "privesc")).toEqual(["printspoofer", "mimikatz"]);
  });
});

describe("AD set draft", () => {
  function adSet(): ReportData {
    const d = empty();
    d.hosts = [host("h-dc01", "dc01", true), host("h-ad02", "ad02", true), host("h-ms01", "ms01", true)];
    d.services = [service("h-dc01", 88), service("h-dc01", 389), service("h-ms01", 80)];
    d.log = [
      entry("ms-rce", "h-ms01", 0, cmd("uid")),
      entry("ad-winrm", "h-ad02", 10, cmd("ok")),
      entry("ad-dump", "h-ad02", 15, cmd("hash")),
      entry("dc-psexec", "h-dc01", 20, cmd("system")),
      entry("dc-flag", "h-dc01", 25, proofFlag),
    ];
    d.grants = [grant("h-ms01", "user", "ms-rce", 0), grant("h-ad02", "user", "ad-winrm", 10)];
    d.checklist = [goal("h-ad02", ["ad-dump"])];
    d.hops = [hop("h-ms01", "h-ad02", "ad-winrm", 10), hop("h-ad02", "h-dc01", "dc-psexec", 20)];
    return d;
  }

  it("names phases by how each machine was entered and ends with the attack chain", () => {
    const doc = buildTargetDraft(adSet(), target(["h-ad02", "h-dc01", "h-ms01"], "ad-set"), {});
    const nodes = doc.content ?? [];
    expect(nodes[0]).toEqual({ type: "generated", attrs: { kind: "ad-overview", hostId: null, appendix: "inline" } });
    // The overview's table is followed by a place to write the path through the domain.
    expect(nodes[1]).toEqual({ type: "slot", attrs: { hint: "The path through the domain, machine by machine" } });
    expect(nodes[nodes.length - 1].attrs?.kind).toBe("attack-chain");
    const facts = nodes.filter((n) => n.attrs?.kind === "facts").map((n) => n.attrs?.hostId);
    expect(facts).toEqual(["h-ad02", "h-dc01", "h-ms01"]);
    const firstPhase = (hostId: string) =>
      nodes.find((n) => n.type === "phase" && n.attrs?.hostId === hostId)?.attrs?.phase;
    expect(firstPhase("h-ms01")).toBe("foothold");
    expect(firstPhase("h-ad02")).toBe("lateral");
    expect(firstPhase("h-dc01")).toBe("domain");
    expect(evidenceUnder(doc, "lateral", "h-ad02")).toEqual(["ad-winrm"]);
    expect(evidenceUnder(doc, "privesc", "h-ad02")).toEqual(["ad-dump"]);
    expect(evidenceUnder(doc, "domain", "h-dc01")).toEqual(["dc-psexec"]);
    expect(evidenceUnder(doc, "proof", "h-dc01")).toEqual(["dc-flag"]);
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
    // Under ad02's privilege escalation, where the hash was dumped.
    const heading = [...nodes.slice(0, vulns[0])].reverse().find((n) => n.type === "phase");
    expect(heading?.attrs).toEqual({ phase: "privesc", hostId: "h-ad02" });
  });

  it("takes the last host in the hop chain as the DC when no host runs Kerberos and LDAP", () => {
    const d = adSet();
    d.services = [];
    const doc = buildTargetDraft(d, target(["h-ad02", "h-dc01", "h-ms01"], "ad-set"), {});
    const firstPhase = (hostId: string) =>
      doc.content?.find((n) => n.type === "phase" && n.attrs?.hostId === hostId)?.attrs?.phase;
    expect(firstPhase("h-dc01")).toBe("domain");
    expect(firstPhase("h-ad02")).toBe("lateral");
  });
});
