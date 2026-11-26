import { describe, expect, it } from "vitest";
import { examFixtures } from "../audit/examFixtures";
import { findingBlocks, labelled, terminalBlocks } from "../engines/report";
import type { ReportNode } from "../engines/report";

const fixtures = examFixtures(1_700_000_000_000);
const grafanaRepo = fixtures.findings.find((f) => f.id === "f-exam-grafana-repo")!;

const all = (n: ReportNode): ReportNode[] => [n, ...(n.content ?? []).flatMap(all)];
const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");
const doc = (blocks: ReportNode[]): ReportNode => ({ type: "doc", content: blocks });

describe("terminalBlocks", () => {
  it("splits the grafana-repo description into prose, the pasted commit and diff as code, then prose", () => {
    const runs = terminalBlocks(grafanaRepo.description);
    expect(runs.map((r) => r.kind)).toEqual(["prose", "code", "prose"]);
    expect(runs[1].text.startsWith("commit 7d41")).toBe(true);
    expect(runs[1].text.endsWith("       maxOpenConns: 10")).toBe(true);
    expect(runs[1].text).toContain("+      password: CopperKite71");
    expect(runs[2].text.trim()).toBe("Affected: grafana (port 3000)");
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

describe("findingBlocks", () => {
  it("gives prose with two `- item` lines a bullet list, and keeps diff lines as code, never a list", () => {
    const blocks = doc(findingBlocks("Two problems:\n- weak password\n- no lockout\n\n-    private $x\n+    private $y"));
    const lists = all(blocks).filter((n) => n.type === "list");
    expect(lists.map(textOf)).toEqual(["weak password", "no lockout"]);
    expect(lists.every((l) => l.attrs?.kind === "bullet")).toBe(true);
    expect(all(blocks).filter((n) => n.type === "codeBlock").map(textOf)).toEqual(["-    private $x\n+    private $y"]);
  });

  it("never turns a lone `-    private $x` into a list", () => {
    const blocks = doc(findingBlocks("Before the fix:\n-    private $x"));
    expect(all(blocks).some((n) => n.type === "list")).toBe(false);
    expect(textOf(blocks)).toContain("-    private $x");
  });

  it("reads the grafana-repo description as prose, the diff in a code block, inline code as a code mark, no italics", () => {
    const blocks = doc(findingBlocks(grafanaRepo.description));
    expect(blocks.content!.find((n) => n.type === "codeBlock")?.content?.[0].text).toContain("diff --git a/datasources/mysql.yaml");
    expect(all(blocks).some((n) => n.marks?.some((m) => m.type === "italic"))).toBe(false);
    expect(all(blocks).some((n) => n.text === "/opt/grafana-provisioning" && n.marks?.some((m) => m.type === "code"))).toBe(true);
  });

  it("reads a pipe table as a table", () => {
    const blocks = findingBlocks("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(blocks.map((b) => b.type)).toEqual(["table"]);
  });

  it("reads a table without outer pipes as a table; prose with a pipe over a rule stays prose (RAV-19)", () => {
    const blocks = findingBlocks("a | b\n--- | ---\n1 | 2");
    expect(blocks.map((b) => b.type)).toEqual(["table"]);
    expect(textOf(blocks[0]!)).toBe("ab12");
    expect(findingBlocks("this | that\n---").map((b) => b.type)).not.toContain("table");
  });
});

describe("labelled", () => {
  it("leads the first paragraph with the bold label", () => {
    const [first] = labelled("Fix:", [{ type: "paragraph", content: [{ type: "text", text: "Patch it." }] }]);
    expect(first.content?.[0]).toEqual({ type: "text", text: "Fix:", marks: [{ type: "bold" }] });
    expect(textOf(first)).toBe("Fix: Patch it.");
  });

  it("gives the label a line of its own before a list", () => {
    const blocks = labelled("Fix:", [{ type: "list", attrs: { kind: "bullet" }, content: [{ type: "paragraph" }] }]);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list"]);
  });
});
