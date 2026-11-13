import { describe, expect, it } from "vitest";
import { buildPlainTarget, reportTargets, targetNumbers } from "../engines/report";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import type { ReportData, ReportNode } from "../engines/report";

const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });

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
