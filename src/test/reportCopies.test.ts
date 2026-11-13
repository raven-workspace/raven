import { describe, expect, it } from "vitest";
import { examFixtures } from "../audit/examFixtures";
import {
  evidenceCopy,
  findingBlocks,
  findingCopy,
  refreshNode,
  tableCopy,
  terminalBlocks,
  upgradeDoc,
} from "../engines/report";
import type { ReportData, ReportNode, ReportTarget } from "../engines/report";
import type { Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Service } from "../types/service";

const fixtures = examFixtures(1_700_000_000_000);
const gitCreds = fixtures.findings.find((f) => f.id === "f-exam-grafana-repo")!;

const finding = (over: Partial<Finding>): Finding =>
  ({ id: "f1", title: "Finding", severity: "high", cvssVector: null, description: "", remediation: "", refs: [], hostIds: ["h1"], serviceIds: [], stepEntryIds: [], ...over }) as Finding;

const all = (n: ReportNode): ReportNode[] => [n, ...(n.content ?? []).flatMap(all)];
const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");

describe("terminalBlocks", () => {
  it("splits the grafana-repo description into prose, the pasted commit and diff as code, then prose", () => {
    const runs = terminalBlocks(gitCreds.description);
    expect(runs.map((r) => r.kind)).toEqual(["prose", "code", "prose"]);
    expect(runs[1].text.startsWith("commit 4be1")).toBe(true);
    expect(runs[1].text.endsWith("+} +?>")).toBe(true);
    expect(runs[1].text).toContain('-    private $password = "CopperKite71";');
    expect(runs[2].text.trim()).toBe("Affected: http-git (port 80)");
  });

  it("takes a fenced block as code, fences dropped", () => {
    const runs = terminalBlocks("Run this:\n\n```bash\nid\nwhoami\n```\n\nThen read it.");
    expect(runs).toEqual([
      { kind: "prose", text: "Run this:" },
      { kind: "code", text: "id\nwhoami" },
      { kind: "prose", text: "Then read it." },
    ]);
  });

  it("keeps a single code-like line inside prose as prose", () => {
    expect(terminalBlocks("The config sets\n    PasswordAuthentication yes\nby default.").map((r) => r.kind)).toEqual(["prose"]);
  });

  it("keeps a diff's context line that lost its leading space in the diff; prose after a blank line stays prose", () => {
    const diff = "diff --git a/app.conf b/app.conf\n-debug = true\n+debug = false\n*keep* this";
    expect(terminalBlocks(diff)).toEqual([{ kind: "code", text: diff }]);
    const runs = terminalBlocks(`${diff}\n\nThen restart the service.`);
    expect(runs).toEqual([
      { kind: "code", text: diff },
      { kind: "prose", text: "Then restart the service." },
    ]);
    const blocks = findingBlocks(`${diff}\n\nThen restart the service.`);
    expect(blocks.map((b) => b.type)).toEqual(["codeBlock", "paragraph"]);
    expect(blocks[1].content).toEqual([{ type: "text", text: "Then restart the service." }]);
  });

  it("reads shell prompts and PowerShell prompts as code", () => {
    const runs = terminalBlocks("We ran:\n$ id\nPS C:\\> whoami\n");
    expect(runs.map((r) => r.kind)).toEqual(["prose", "code"]);
  });
});

describe("findingCopy", () => {
  it("gives prose with two `- item` lines a bullet list, and keeps diff lines as code, never a list", () => {
    const copy = findingCopy(finding({ description: "Two problems:\n- weak password\n- no lockout\n\n-    private $x\n+    private $y" }));
    const lists = all(copy).filter((n) => n.type === "list");
    expect(lists.map(textOf)).toEqual(["weak password", "no lockout"]);
    expect(lists.every((l) => l.attrs?.kind === "bullet")).toBe(true);
    const code = all(copy).filter((n) => n.type === "codeBlock");
    expect(code.map(textOf)).toEqual(["-    private $x\n+    private $y"]);
  });

  it("never turns a lone `-    private $x` into a list", () => {
    const copy = findingCopy(finding({ description: "Before the fix:\n-    private $x" }));
    expect(all(copy).some((n) => n.type === "list")).toBe(false);
    expect(textOf(copy)).toContain("-    private $x");
  });

  it("copies the grafana-repo finding as labelled parts with the diff in a code block, no italics", () => {
    const copy = findingCopy(gitCreds);
    expect(copy.type).toBe("finding");
    expect(copy.attrs).toEqual({ findingId: "f-exam-grafana-repo", edited: false });
    const kids = copy.content!;
    const labels = kids.flatMap((n) => (n.content?.[0]?.marks?.some((m) => m.type === "bold") ? [n.content[0].text] : []));
    expect(labels).toEqual(["Vulnerability Explanation:", "Vulnerability Fix:", "Severity:"]);
    expect(kids.find((n) => n.type === "codeBlock")?.content?.[0].text).toContain("diff --git a/datasources/mysql.yaml");
    expect(all(copy).some((n) => n.marks?.some((m) => m.type === "italic"))).toBe(false);
    expect(all(copy).some((n) => n.type === "list")).toBe(false);
    // Inline code in the prose is a code mark.
    expect(all(copy).some((n) => n.text === "/.git/" && n.marks?.some((m) => m.type === "code"))).toBe(true);
  });

  it("puts an empty Fix in a slot with its hint, never 'Not written yet'", () => {
    const copy = findingCopy(finding({ description: "Something.", remediation: "" }));
    expect(copy.content!.some((n) => n.type === "slot" && n.attrs?.hint === "How to fix it")).toBe(true);
    expect(JSON.stringify(copy)).not.toContain("Not written yet");
  });

  it("lists fix steps as bullets and prints severity with the CVSS vector and a leading Affected line", () => {
    const copy = findingCopy(
      finding({
        description: "Affected: web01 (port 80)\nThe upload checks only the extension.",
        remediation: "Validate the content type.\nStore uploads outside the web root.",
        severity: "critical",
        cvssVector: "CVSS:3.1/AV:N",
      }),
    );
    const texts = copy.content!.map(textOf);
    expect(texts[0]).toBe("Vulnerability Explanation: The upload checks only the extension.");
    expect(texts[1]).toBe("Vulnerability Fix:");
    expect(texts.slice(2, 4)).toEqual(["Validate the content type.", "Store uploads outside the web root."]);
    expect(texts[4]).toBe("Severity: Critical (CVSS:3.1/AV:N)");
    expect(texts[5]).toBe("Affected: web01 (port 80)");
  });
});

describe("evidenceCopy", () => {
  const big = "A".repeat(300 * 1024);
  const e = { id: "e1", kind: "command", private: false, hostIds: ["h1"], content: { kind: "command", blocks: [{ command: "cat big", output: big }] } } as LogEntry;

  it("caps a copy at 200 KB and says so", () => {
    const { copy, truncated } = evidenceCopy(e, 0);
    expect(truncated).toBe(true);
    expect(copy).toEqual({ command: "cat big", output: "A".repeat(200 * 1024) });
  });

  it("copies a flag's value and proof, and gives a screenshot no copy", () => {
    const flag = { id: "f", kind: "flag", content: { kind: "flag", flagKind: "proof", value: "abc", proof: "whoami\nroot" } } as LogEntry;
    expect(evidenceCopy(flag, null)).toEqual({ copy: { value: "abc", proof: "whoami\nroot" }, truncated: false });
    const shot = { id: "s", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "c", fileName: "s.png" } } as LogEntry;
    expect(evidenceCopy(shot, null)).toEqual({ copy: null, truncated: false });
  });
});

/* ------------------------------------------------------------------ upgrade */

const H = "h1";
const T: ReportTarget = { key: H, kind: "standalone", hostIds: [H] };

function data(): ReportData {
  const log: LogEntry[] = [
    { id: "nmap", kind: "command", private: false, hostIds: [H], at: 1, createdAt: 1, content: { kind: "command", blocks: [{ command: "nmap 10.0.0.5", output: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10" }] } },
    { id: "curl", kind: "command", private: false, hostIds: [H], at: 2, createdAt: 2, content: { kind: "command", blocks: [{ command: "curl x", output: "ok" }] } },
    { id: "flag", kind: "flag", private: false, hostIds: [H], at: 3, createdAt: 3, content: { kind: "flag", flagKind: "local", value: "abc123", proof: "cat local.txt\nabc123" } },
  ] as LogEntry[];
  return {
    engagement: { id: "e", kind: "exam-sim" },
    hosts: [{ id: H, name: "web01", ip: "10.0.0.5", os: "linux", adSetEffective: false } as Host],
    services: [{ id: "s80", hostId: H, port: 80, protocol: "tcp", state: "open", nmapService: "http", nmapVersion: "Apache 2.4" } as Service],
    log,
    checklist: [],
    findings: [finding({ id: "f1", title: "Upload RCE", description: "The upload *checks* nothing.", remediation: "Check uploads." })],
    findingFiles: [{ id: "x1", findingId: "f1", name: "exploit.py", content: "print('hi')\n", modified: false } as never],
    attempts: [],
    ruledOut: [],
    grants: [],
    usernames: [],
    hops: [],
    cleanup: [],
    notes: [],
    credentials: [],
    credAttempts: [],
  } as unknown as ReportData;
}

const ownerPara = (text: string): ReportNode => ({ type: "paragraph", attrs: { fromEntry: null }, content: [{ type: "text", text }] });

function layout4(): ReportNode {
  return {
    type: "doc",
    content: [
      { type: "generated", attrs: { kind: "facts", hostId: H, appendix: "inline" } },
      { type: "generated", attrs: { kind: "result", hostId: H, appendix: "inline" } },
      { type: "phase", attrs: { phase: "enum", hostId: H } },
      { type: "generated", attrs: { kind: "ports", hostId: H, appendix: "inline", notes: { s80: "Joomla 4.2.4 admin at /administrator" } } },
      { type: "phase", attrs: { phase: "foothold", hostId: H } },
      { type: "vuln", attrs: { findingId: "f1" } },
      {
        type: "steps",
        content: [
          {
            type: "step",
            attrs: { entryId: "nmap" },
            content: [
              ownerPara("I scanned *every* port first — the web one stood out."),
              { type: "paragraph", content: [{ type: "text", text: "Second line, ", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "kept." }] },
              { type: "evidence", attrs: { entryId: "nmap", block: 0, keep: [[0, 2]], emphasis: [1], appendix: "split", caption: null, width: null } },
            ],
          },
          {
            type: "step",
            attrs: { entryId: "curl" },
            content: [ownerPara("Then curl."), { type: "evidence", attrs: { entryId: "curl", block: 0, keep: null, emphasis: [], appendix: "moved" } }],
          },
          { type: "step", attrs: { entryId: null }, content: [{ type: "exploit", attrs: { fileId: "x1", markedLines: [0], appendix: "inline" } }] },
          { type: "step", attrs: { entryId: "flag" }, content: [ownerPara("Read in /home/dev."), { type: "evidence", attrs: { entryId: "flag", block: null, keep: null, emphasis: [], appendix: "inline" } }] },
        ],
      },
      { type: "slot", attrs: { hint: "Anything else" } },
      ownerPara("A closing paragraph the owner wrote."),
    ],
  };
}

describe("upgradeDoc", () => {
  it("keeps every owner paragraph byte for byte, trims, notes and placements, and leaves no vuln node", () => {
    const before = layout4();
    const up = upgradeDoc(before, data(), T, {});
    // Every paragraph outside the copies is the owner's.
    const paras = (n: ReportNode): ReportNode[] =>
      n.type === "finding" || n.type === "table-block" ? [] : [...(n.type === "paragraph" ? [n] : []), ...(n.content ?? []).flatMap(paras)];
    expect(paras(before)).toHaveLength(5);
    expect(paras(up)).toEqual(paras(before));
    expect(all(up).some((n) => n.type === "vuln")).toBe(false);
    expect(all(up).some((n) => n.type === "generated" && ["result", "ports"].includes(n.attrs?.kind as string))).toBe(false);

    const ev = all(up).filter((n) => n.type === "evidence");
    expect(ev[0].attrs).toMatchObject({ entryId: "nmap", keep: [[0, 2]], emphasis: [1], appendix: "split", copy: { command: "nmap 10.0.0.5", output: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10" }, truncated: false });
    expect(ev[1].attrs).toMatchObject({ entryId: "curl", appendix: "moved", copy: { command: "curl x", output: "ok" } });
    expect(ev[2].attrs).toMatchObject({ entryId: "flag", copy: { value: "abc123", proof: "cat local.txt\nabc123" } });
    expect(all(up).find((n) => n.type === "exploit")?.attrs).toMatchObject({ fileId: "x1", markedLines: [0], appendix: "inline", copy: { content: "print('hi')\n" } });

    const ports = all(up).find((n) => n.type === "table-block" && n.attrs?.kind === "ports")!;
    expect(ports.attrs).toMatchObject({ kind: "ports", hostId: H });
    expect(textOf(ports)).toContain("Joomla 4.2.4 admin at /administrator");
    const result = all(up).find((n) => n.type === "table-block" && n.attrs?.kind === "result")!;
    expect(result.content?.[0].type).toBe("paragraph");
    expect(result.content?.[0].content?.[0]).toMatchObject({ text: "Result:", marks: [{ type: "bold" }] });

    const f = all(up).find((n) => n.type === "finding")!;
    expect(f.attrs).toEqual({ findingId: "f1", edited: false });
    // Untouched: the facts heading, phases, the slot, the steps' own attrs, the owner's closing paragraph.
    expect(up.content![0]).toEqual(before.content![0]);
    expect(up.content!.filter((n) => n.type === "phase")).toEqual(before.content!.filter((n) => n.type === "phase"));
    expect(up.content!.at(-2)).toEqual(before.content!.at(-2));
    expect(up.content!.at(-1)).toEqual(before.content!.at(-1));
  });

  it("never copies a private entry: its block stays as it was", () => {
    const d = data();
    d.log[1] = { ...d.log[1], private: true };
    const up = upgradeDoc(layout4(), d, T, {});
    const curl = all(up).find((n) => n.type === "evidence" && n.attrs?.entryId === "curl")!;
    expect(curl.attrs?.copy).toBeUndefined();
  });
});

describe("refreshNode", () => {
  it("gives null for an evidence whose entry went private, or was deleted", () => {
    const d = data();
    const ev: ReportNode = { type: "evidence", attrs: { entryId: "curl", block: 0, keep: null, emphasis: [], appendix: "inline", copy: { command: "curl x", output: "edited" } } };
    expect(refreshNode(ev, d, T, {})?.attrs?.copy).toEqual({ command: "curl x", output: "ok" });
    d.log[1] = { ...d.log[1], private: true };
    expect(refreshNode(ev, d, T, {})).toBeNull();
    d.log.splice(1, 1);
    expect(refreshNode(ev, d, T, {})).toBeNull();
  });

  it("refreshes a finding from its source, and a ports table keeping the owner's Notes", () => {
    const d = data();
    expect(refreshNode({ type: "finding", attrs: { findingId: "f1", edited: true }, content: [] }, d, T, {})).toEqual(findingCopy(d.findings[0]));
    expect(refreshNode({ type: "finding", attrs: { findingId: "gone", edited: false }, content: [] }, d, T, {})).toBeNull();
    const ports = tableCopy("ports", H, d, T, {}, { s80: "my note" });
    d.services[0] = { ...d.services[0], nmapVersion: "Apache 2.4.58" };
    const fresh = refreshNode(ports, d, T, {})!;
    expect(textOf(fresh)).toContain("Apache 2.4.58");
    expect(textOf(fresh)).toContain("my note");
  });

  it("has no source for a heading, a slot or a paragraph", () => {
    expect(refreshNode({ type: "phase", attrs: { phase: "enum", hostId: H } }, data(), T, {})).toBeNull();
    expect(refreshNode(ownerPara("x"), data(), T, {})).toBeNull();
  });
});
