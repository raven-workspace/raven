import { createEditor, type NodeJSON } from "prosekit/core";
import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import { applyKeep, buildPlainTarget, flattenToPlain, needsFlatten, PAGE_NODE_TYPES, targetChecks, type ReportData, type ReportNode, type ReportTarget } from "../engines/report";
import { defineReportExtension } from "../features/report/editor/extension";
import type { LogEntry } from "../types/log";
import layout3Json from "./fixtures/report-layout3-owner.json";
import layout4Json from "./fixtures/report-layout4-ms01.json";
import layout5Json from "./fixtures/report-layout5-web01.json";

const layout5 = layout5Json as ReportNode;
const layout4 = layout4Json as ReportNode;
const layout3 = layout3Json as ReportNode;

/** The exam engagement's report data as the audit serves it, plus the root-shell screenshot the layout-5 page places. */
function examData(): ReportData {
  const E = "e-exam";
  const hosts = FIXTURES.hosts.filter((h) => h.engagementId === E);
  const ids = new Set(hosts.map((h) => h.id));
  const log = FIXTURES.log.filter((e) => e.engagementId === E);
  const proof = log.find((e) => e.id === "l-exam-web01-proof")!;
  const shot: LogEntry = {
    ...proof,
    id: "l-exam-web01-root-shot",
    kind: "screenshot",
    title: "Root shell as root on web01",
    content: { kind: "screenshot", attachmentId: "a-web01-root", caption: "Root shell as root on web01", fileName: "web01-root.png" },
  };
  return {
    engagement: FIXTURES.engagements.find((e) => e.id === E)!,
    hosts,
    services: FIXTURES.services.filter((s) => ids.has(s.hostId)),
    log: [...log, shot],
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
const web01Target: ReportTarget = { key: "h-exam-web", kind: "standalone", hostIds: ["h-exam-web"] };
const ms01Target: ReportTarget = { key: "h-exam-ms01", kind: "standalone", hostIds: ["h-exam-ms01"] };
const garnet = garnetFixtures(1_700_000_000_000);
const garnetTarget: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };

const strings = (n: ReportNode): string[] => [...(n.text ? [n.text] : []), ...(n.content ?? []).flatMap(strings)];
const types = (n: ReportNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];
const all = (n: ReportNode): ReportNode[] => [n, ...(n.content ?? []).flatMap(all)];
const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");
const onlyPageTypes = (n: ReportNode) => types(n).every((t) => PAGE_NODE_TYPES.includes(t));

/** Every non-empty line a stored page holds that the owner may have typed or kept: its text nodes, and the strings its
 *  atoms hold in attrs (evidence copies, captions, slot labels, exploit copies, port notes). Output lines outside an
 *  evidence block's kept ranges are left out (the page never printed them), unless the block is split to an appendix. */
function ownerLines(doc: ReportNode): string[] {
  const out: string[] = [];
  const add = (s: unknown) => {
    if (typeof s === "string") for (const l of s.split(/\r?\n/)) if (l.trim() !== "") out.push(l.trim());
  };
  const walk = (n: ReportNode) => {
    add(n.text);
    const a = (n.attrs ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (n.type === "evidence") {
      add(a.caption);
      if (a.copy) {
        add(a.copy.command);
        add(a.copy.value);
        add(a.copy.proof);
        if (typeof a.copy.output === "string") {
          for (const item of applyKeep(a.copy.output, a.appendix === "split" ? null : (a.keep ?? null))) if (item.kind === "line") add(item.text);
        }
      }
    }
    // An empty slot prints nothing (a hint paragraph): its label is the draft's, not text the owner wrote.
    if (n.type === "slot" && (n.content ?? []).length > 0) add(a.label);
    if (n.type === "exploit") add(a.copy?.content);
    if (n.type === "generated") Object.values(a.notes ?? {}).forEach(add);
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}
/** The lines a flattened page prints, each text node split into its lines. */
const printedLines = (doc: ReportNode) => new Set(strings(doc).flatMap((s) => s.split(/\r?\n/)).map((l) => l.trim()));

/** Screenshot evidence, plus flag evidence whose entry carries a picture: each is one figure on the flattened page. */
function pictures(doc: ReportNode, data: ReportData): number {
  return all(doc).filter((n) => {
    const e = n.type === "evidence" ? data.log.find((l) => l.id === n.attrs?.entryId) : undefined;
    return !!e && !e.private && (e.content.kind === "screenshot" || (e.content.kind === "flag" && !!e.content.attachmentId));
  }).length;
}

describe("flattenToPlain", () => {
  it("PAGE_NODE_TYPES is the plain schema plus the owner's blockquote and rule", () => {
    expect(PAGE_NODE_TYPES).toContain("figure");
    expect(PAGE_NODE_TYPES).toContain("blockquote");
    expect(PAGE_NODE_TYPES).toContain("horizontalRule");
    expect(PAGE_NODE_TYPES).not.toContain("slot");
  });

  it("targetChecks over the flattened layout-5 web01 page raises no fail", () => {
    const flat = flattenToPlain(layout5, exam, web01Target, {});
    const checks = targetChecks({ data: exam, target: web01Target, doc: flat, meta: {}, sectionId: "t-web" });
    expect(checks.filter((c) => c.level === "fail").map((c) => c.id)).toEqual([]);
  });

  it("flattenToPlain keeps every string of a layout-5 page", () => {
    const flat = flattenToPlain(layout5, exam, web01Target, {});
    const text = strings(flat).join("\n");
    for (const s of ["I read the backup config through the LFI first.", "Admin panel on 8080", "The upload filter trusts the extension only.", "Root shell on web01"]) {
      expect(text).toContain(s);
    }
    for (const s of strings(layout5)) expect(text).toContain(s.trim().split("\n")[0]); // every original string's first line survives
    expect(onlyPageTypes(flat)).toBe(true);
  });

  it("prints every line the owner typed or kept, as a whole line, and one figure per picture", () => {
    for (const [doc, target] of [
      [layout5, web01Target],
      [layout4, ms01Target],
      [layout3, null],
    ] as const) {
      const flat = flattenToPlain(doc, exam, target, {});
      const printed = printedLines(flat);
      const missing = ownerLines(doc).filter((l) => !printed.has(l));
      expect(missing).toEqual([]);
      expect(all(flat).filter((n) => n.type === "figure").length).toBe(pictures(doc, exam));
    }
  });

  it("writes a layout-5 page's copies as code blocks, its screenshot as a figure with the owner's caption, its phases as headings", () => {
    const flat = flattenToPlain(layout5, exam, web01Target, {});
    const figure = all(flat).find((n) => n.type === "figure" && n.attrs?.entryId === "l-exam-web01-root-shot")!;
    expect(figure.attrs).toEqual({ attachmentId: "a-web01-root", entryId: "l-exam-web01-root-shot", source: "entry:l-exam-web01-root-shot" });
    expect(textOf(figure)).toBe("Root shell on web01");
    const sudo = all(flat).filter((n) => n.type === "codeBlock" && String(n.attrs?.source).startsWith("entry:l-exam-web01-sudo:"));
    expect(sudo.map((n) => n.attrs?.source)).toEqual(["entry:l-exam-web01-sudo:0:command", "entry:l-exam-web01-sudo:0:output"]);
    const headings = (flat.content ?? []).filter((n) => n.type === "heading");
    expect(headings[0]).toMatchObject({ attrs: { level: 1, source: "facts:h-exam-web" } });
    // Worded as the plain draft writes them, so a flattened page reads like a rebuilt one.
    expect(headings.map(textOf)).toContain("Initial access");
    expect(headings.map(textOf)).toContain("Service enumeration");
    expect(headings.find((h) => textOf(h) === "Datasource password in the Grafana provisioning repo")?.attrs).toEqual({
      level: 3,
      source: "phase:h-exam-web:additional:f-exam-grafana-repo",
    });
    const ports = (flat.content ?? []).find((n) => n.type === "table" && n.attrs?.source === "ports:h-exam-web");
    expect(textOf(ports!)).toContain("Admin panel on 8080");
  });

  it("applies an evidence copy's kept ranges, the gaps written as omitted lines", () => {
    const doc: ReportNode = {
      type: "doc",
      content: [
        {
          type: "evidence",
          attrs: { entryId: "x", block: 2, keep: [[0, 0], [3, 3]], emphasis: [], appendix: "inline", copy: { command: "cat log", output: "a\nb\nc\nd\ne" } },
        },
      ],
    };
    expect(flattenToPlain(doc).content).toEqual([
      { type: "codeBlock", attrs: { language: "", source: "entry:x:2:command" }, content: [{ type: "text", text: "cat log" }] },
      { type: "codeBlock", attrs: { language: "", source: "entry:x:2:output" }, content: [{ type: "text", text: "a\n[… 2 lines omitted …]\nd\n[… 1 line omitted …]" }] },
    ]);
  });

  const evidenceDoc = (attrs: Record<string, unknown>): ReportNode => ({
    type: "doc",
    content: [{ type: "evidence", attrs: { block: null, keep: null, emphasis: [], appendix: "inline", ...attrs } }],
  });
  const code = (doc: ReportNode) => (doc.content ?? []).map((n) => [n.attrs?.source, textOf(n)]);
  const withEntry = (e: Partial<LogEntry> & Pick<LogEntry, "id" | "content">): ReportData =>
    ({ ...exam, log: [...exam.log, { ...exam.log[0], kind: e.content.kind, private: false, ...e } as LogEntry] }) as ReportData;

  it("does not print a stored copy whose entry is now private", () => {
    const data = withEntry({ id: "p1", private: true, content: { kind: "command", blocks: [{ command: "id", output: "uid=0(root)" }] } });
    const doc = evidenceDoc({ entryId: "p1", block: 0, copy: { command: "id", output: "uid=0(root)" } });
    expect(flattenToPlain(doc, data).content).toEqual([{ type: "paragraph" }]);
    // Without data nothing says it is private: the page's own copy prints.
    expect(code(flattenToPlain(doc))).toEqual([["entry:p1:0:command", "id"], ["entry:p1:0:output", "uid=0(root)"]]);
  });

  it("a list, quote or cell emptied by a private entry's copy keeps an empty paragraph, so the page always validates", () => {
    const data = withEntry({ id: "p1", private: true, content: { kind: "command", blocks: [{ command: "id", output: "uid=0(root)" }] } });
    const copy = { type: "evidence", attrs: { entryId: "p1", block: 0, keep: null, emphasis: [], appendix: "inline", copy: { command: "id", output: "uid=0(root)" } } };
    const cell = (type: string) => ({ type, content: [copy] });
    const doc: ReportNode = {
      type: "doc",
      content: [
        { type: "list", attrs: { kind: "ordered" }, content: [copy] },
        { type: "blockquote", content: [copy] },
        { type: "table", content: [{ type: "tableRow", content: [cell("tableHeaderCell")] }, { type: "tableRow", content: [cell("tableCell")] }] },
      ],
    };
    const flat = flattenToPlain(doc, data);
    expect(flat.content![0]).toEqual({ type: "list", attrs: { kind: "ordered" }, content: [{ type: "paragraph" }] });
    expect(flat.content![1]).toEqual({ type: "blockquote", content: [{ type: "paragraph" }] });
    const schema = createEditor({ extension: defineReportExtension() }).schema;
    expect(() => schema.nodeFromJSON(flat as NodeJSON).check()).not.toThrow();
    // A page with nothing left is one empty paragraph.
    const gone = flattenToPlain(evidenceDoc({ entryId: "p1", block: 0, copy: { command: "id", output: "uid=0(root)" } }), data);
    expect(() => schema.nodeFromJSON(gone as NodeJSON).check()).not.toThrow();
  });

  it("prints a split block's whole output, from its copy or else the log", () => {
    const blocks = [{ command: "cat log", output: "a\nb\nc\nd" }];
    const data = withEntry({ id: "s1", content: { kind: "command", blocks } });
    const split = { entryId: "s1", block: 0, keep: [[0, 0]], appendix: "split" };
    expect(code(flattenToPlain(evidenceDoc({ ...split, copy: { command: "cat log", output: "a\nb\nc\nd" } }), data))).toEqual([
      ["entry:s1:0:command", "cat log"],
      ["entry:s1:0:output", "a\nb\nc\nd"],
    ]);
    expect(code(flattenToPlain(evidenceDoc(split), data))).toEqual([
      ["entry:s1:0:command", "cat log"],
      ["entry:s1:0:output", "a\nb\nc\nd"],
    ]);
  });

  it("puts each command of a whole multi-block copy above its own output, kept ranges per block", () => {
    const blocks = [
      { command: "whoami", output: "dev" },
      { command: "id", output: "uid=1000(dev)\ngroups=1000(dev)" },
    ];
    const data = withEntry({ id: "m1", content: { kind: "command", blocks } });
    const doc = evidenceDoc({ entryId: "m1", keep: [[0, 1]], copy: { command: "whoami\nid", output: "dev\nuid=1000(dev)\ngroups=1000(dev)" } });
    expect(code(flattenToPlain(doc, data))).toEqual([
      ["entry:m1:0:command", "whoami"],
      ["entry:m1:0:output", "dev"],
      ["entry:m1:1:command", "id"],
      ["entry:m1:1:output", "uid=1000(dev)\n[… 1 line omitted …]"],
    ]);
  });

  it("restores a cut copy's full text from the log", () => {
    const data = withEntry({ id: "t1", content: { kind: "command", blocks: [{ command: "cat big", output: "line one\nline two" }] } });
    const doc = evidenceDoc({ entryId: "t1", block: 0, truncated: true, copy: { command: "cat big", output: "line one\nli" } });
    expect(code(flattenToPlain(doc, data))).toEqual([["entry:t1:0:command", "cat big"], ["entry:t1:0:output", "line one\nline two"]]);
  });

  it("prints a flag copy's proof, its value when the proof lacks it, and its picture", () => {
    const data = withEntry({ id: "f1", content: { kind: "flag", flagKind: "local", value: "abc", proof: "cat local.txt\nabc", attachmentId: "a-f1" } });
    const flat = flattenToPlain(evidenceDoc({ entryId: "f1", copy: { value: "edited-value", proof: "cat local.txt\nabc" } }), data);
    expect(code(flat)).toEqual([
      ["entry:f1:proof", "cat local.txt\nabc"],
      ["entry:f1:value", "edited-value"],
      ["entry:f1", "local.txt"],
    ]);
    expect(flat.content?.[2].attrs).toEqual({ attachmentId: "a-f1", entryId: "f1", source: "entry:f1" });
    const same = flattenToPlain(evidenceDoc({ entryId: "f1", copy: { value: "abc", proof: "cat local.txt\nabc" } }), data);
    expect(code(same).map(([s]) => s)).toEqual(["entry:f1:proof", "entry:f1"]);
  });

  it("does not change the page it was given", () => {
    const before = JSON.stringify(layout5);
    flattenToPlain(layout5, exam, web01Target, {});
    expect(JSON.stringify(layout5)).toBe(before);
  });

  it("a layout-4 page's copy-less evidence is rendered from the log when data is given, dropped without it", () => {
    expect(types(flattenToPlain(layout4, exam, ms01Target, {}))).toContain("codeBlock");
    expect(onlyPageTypes(flattenToPlain(layout4, exam, ms01Target, {}))).toBe(true);
    const bare = flattenToPlain(layout4);
    expect(onlyPageTypes(bare)).toBe(true);
    expect(types(bare)).not.toContain("codeBlock");
  });

  it("renders each command block of a layout-4 step once, with no sentence of its own", () => {
    const flat = flattenToPlain(layout4, exam, ms01Target, {});
    const sources = all(flat).flatMap((n) => (typeof n.attrs?.source === "string" ? [n.attrs.source] : []));
    const rce = sources.filter((s) => s.startsWith("entry:l-exam-ms01-rce:"));
    expect(rce.length).toBe(new Set(rce).size);
    expect(rce.some((s) => s.endsWith(":title") || s.endsWith(":observations"))).toBe(false);
  });

  it("an owner page's slot text becomes a paragraph and its evidence a code block or figure", () => {
    const flat = flattenToPlain(layout3, exam, null, {});
    const top = flat.content ?? [];
    expect(top[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Every tool ran from the attacking machine unless the step says otherwise." }] });
    expect(top.slice(1, -1).every((n) => n.type === "codeBlock" || n.type === "figure")).toBe(true);
    expect(top.slice(1, -1).length).toBeGreaterThan(0);
    expect(top[top.length - 1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "The sudo rule is the way to root." }] });
    expect(onlyPageTypes(flat)).toBe(true);
  });

  it("an empty slot becomes a hint paragraph", () => {
    expect(flattenToPlain({ type: "doc", content: [{ type: "slot", attrs: { hint: "Wrap-up" } }] }).content).toEqual([{ type: "paragraph", attrs: { hint: "Wrap-up" } }]);
  });

  it("a labelled slot leads with its label in bold", () => {
    const slot: ReportNode = { type: "slot", attrs: { hint: "How to fix it", label: "Vulnerability Fix:" }, content: [{ type: "text", text: "Patch it." }] };
    expect(flattenToPlain({ type: "doc", content: [slot] }).content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Vulnerability Fix:", marks: [{ type: "bold" }] }, { type: "text", text: " " }, { type: "text", text: "Patch it." }] },
    ]);
  });

  it("a steps list becomes one numbered item per step", () => {
    const para = (t: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const doc: ReportNode = {
      type: "doc",
      content: [{ type: "steps", content: [{ type: "step", attrs: { entryId: null }, content: [para("one")] }, { type: "step", attrs: { entryId: null }, content: [para("two")] }] }],
    };
    expect(flattenToPlain(doc).content).toEqual([
      { type: "list", attrs: { kind: "ordered" }, content: [para("one")] },
      { type: "list", attrs: { kind: "ordered" }, content: [para("two")] },
    ]);
  });

  it("a note's paragraph keeps its entry as a source; observations keep theirs", () => {
    const doc: ReportNode = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { fromEntry: "n1", fromField: null }, content: [{ type: "text", text: "note" }] },
        { type: "paragraph", attrs: { fromEntry: "e1", fromField: "observations" }, content: [{ type: "text", text: "said" }] },
      ],
    };
    expect(flattenToPlain(doc).content?.map((n) => n.attrs)).toEqual([{ source: "entry:n1:note" }, { source: "entry:e1:observations" }]);
  });

  it("keeps a layout-4 port table's Notes, even with no data to rebuild the table from", () => {
    const ports: ReportNode = { type: "generated", attrs: { kind: "ports", hostId: "h", appendix: "inline", notes: { s1: "Login page" } } };
    expect(strings(flattenToPlain({ type: "doc", content: [ports] }))).toEqual(["Login page"]);
  });

  it("is idempotent on plain pages", () => {
    const plain = buildPlainTarget(garnet, garnetTarget, {});
    expect(flattenToPlain(plain, garnet, garnetTarget, {})).toEqual(plain);
    expect(flattenToPlain(plain)).toEqual(plain);
    expect(needsFlatten(plain)).toBe(false);
    expect(needsFlatten(layout5)).toBe(true);
    const flat = flattenToPlain(layout5, exam, web01Target, {});
    expect(needsFlatten(flat)).toBe(false);
    expect(flattenToPlain(flat, exam, web01Target, {})).toEqual(flat);
  });

  it("flattened blocks carry no gen, so Refresh treats them as edited", () => {
    const walk = (n: ReportNode): boolean => n.attrs?.gen === undefined && (n.content ?? []).every(walk);
    expect(walk(flattenToPlain(layout5, exam, web01Target, {}))).toBe(true);
    expect(walk(flattenToPlain(layout4, exam, ms01Target, {}))).toBe(true);
  });
});

describe("the old page machinery is gone", () => {
  it("no source file outside flatten.ts names a removed node type", async () => {
    const files = import.meta.glob("../{engines,features,dev}/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const OLD = /type:\s*"(slot|generated|evidence|finding|table-block|steps|step|phase|vuln|exploit)"|name:\s*"(slot|generated|evidence|finding|table-block|steps|step|phase|vuln|exploit)"/;
    const hits = Object.entries(files).filter(([path, src]) => !path.endsWith("/flatten.ts") && OLD.test(src)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
});
