import { createEditor, type NodeJSON } from "prosekit/core";
import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { defineReportExtension } from "../features/report/editor/extension";
import { buildPlainTarget, openPortLines, PLAIN_NODE_TYPES, titleSentence, trimmedOutput, type ReportNode, type ReportTarget } from "../engines/report";

const data = garnetFixtures(1_700_000_000_000);
const target: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
const doc = buildPlainTarget(data, target, {}, "4.1");

const all = (n: ReportNode): ReportNode[] => [n, ...(n.content ?? []).flatMap(all)];
const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");
/** Every node with the cells of tables left out (a Notes cell is an empty paragraph the owner fills). */
const outsideTables = (n: ReportNode): ReportNode[] => (n.type === "table" ? [n] : [n, ...(n.content ?? []).flatMap(outsideTables)]);
const steps = (doc.content ?? []).filter((n) => n.type === "list" && n.attrs?.kind === "ordered");

describe("buildPlainTarget (garnet)", () => {
  it("uses only ordinary editor nodes and the figure", () => {
    const types = new Set(all(doc).map((n) => n.type));
    expect([...types].filter((t) => !PLAIN_NODE_TYPES.includes(t))).toEqual([]);
    for (const old of ["slot", "step", "steps", "evidence", "phase", "generated", "finding", "table-block", "exploit", "vuln"]) expect(types.has(old)).toBe(false);
  });

  it("has no empty paragraph and no UI wording", () => {
    const empty = outsideTables(doc).filter((n) => n.type === "paragraph" && textOf(n).trim() === "");
    expect(empty).toEqual([]);
    const text = all(doc).map(textOf).join("\n");
    for (const phrase of ["What you", "Say what", "Not written"]) expect(text).not.toContain(phrase);
  });

  it("opens with the sample's headings, in order", () => {
    const headings = all(doc).filter((n) => n.type === "heading").map(textOf);
    expect(headings).toEqual([
      "4.1 garnet (10.10.30.31)",
      "Service enumeration",
      "Initial access: Jenkins script console with default credentials",
      "Privilege escalation: sudo CVE-2021-3156",
      "Additional findings (not on the path to root)",
      "Also tested",
    ]);
  });

  it("prints the Result line in the sample's wording", () => {
    const result = doc.content![1];
    expect(textOf(result)).toBe(
      "Result: low-privilege shell as ronan, then root. local.txt 4c1d8e2f9a7b3065e2c4a9f1d7b80e36, proof.txt e7a2093bd5c14f68a0b9e3d2c71f45a8.",
    );
    expect(result.content!.filter((n) => n.marks?.some((m) => m.type === "code")).map((n) => n.text)).toEqual([
      "ronan",
      "4c1d8e2f9a7b3065e2c4a9f1d7b80e36",
      "e7a2093bd5c14f68a0b9e3d2c71f45a8",
    ]);
  });

  it("starts every step with a non-empty sentence, flags closing their phase", () => {
    expect(steps.length).toBe(10);
    for (const s of steps) {
      expect(s.content![0].type).toBe("paragraph");
      expect(textOf(s.content![0]).trim()).not.toBe("");
    }
    expect(steps.map((s) => textOf(s.content![0]))).toEqual([
      "Confirm the repository is readable:",
      "Download the repository:",
      'Show the "Add the reporting datasource" commit, which removes the credentials:',
      "Test the password over SSH. The bare username ronan succeeds:",
      "Log in and read local.txt:",
      "Check the kernel version and that unprivileged user namespaces are enabled:",
      "Build the exploit in an Ubuntu 22.04 container:",
      "Run find through sudo and have it start a shell:",
      "In a second SSH session, trigger the exploit:",
      "Read proof.txt:",
    ]);
  });

  it("keeps the password lines of the git show output", () => {
    const show = steps[2].content!.filter((n) => n.type === "codeBlock").map(textOf);
    expect(show).toContain("git show 3b9e0c4");
    const diff = show.find((t) => t.startsWith("commit 3b9e0c4"))!;
    expect(diff).toContain('-    private $username = "ronan@garnet.lab";');
    expect(diff).toContain('-    private $password = "Tourmaline!77";');
  });

  it("prints the login step as the sample does: the commands together, the output once, then the screenshot", () => {
    const login = steps[4].content!;
    expect(login.map((n) => n.type)).toEqual(["paragraph", "codeBlock", "codeBlock", "figure"]);
    expect(login[1].attrs?.language).toBe("bash");
    expect(textOf(login[1])).toBe("ssh ronan@10.10.30.31\nhostname && whoami && cat local.txt && ip a");
    expect(textOf(login[3])).toBe("local.txt on garnet after logging in");
  });

  it("cuts long output with one omitted line and keeps every source attr off the text", () => {
    const dump = steps[1].content!.filter((n) => n.type === "codeBlock").map(textOf)[1];
    expect(dump).toMatch(/\[… \d+ lines omitted …\]$/);
    expect(steps[1].content![1].attrs?.source).toBe("entry:l-garnet-dump:0:command");
  });

  it("states the unmodified exploit by its URL, with the exploit notes after it", () => {
    const line = (doc.content ?? []).find((n) => textOf(n).startsWith("Exploit code:"))!;
    expect(textOf(line)).toBe(
      "Exploit code: Public exploit from https://gtfobins.github.io/gtfobins/find/, used without changes. The target has no compiler, so it was built in an ubuntu:22.04 amd64 container (packages build-essential libssl-dev) to match the target's glibc 2.35.",
    );
  });

  it("lists additional findings as bullets with their severity, pasted code as a code block", () => {
    const at = doc.content!.findIndex((n) => n.type === "heading" && textOf(n).startsWith("Additional findings"));
    const bullets = doc.content!.slice(at + 1).filter((n) => n.type === "list" && n.attrs?.kind === "bullet");
    expect(bullets.map((b) => textOf(b.content![0]).split(":")[0])).toEqual([
      "Weak backup password (Medium)",
      "Joomla installer left in place (Low)",
      "PHP source disclosure (Low)",
      "Anonymous FTP login on 21/tcp",
    ]);
    const code = bullets[2].content!.find((n) => n.type === "codeBlock");
    expect(textOf(code!)).toBe("<?php\ndefine('_JEXEC', 1);\nrequire_once __DIR__ . '/includes/app.php';");
  });

  it("never prints private entries or the operator's own slip", () => {
    const text = all(doc).map(textOf).join("\n");
    expect(text).not.toContain("my-notes-passwords");
    expect(text).not.toContain("No such file or directory");
    expect(text).not.toContain("wrong folder");
    expect(text).not.toContain("Wrong working directory");
    const sources = all(doc).map((n) => String(n.attrs?.source ?? ""));
    for (const id of data.log.filter((e) => e.private).map((e) => e.id)) expect(sources.some((s) => s.includes(id))).toBe(false);
  });
});

describe("the plain page's schema", () => {
  it("loads the garnet draft as it is, sources and figures kept", () => {
    const editor = createEditor({ extension: defineReportExtension(undefined, undefined, undefined, undefined, true), defaultContent: doc as NodeJSON });
    editor.state.doc.check();
    const back = editor.getDocJSON() as ReportNode;
    expect(all(back).map((n) => n.type)).toEqual(all(doc).map((n) => n.type));
    expect(all(back).map(textOf)).toEqual(all(doc).map(textOf));
    expect(all(back).filter((n) => n.attrs?.source).length).toBe(all(doc).filter((n) => n.attrs?.source).length);
  });

  it("leaves the live page's schema without them", () => {
    const editor = createEditor({ extension: defineReportExtension() });
    expect(editor.schema.nodes.figure).toBeUndefined();
    expect(editor.schema.nodes.paragraph.spec.attrs?.source).toBeUndefined();
  });
});

describe("plain helpers", () => {
  it("cuts a scan to its open ports and their script lines", () => {
    expect(openPortLines("PORT STATE\n22/tcp open ssh\n| ssh-hostkey:\n|_ key\n80/tcp closed http\n| x\nNmap done")).toBe("22/tcp open ssh\n| ssh-hostkey:\n|_ key");
  });

  it("turns a title into a sentence", () => {
    expect(titleSentence("full TCP scan.")).toBe("Full TCP scan:");
    expect(titleSentence("  ")).toBe("Run the following:");
  });

  it("keeps short output whole and marks one cut line in the singular", () => {
    expect(trimmedOutput("a\nb\n")).toBe("a\nb");
    const long = Array.from({ length: 41 + 20 }, (_, i) => `l${i}`).join("\n");
    expect(trimmedOutput(long).split("\n").slice(-1)[0]).toBe("[… 21 lines omitted …]");
  });
});
