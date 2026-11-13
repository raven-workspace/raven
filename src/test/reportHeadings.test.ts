import { describe, expect, it } from "vitest";
import { buildPlainTarget, CHAIN_KEY, machineKey, phaseKey, reportTargets, targetHeadings, targetNumbers } from "../engines/report";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import type { ReportData, ReportNode } from "../engines/report";

const data = {
  hosts: [
    { id: "h1", name: "web01", ip: "172.31.232.55" },
    { id: "a", name: "Ajla", ip: "10.4.4.10" },
    { id: "p", name: "Poultry", ip: "10.5.5.20" },
  ],
  findings: [
    { id: "f1", title: "SMB share to WordPress RCE" },
    { id: "f2", title: "AlwaysInstallElevated" },
    { id: "f3", title: "Reused password over SSH" },
    { id: "f4", title: "Directory listing" },
  ],
} as unknown as ReportData;

const g = (kind: string, hostId: string | null): ReportNode => ({ type: "generated", attrs: { kind, hostId, appendix: "inline" } });
const ph = (phase: string, hostId: string, findingId?: string): ReportNode => ({ type: "phase", attrs: { phase, hostId, ...(findingId ? { findingId } : {}) } });
const vuln = (findingId: string): ReportNode => ({ type: "vuln", attrs: { findingId } });
const slot: ReportNode = { type: "slot", attrs: { hint: "" } };
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const label = (h: ReturnType<typeof targetHeadings>, key: string) => {
  const l = h.get(key);
  return l ? `${l.number ?? "-"} ${l.text}` : undefined;
};

describe("targetHeadings", () => {
  it("gives a second finding that enabled a phase a numbered heading of its own, and each additional finding its title", () => {
    const page = doc(
      g("facts", "h1"),
      ph("foothold", "h1"), vuln("f1"), slot,
      ph("foothold", "h1", "f3"), vuln("f3"), slot,
      ph("post", "h1"),
      ph("additional", "h1"), ph("additional", "h1", "f4"), vuln("f4"),
      ph("tested", "h1"), g("tested", "h1"),
    );
    const h = targetHeadings(page, data, { key: "h1", kind: "standalone", hostIds: ["h1"] }, "4.1", 1);
    expect(label(h, phaseKey("h1", "foothold"))).toBe("4.1.1 Initial Access – SMB share to WordPress RCE");
    expect(label(h, phaseKey("h1", "foothold", "f3"))).toBe("4.1.2 Initial Access – Reused password over SSH");
    expect(label(h, phaseKey("h1", "post"))).toBe("4.1.3 Post-Exploitation");
    expect(label(h, phaseKey("h1", "additional"))).toBe("4.1.4 Additional findings");
    expect(label(h, phaseKey("h1", "additional", "f4"))).toBe("- Directory listing");
    expect(label(h, phaseKey("h1", "tested"))).toBe("- Also tested");
  });

  it("numbers a standalone target's sub-sections in page order and names the vulnerability that opened each", () => {
    const page = doc(
      g("facts", "h1"),
      ph("enum", "h1"), g("port-scan", "h1"), slot,
      ph("foothold", "h1"), vuln("f1"), slot,
      ph("privesc", "h1"), vuln("f2"),
      ph("tested", "h1"), g("tested", "h1"),
      ph("post", "h1"),
    );
    const h = targetHeadings(page, data, { key: "h1", kind: "standalone", hostIds: ["h1"] }, "4.1", 1);
    expect(label(h, machineKey("h1"))).toBe("4.1 Target #1 – 172.31.232.55");
    expect(label(h, phaseKey("h1", "enum"))).toBe("4.1.1 Service Enumeration");
    expect(label(h, phaseKey("h1", "foothold"))).toBe("4.1.2 Initial Access – SMB share to WordPress RCE");
    expect(label(h, phaseKey("h1", "privesc"))).toBe("4.1.3 Privilege Escalation – AlwaysInstallElevated");
    expect(label(h, phaseKey("h1", "tested"))).toBe("- Also tested");
    expect(label(h, phaseKey("h1", "post"))).toBe("4.1.4 Post-Exploitation");
  });

  it("closes the numbers up when a phase is missing or moved, and leaves a phase with no vulnerability plain", () => {
    const page = doc(g("facts", "h1"), ph("enum", "h1"), ph("post", "h1"), ph("foothold", "h1"), slot);
    const h = targetHeadings(page, data, { key: "h1", kind: "standalone", hostIds: ["h1"] }, "4.3", 3);
    expect(label(h, machineKey("h1"))).toBe("4.3 Target #3 – 172.31.232.55");
    expect(label(h, phaseKey("h1", "post"))).toBe("4.3.2 Post-Exploitation");
    expect(label(h, phaseKey("h1", "foothold"))).toBe("4.3.3 Initial Access");
  });

  it("numbers each AD machine under the set's chapter, its phases under it, and the attack chain last", () => {
    const page = doc(
      g("port-scan", null),
      g("facts", "a"), ph("foothold", "a"), ph("privesc", "a"), ph("post", "a"),
      g("facts", "p"), ph("lateral", "p"), ph("post", "p"),
      g("attack-chain", null),
    );
    const h = targetHeadings(page, data, { key: "ad-set", kind: "ad-set", hostIds: ["a", "p"] }, "5", 0);
    expect(label(h, machineKey("a"))).toBe("5.1 Ajla – 10.4.4.10");
    expect(label(h, phaseKey("a", "privesc"))).toBe("5.1.2 Privilege Escalation");
    expect(label(h, phaseKey("a", "post"))).toBe("5.1.3 Post-Exploitation");
    expect(label(h, machineKey("p"))).toBe("5.2 Poultry – 10.5.5.20");
    expect(label(h, phaseKey("p", "lateral"))).toBe("5.2.1 Lateral Movement");
    expect(label(h, CHAIN_KEY)).toBe("5.3 Attack Chain");
  });
});

describe("targetNumbers", () => {
  const heading = (source: string, level = 1): ReportNode => ({ type: "heading", attrs: { level, source }, content: [{ type: "text", text: "x" }] });
  const para: ReportNode = { type: "paragraph" };
  const numbers = (m: Map<number, string>) => Object.fromEntries(m);

  it("numbers a standalone page's machine heading with the base and nothing else", () => {
    const page = doc(heading("facts:h1"), para, heading("phase:h1:foothold", 2), para);
    expect(numbers(targetNumbers(page, { key: "h1", kind: "standalone", hostIds: ["h1"] }, "4.2"))).toEqual({ 0: "4.2" });
  });

  it("numbers the n-th machine heading of the AD set under the base", () => {
    const page = doc(heading("facts:a"), para, heading("phase:a:privesc", 2), heading("facts:p"), para, heading("phase:p:post", 2));
    expect(numbers(targetNumbers(page, { key: "ad-set", kind: "ad-set", hostIds: ["a", "p"] }, "5"))).toEqual({ 0: "5.1", 3: "5.2" });
  });

  it("reads the real indices of a built AD set, its attack path first", () => {
    const E = "e-exam";
    const hosts = FIXTURES.hosts.filter((h) => h.engagementId === E);
    const ids = new Set(hosts.map((h) => h.id));
    const exam = {
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
    } as ReportData;
    const ad = reportTargets(exam, {}).find((t) => t.kind === "ad-set")!;
    const page = buildPlainTarget(exam, ad, {});
    const at = (page.content ?? []).flatMap((n, i) => (n.type === "heading" && String(n.attrs?.source).startsWith("facts:") ? [i] : []));
    expect(at.length).toBeGreaterThan(1);
    expect(at[0]).toBeGreaterThan(0);
    expect(numbers(targetNumbers(page, ad, "5"))).toEqual(Object.fromEntries(at.map((i, n) => [i, `5.${n + 1}`])));
  });

  it("numbers the garnet page's one machine heading as the base", () => {
    const garnet = buildPlainTarget(garnetFixtures(1_700_000_000_000), { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] }, {});
    expect(numbers(targetNumbers(garnet, { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] }, "4.1"))).toEqual({ 0: "4.1" });
  });
});
