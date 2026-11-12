import { describe, expect, it } from "vitest";
import { CHAIN_KEY, machineKey, phaseKey, targetHeadings } from "../engines/report";
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
