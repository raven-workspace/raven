import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import {
  buildPlainTarget,
  buildSectionDraft,
  findingBlocks,
  flattenToPlain,
  labelled,
  PLAIN_TABLE_KINDS,
  plainTable,
  reportTargets,
  type ReportData,
  type ReportNode,
  type ReportTarget,
} from "../engines/report";
import type { SectionKind } from "../types/report";
import type { Settings } from "../types/settings";
import layout3Json from "./fixtures/report-layout3-owner.json";
import layout4Json from "./fixtures/report-layout4-ms01.json";
import layout5Json from "./fixtures/report-layout5-web01.json";

/**
 * Characterization: the exact JSON the report builders write. Generated blocks are hashed (`gen`), so a byte change in
 * a builder's output would make Refresh read every generated block as owner-edited. Snapshots are of the serialized
 * string, so key order counts too.
 */

/** One block per line (a doc's or a list's), each doc and list closed by a marker line, so a failing snapshot diffs
 *  block by block. */
const json = (v: unknown): string => {
  const lines = (x: unknown): string[] => {
    if (Array.isArray(x)) return [...x.flatMap(lines), "]"];
    const n = x as ReportNode;
    if (n?.type === "doc") return [...(n.content ?? []).map((b) => JSON.stringify(b)), `doc ${JSON.stringify(Object.keys(n))} ${JSON.stringify(n.attrs ?? null)}`];
    return [JSON.stringify(x)];
  };
  return `\n${lines(v).join("\n")}\n`;
};

function engagementData(engagementId: string): ReportData {
  const hosts = FIXTURES.hosts.filter((h) => h.engagementId === engagementId);
  const ids = new Set(hosts.map((h) => h.id));
  return {
    engagement: FIXTURES.engagements.find((e) => e.id === engagementId)!,
    hosts,
    services: FIXTURES.services.filter((s) => ids.has(s.hostId)),
    log: FIXTURES.log.filter((e) => e.engagementId === engagementId),
    checklist: FIXTURES.checklist.filter((c) => ids.has(c.ownerId) || c.ownerId === engagementId),
    findings: FIXTURES.findings.filter((f) => f.engagementId === engagementId),
    findingFiles: FIXTURES.findingFiles,
    attempts: FIXTURES.failedAttempts.filter((a) => a.engagementId === engagementId),
    ruledOut: FIXTURES.ruledOut.filter((r) => r.engagementId === engagementId),
    grants: FIXTURES.accessGrants.filter((g) => g.engagementId === engagementId),
    usernames: FIXTURES.usernames.filter((u) => u.engagementId === engagementId),
    hops: FIXTURES.hops.filter((h) => h.engagementId === engagementId),
    cleanup: FIXTURES.cleanup.filter((c) => c.engagementId === engagementId),
    notes: FIXTURES.notes.filter((n) => n.engagementId === engagementId),
    credentials: FIXTURES.credentials.filter((c) => c.engagementId === engagementId),
    credAttempts: FIXTURES.credAttempts.filter((c) => c.engagementId === engagementId),
  };
}

const garnet = garnetFixtures(1_700_000_000_000);
const exam = engagementData("e-exam");
const engagements = FIXTURES.engagements.map((e) => e.id);

describe("report builders' JSON (characterization)", () => {
  it("buildPlainTarget: garnet", () => {
    const target: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
    expect(json(buildPlainTarget(garnet, target, {}))).toMatchSnapshot();
  });

  it.each(engagements)("buildPlainTarget: every target of %s", (id) => {
    const data = engagementData(id);
    expect(json(reportTargets(data, {}).map((t) => buildPlainTarget(data, t, {})))).toMatchSnapshot();
  });

  it.each(engagements)("plainTable: every kind for %s", (id) => {
    const data = engagementData(id);
    expect(json(PLAIN_TABLE_KINDS.map((k) => plainTable(k, data, {})))).toMatchSnapshot();
  });

  it("flattenToPlain: the stored layout 3, 4 and 5 pages", () => {
    const web01: ReportTarget = { key: "h-exam-web", kind: "standalone", hostIds: ["h-exam-web"] };
    const ms01: ReportTarget = { key: "h-exam-ms01", kind: "standalone", hostIds: ["h-exam-ms01"] };
    expect(
      json([
        flattenToPlain(layout5Json as ReportNode, exam, web01, {}),
        flattenToPlain(layout4Json as ReportNode, exam, ms01, {}),
        flattenToPlain(layout3Json as ReportNode, exam, null, {}),
        flattenToPlain(layout4Json as ReportNode),
      ]),
    ).toMatchSnapshot();
  });

  it("findingBlocks and labelled: every fixture finding's text, and Markdown edge cases", () => {
    const texts = [
      ...FIXTURES.findings.flatMap((f) => [f.description ?? "", f.remediation ?? "", f.exploitNotes ?? ""]),
      ...garnet.findings.flatMap((f) => [f.description ?? "", f.remediation ?? "", f.exploitNotes ?? ""]),
      "",
      "One line with `code`, **bold**, *italic* and [a link](https://example.com).",
      "- one\n- two\n\n1. first\n2) second\n\n- alone",
      "## A heading\nwrapped\nline\n- looks like an item",
      "| A | B |\n| --- | --- |\n| `x` | **y** |\n| 1 | |",
      "Run this:\n\n```\n\n```\n\nand\n\n```bash\n  indented\n    more\n```",
      "$ id\nuid=0(root) gid=0(root)\n\nThen prose.",
    ];
    expect(json(texts.map((t) => findingBlocks(t)))).toMatchSnapshot();
    expect(json(texts.map((t) => labelled("Label:", findingBlocks(t))))).toMatchSnapshot();
  });

  it("buildSectionDraft: every report-level kind, with and without Settings text", () => {
    const kinds: SectionKind[] = ["details", "introduction", "summary", "considerations", "methodology", "engagement-tested", "further", "references", "target"];
    const blank = { reportMethodology: "", reportIntroduction: "" } as Settings;
    const written = {
      reportMethodology: "Hard-wrapped\nlines join.\n\n- a bullet\n  that wraps\n• another\n\nAfter.",
      reportIntroduction: "Lead text.\n\n1.2 Objective\nGet root.\n\nRequirements:\n* one\n* two",
    } as Settings;
    expect(json(kinds.map((k) => buildSectionDraft(k, exam, blank)))).toMatchSnapshot();
    expect(json(kinds.map((k) => buildSectionDraft(k, exam, written)))).toMatchSnapshot();
  });
});
