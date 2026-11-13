import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import { buildPlainTarget, flattenToPlain, needsFlatten, PAGE_NODE_TYPES, type ReportData, type ReportNode, type ReportTarget } from "../engines/report";
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

describe("flattenToPlain", () => {
  it("PAGE_NODE_TYPES is the plain schema plus the owner's blockquote and rule", () => {
    expect(PAGE_NODE_TYPES).toContain("figure");
    expect(PAGE_NODE_TYPES).toContain("blockquote");
    expect(PAGE_NODE_TYPES).toContain("horizontalRule");
    expect(PAGE_NODE_TYPES).not.toContain("slot");
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

  it("writes a layout-5 page's copies as code blocks, its screenshot as a figure with the owner's caption, its phases as headings", () => {
    const flat = flattenToPlain(layout5, exam, web01Target, {});
    const figure = all(flat).find((n) => n.type === "figure")!;
    expect(figure.attrs).toEqual({ attachmentId: "a-web01-root", entryId: "l-exam-web01-root-shot", source: "entry:l-exam-web01-root-shot" });
    expect(textOf(figure)).toBe("Root shell on web01");
    const sudo = all(flat).filter((n) => n.type === "codeBlock" && String(n.attrs?.source).startsWith("entry:l-exam-web01-sudo:"));
    expect(sudo.map((n) => n.attrs?.source)).toEqual(["entry:l-exam-web01-sudo:0:command", "entry:l-exam-web01-sudo:0:output"]);
    const headings = (flat.content ?? []).filter((n) => n.type === "heading");
    expect(headings[0]).toMatchObject({ attrs: { level: 1, source: "facts:h-exam-web" } });
    expect(headings.map(textOf)).toContain("Initial Access");
    expect(headings.map(textOf)).toContain("Additional findings – Datasource password in the Grafana provisioning repo");
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
