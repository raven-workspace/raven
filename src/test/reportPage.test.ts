import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import {
  alsoShows,
  blockSource,
  buildPlainTarget,
  buildSectionDraft,
  copiedFrom,
  entriesNamedBy,
  isCopiedFrom,
  parseSource,
  placedIn,
  removalKeys,
  reportTargets,
  stillRemoved,
  source,
  sourceString,
  testedListOf,
  unlinkCopiedFrom,
  type BlockSource,
  type ReportData,
  type ReportNode,
} from "../engines/report";
import type { SectionKind } from "../types/report";
import type { Settings } from "../types/settings";

/**
 * The Block source format is saved on every block of every page in the vault, so these strings never change. Each
 * kind is pinned here as it is written, then read back.
 */
const GOLDEN: [string, BlockSource][] = [
  ["entry:l1", { kind: "entry", entryId: "l1", part: null }],
  ["entry:l1:title", { kind: "entry", entryId: "l1", part: { name: "title" } }],
  ["entry:l1:observations", { kind: "entry", entryId: "l1", part: { name: "observations" } }],
  ["entry:l1:request", { kind: "entry", entryId: "l1", part: { name: "request" } }],
  ["entry:l1:response", { kind: "entry", entryId: "l1", part: { name: "response" } }],
  ["entry:l1:note", { kind: "entry", entryId: "l1", part: { name: "note" } }],
  ["entry:l1:proof", { kind: "entry", entryId: "l1", part: { name: "proof" } }],
  ["entry:l1:value", { kind: "entry", entryId: "l1", part: { name: "value" } }],
  ["entry:l1:0:command", { kind: "entry", entryId: "l1", part: { run: 0, side: "command" } }],
  ["entry:l1:12:output", { kind: "entry", entryId: "l1", part: { run: 12, side: "output" } }],
  ["finding:f1", { kind: "finding", findingId: "f1", part: null }],
  ["finding:f1:explanation", { kind: "finding", findingId: "f1", part: "explanation" }],
  ["finding:f1:fix", { kind: "finding", findingId: "f1", part: "fix" }],
  ["finding:f1:severity", { kind: "finding", findingId: "f1", part: "severity" }],
  ["finding:f1:affected", { kind: "finding", findingId: "f1", part: "affected" }],
  ["finding:f1:exploit", { kind: "finding", findingId: "f1", part: "exploit" }],
  ["file:ff1", { kind: "file", fileId: "ff1" }],
  ["facts:h1", { kind: "facts", hostId: "h1" }],
  ["result:h1", { kind: "result", hostId: "h1" }],
  ["ports:h1", { kind: "ports", hostId: "h1" }],
  ["tested:h1", { kind: "tested", hostId: "h1" }],
  ["phase-steps:h1", { kind: "phase-steps", hostId: "h1" }],
  ["phase:h1:initial", { kind: "phase", hostId: "h1", phase: "initial", findingId: null }],
  ["phase:h1:initial:f1", { kind: "phase", hostId: "h1", phase: "initial", findingId: "f1" }],
  ["table:findings", { kind: "table", table: "findings" }],
  ["msf", { kind: "msf" }],
  ["attack-path", { kind: "attack-path" }],
];

describe("Block source format", () => {
  it.each(GOLDEN)("reads %s and writes it back byte for byte", (raw, parsed) => {
    expect(parseSource(raw)).toEqual(parsed);
    expect(sourceString(parsed)).toBe(raw);
  });

  it("builds every kind as it is saved", () => {
    expect([
      source.entry("l1"),
      source.entry("l1", "title"),
      source.entry("l1", "observations"),
      source.entry("l1", "request"),
      source.entry("l1", "response"),
      source.entry("l1", "note"),
      source.entry("l1", "proof"),
      source.entry("l1", "value"),
      source.entryRun("l1", 0, "command"),
      source.entryRun("l1", 12, "output"),
      source.finding("f1"),
      source.finding("f1", "explanation"),
      source.finding("f1", "fix"),
      source.finding("f1", "severity"),
      source.finding("f1", "affected"),
      source.finding("f1", "exploit"),
      source.file("ff1"),
      source.facts("h1"),
      source.result("h1"),
      source.ports("h1"),
      source.tested("h1"),
      source.phaseSteps("h1"),
      source.phase("h1", "initial"),
      source.phase("h1", "initial", "f1"),
      source.table("findings"),
      source.msf,
      source.attackPath,
    ]).toEqual(GOLDEN.map(([raw]) => raw));
    expect(source.host("ports", "h1")).toBe("ports:h1");
  });

  it("keeps an entry's or a finding's id when its part is one no longer written", () => {
    expect(parseSource("entry:l1:sentence")).toEqual({ kind: "entry", entryId: "l1", part: { unknown: "sentence" } });
    expect(parseSource("entry:l1:3:stderr")).toEqual({ kind: "entry", entryId: "l1", part: { unknown: "3:stderr" } });
    expect(sourceString(parseSource("entry:l1:3:stderr")!)).toBe("entry:l1:3:stderr");
    expect(parseSource("finding:f1:impact")).toEqual({ kind: "finding", findingId: "f1", part: "unknown" });
  });

  it("reads anything that is no known kind, or lacks its ids, as no source", () => {
    for (const raw of ["", "entry:", "finding:", "file:", "facts:", "facts:h1:x", "phase:h1", "phase:h1:a:b:c", "table:", "table:a:b", "notes:h1", "msf:x", "attack-path:x", "whatever"]) {
      expect([raw, parseSource(raw)]).toEqual([raw, null]);
    }
    expect(parseSource(null)).toBeNull();
    expect(parseSource(undefined)).toBeNull();
  });
});

describe("what one block names", () => {
  const block = (type: string, attrs: Record<string, unknown>) => ({ type, attrs });

  it("reads a block's source off its attrs", () => {
    expect(blockSource(block("paragraph", { source: "entry:l1:title" }))).toEqual({ kind: "entry", entryId: "l1", part: { name: "title" } });
    expect(blockSource(block("paragraph", {}))).toBeNull();
    expect(blockSource({ type: "paragraph" })).toBeNull();
  });

  it("tells copied from apart from also shows", () => {
    const output = block("codeBlock", { source: "entry:l1:0:output", also: ["flag1"] });
    expect(copiedFrom(output)).toBe("l1");
    expect(alsoShows(output)).toEqual(["flag1"]);
    expect(isCopiedFrom(output, "flag1")).toBe(false);
    expect(entriesNamedBy(output)).toEqual(["l1", "flag1"]);
  });

  it("reads a figure as copied from the entry it shows, by its entry first", () => {
    expect(copiedFrom(block("figure", { entryId: "s1", source: "entry:s1" }))).toBe("s1");
    expect(copiedFrom(block("figure", { entryId: "s1" }))).toBe("s1");
    expect(copiedFrom(block("figure", { entryId: "", source: "entry:s2" }))).toBe("s2");
    // Only a figure's entryId counts.
    expect(copiedFrom(block("paragraph", { entryId: "s1" }))).toBeNull();
  });

  it("names no entry for a block from a finding, a machine or Raven", () => {
    for (const s of ["finding:f1:fix", "file:ff1", "facts:h1", "phase:h1:initial", "table:findings", "msf"]) {
      expect([s, copiedFrom(block("paragraph", { source: s })), entriesNamedBy(block("paragraph", { source: s }))]).toEqual([s, null, []]);
    }
  });

  it("reads a machine's Also tested list off its bullets", () => {
    expect(testedListOf(block("list", { source: "tested:h1" }))).toBe("h1");
    expect(testedListOf(block("heading", { source: "phase:h1:tested" }))).toBeNull();
  });

  it("drops a block's copied-from link and leaves what it also shows", () => {
    expect(unlinkCopiedFrom(block("codeBlock", { source: "entry:l1:0:output", gen: "abc", also: ["flag1"] }), "l1")).toEqual({ source: null, gen: null, also: ["flag1"] });
    expect(unlinkCopiedFrom(block("figure", { entryId: "s1", source: "entry:s1", gen: "abc" }), "s1")).toEqual({ entryId: null, source: null, gen: null });
    expect(unlinkCopiedFrom(block("codeBlock", { source: "entry:l1:0:output", also: ["flag1"] }), "flag1")).toBeNull();
    expect(unlinkCopiedFrom(block("paragraph", { source: "finding:f1:fix" }), "f1")).toBeNull();
  });
});

describe("what a page places", () => {
  const page: ReportNode = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { source: "entry:l1:title" } },
      { type: "codeBlock", attrs: { source: "entry:l1:0:output", also: ["flag1"] } },
      { type: "figure", attrs: { entryId: "s1", source: "entry:s1" } },
      { type: "list", attrs: { kind: "bullet", source: "tested:h1" }, content: [{ type: "paragraph", attrs: { source: "finding:f1:fix" } }] },
    ],
  };

  it("reads entries and Also tested lists apart, at any depth", () => {
    expect(placedIn(page)).toEqual({ entries: new Set(["l1", "flag1", "s1"]), testedLists: new Set(["h1"]) });
  });

  it("reads a block without its children as what it places itself", () => {
    expect(placedIn({ type: "list", attrs: { source: "tested:h1" } })).toEqual({ entries: new Set(), testedLists: new Set(["h1"]) });
  });

  it("records what was taken off as the keys removedEntryIds has always held", () => {
    expect(removalKeys({ entries: new Set(["l1"]), testedLists: new Set(["h1"]) })).toEqual(["l1", "tested:h1"]);
  });

  it("keeps only the removal keys the page no longer places", () => {
    expect(stillRemoved(["l1", "l2", "tested:h1", "tested:h2"], page)).toEqual(["l2", "tested:h2"]);
  });
});

/** The exam engagement's report data as the audit serves it. */
function examFixtureData(): ReportData {
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

const sourcesIn = (n: ReportNode): string[] => [
  ...(typeof n.attrs?.source === "string" && n.attrs.source !== "" ? [n.attrs.source] : []),
  ...(n.content ?? []).flatMap(sourcesIn),
];

describe("the sources the draft writes", () => {
  const exam = examFixtureData();
  const garnet = garnetFixtures(1_700_000_000_000);
  const settings = { reportMethodology: "", reportIntroduction: "" } as Settings;
  const SECTIONS: SectionKind[] = ["introduction", "summary", "considerations", "methodology", "engagement-tested", "further", "references"] as SectionKind[];
  const drafted = [
    ...reportTargets(exam, {}).flatMap((t) => sourcesIn(buildPlainTarget(exam, t, {}))),
    ...sourcesIn(buildPlainTarget(garnet, { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] }, {})),
    ...SECTIONS.flatMap((k) => sourcesIn(buildSectionDraft(k, exam, settings))),
  ];

  it("are every one a known kind, written back unchanged", () => {
    for (const raw of drafted) expect([raw, sourceString(parseSource(raw) ?? { kind: "msf" })]).toEqual([raw, raw]);
  });

  it("stay exactly as they were", () => {
    expect([...new Set(drafted)].sort()).toMatchSnapshot();
  });
});
