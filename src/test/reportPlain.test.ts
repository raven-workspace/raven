import { createEditor, type NodeJSON } from "prosekit/core";
import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { FIXTURES } from "../audit/fixtures";
import { defineReportExtension } from "../features/report/editor/extension";
import {
  blockHash,
  buildPlainTarget,
  entryBlocks,
  entryIdsIn,
  machinesInOrder,
  openPortLines,
  PLAIN_NODE_TYPES,
  reportTargets,
  sourceBlocks,
  sourceOf,
  titleSentence,
  trimmedOutput,
  type ReportData,
  type ReportNode,
  type ReportTarget,
} from "../engines/report";

const data = garnetFixtures(1_700_000_000_000);
const target: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
const doc = buildPlainTarget(data, target, {});

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
      "garnet (10.10.30.31)",
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
    expect(login[1].attrs?.language).toBe("");
    expect(textOf(login[2])).toBe(
      "garnet\nronan\n4c1d8e2f9a7b3065e2c4a9f1d7b80e36\n2: ens3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000\n    inet 10.10.30.31/24 brd 10.10.30.255 scope global ens3",
    );
    expect(textOf(login[1])).toBe("ssh ronan@10.10.30.31\nhostname && whoami && cat local.txt && ip a");
    expect(textOf(login[3])).toBe("local.txt on garnet after logging in");
  });

  it("cuts long output with one omitted line and keeps every source attr off the text", () => {
    const dump = steps[1].content!.filter((n) => n.type === "codeBlock").map(textOf)[1];
    expect(dump).toMatch(/\[… \d+ lines omitted …\]/);
    expect(dump.split("\n").length).toBeLessThanOrEqual(10);
    expect(steps[1].content![1].attrs?.source).toBe("entry:l-garnet-dump:0:command");
  });

  it("prints the scan's open ports, with script lines only under the port a finding is about", () => {
    const at = doc.content!.findIndex((n) => n.type === "heading" && textOf(n) === "Service enumeration");
    const scan = textOf(doc.content!.slice(at).filter((n) => n.type === "codeBlock")[1]);
    expect(scan).not.toContain("ssh-hostkey");
    expect(scan).not.toContain("http-title");
    expect(scan).toContain("| http-git:");
    expect(scan.split("\n").filter((l) => /^\d+\/tcp open/.test(l))).toHaveLength(3);
  });

  it("gives command and output blocks no language, so nothing in them is bolded", () => {
    const blocks = all(doc).filter((n) => n.type === "codeBlock" && /^entry:/.test(String(n.attrs?.source)));
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.filter((n) => n.attrs?.language !== "")).toEqual([]);
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

const logEntry = (id: string) => data.log.find((e) => e.id === id)!;
const garnetFinding = data.findings.find((f) => f.title === "Jenkins script console with default credentials")!;
const emptyHostData: ReportData = { ...data, hosts: [...data.hosts, { ...data.hosts.find((h) => h.id === GARNET_HOST)!, id: "h-empty", name: "empty", ip: "10.10.30.99" }] };

/** The exam engagement's report data as the audit serves it (as reportCapturedHost.test.ts builds it). */
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
const examData = examFixtureData();
const adTarget = reportTargets(examData, {}).find((t) => t.kind === "ad-set")!;

/** Contiguous siblings sharing a `source`, at the top level and inside every list item, as `[source, blocks]`. */
function sourcedRuns(n: ReportNode): [string, ReportNode[]][] {
  const out: [string, ReportNode[]][] = [];
  const walk = (siblings: ReportNode[]) => {
    let run: [string, ReportNode[]] | null = null;
    for (const b of siblings) {
      const source = typeof b.attrs?.source === "string" ? b.attrs.source : null;
      if (source && run && run[0] === source) run[1].push(b);
      else {
        run = source ? [source, [b]] : null;
        if (run) out.push(run);
      }
      if (b.type === "list") walk(b.content ?? []);
    }
  };
  walk(n.content ?? []);
  return out;
}

/** The garnet draft's placed entries: every step's, the scan's and the flags' (private ones and the slip never). */
const expectedPlacedIds = [
  "nmap", "head", "dump", "show", "spray", "ssh", "local-shot", "local", "kernel", "build", "fuse", "exp", "proof-read", "proof-shot", "proof",
].map((k) => `l-garnet-${k}`);

describe("plain entry blocks and Refresh sources", () => {
  it("a git diff pasted into a remediation is a code block, never a list or italics", () => {
    const f = { ...garnetFinding, remediation: "Remove the secret:\n\ndiff --git a/config.php b/config.php\n-$db_pass = 'Spring2024!';\n+$db_pass = getenv('DB_PASS');\n*keep* this" };
    const fix = sourceBlocks(`finding:${f.id}:fix`, { ...data, findings: [f] }, target, {})!;
    expect(fix.some((b) => b.type === "codeBlock" && b.content![0].text!.includes("-$db_pass"))).toBe(true);
    expect(JSON.stringify(fix)).not.toContain('"type":"list"');
    expect(JSON.stringify(fix)).not.toContain('"italic"');
    expect(fix.every((b) => b.attrs?.source === `finding:${f.id}:fix`)).toBe(true);
  });

  it("a machine with nothing logged is its heading alone", () => {
    const empty = buildPlainTarget(emptyHostData, { key: "h-empty", kind: "standalone", hostIds: ["h-empty"] }, {});
    expect(empty.content).toHaveLength(1);
    expect(empty.content![0]).toMatchObject({ type: "heading", attrs: { level: 1, source: "facts:h-empty" } });
  });

  it("entryBlocks gives an entry the draft's own sentence, command, trimmed output and figures", () => {
    const blocks = entryBlocks(data, logEntry("l-garnet-head"));
    expect(blocks.map((b) => [b.type, b.attrs?.source])).toEqual([
      ["paragraph", "entry:l-garnet-head:title"],
      ["codeBlock", "entry:l-garnet-head:0:command"],
      ["codeBlock", "entry:l-garnet-head:0:output"],
    ]);
    for (const b of blocks) expect(b.attrs?.gen).toBe(blockHash(b));
  });

  it("sourceBlocks regenerates every block of the draft identically", () => {
    const runs = sourcedRuns(doc);
    expect(runs.length).toBeGreaterThan(30);
    for (const [source, run] of runs) {
      if (source.startsWith("phase:") || source.startsWith("phase-steps:")) continue;
      expect([source, sourceBlocks(source, data, target, {})]).toEqual([source, run]);
    }
  });

  it("sourceBlocks regenerates every exam target's draft identically", () => {
    for (const t of reportTargets(examData, {})) {
      for (const [source, run] of sourcedRuns(buildPlainTarget(examData, t, {}))) {
        if (source.startsWith("phase:") || source.startsWith("phase-steps:")) continue;
        expect([t.key, source, sourceBlocks(source, examData, t, {})]).toEqual([t.key, source, run]);
      }
    }
  });

  it("sourceBlocks returns null for a private or deleted source", () => {
    expect(sourceBlocks("entry:l-garnet-private:title", data, target, {})).toBeNull();
    expect(sourceBlocks("entry:nope:title", data, target, {})).toBeNull();
    expect(sourceBlocks("finding:nope:fix", data, target, {})).toBeNull();
    expect(sourceBlocks("file:nope", data, target, {})).toBeNull();
    expect(sourceBlocks(`entry:l-garnet-head:bogus`, data, target, {})).toBeNull();
    expect(sourceBlocks(`file:${data.findingFiles[0].id}:x`, data, target, {})).toBeNull();
    expect(sourceBlocks("ports:nope", data, target, {})).toBeNull();
    expect(sourceBlocks("phase:h-exam-garnet:foothold", data, target, {})).toBeNull();
    expect(sourceBlocks(`phase-steps:${GARNET_HOST}`, data, target, {})).toBeNull();
    expect(sourceBlocks("whatever:x", data, target, {})).toBeNull();
  });

  it("every sourced block carries gen = blockHash, and attrs never change the hash", () => {
    for (const b of doc.content!) if (b.attrs?.source) expect(b.attrs.gen).toBe(blockHash(b));
    const p = doc.content![1];
    expect(blockHash(p)).toMatch(/^[0-9a-f]{8}$/);
    expect(blockHash({ ...p, attrs: { ...p.attrs, source: null, hint: null, gen: "x", level: 9 } })).toBe(blockHash(p));
    expect(blockHash({ ...p, content: [...p.content!, { type: "text", text: "!" }] })).not.toBe(blockHash(p));
  });

  it("entryIdsIn reads sources and figures", () => {
    expect(entryIdsIn(doc)).toEqual(new Set(expectedPlacedIds));
    expect(entryIdsIn({ type: "doc", content: [{ type: "figure", attrs: { entryId: "l-x", attachmentId: "a" } }] })).toEqual(new Set(["l-x"]));
  });

  it("a flag whose value a step already prints is recorded on the block that prints it", () => {
    const holders = all(doc).filter((n) => Array.isArray(n.attrs?.also) && (n.attrs.also as string[]).includes("l-garnet-local"));
    expect(holders).toHaveLength(1);
    expect(holders[0].type).toBe("codeBlock");
    expect(textOf(holders[0])).toContain("4c1d8e2f9a7b3065e2c4a9f1d7b80e36");
    expect(sourceOf(holders[0])).not.toMatch(/^entry:l-garnet-local[:]?/);
    expect(entryIdsIn(doc).has("l-garnet-local")).toBe(true);
    const regenerated = sourceBlocks(sourceOf(holders[0])!, data, target, {})!;
    expect(regenerated).toEqual([holders[0]]);
    expect(regenerated[0].attrs?.also).toEqual(["l-garnet-local"]);
    // A refresh of a block with no flag absorbed carries no `also`.
    expect(sourceBlocks("entry:l-garnet-head:0:output", data, target, {})![0].attrs?.also).toBeUndefined();
  });

  it("an AD set opens with its attack-path table", () => {
    const ad = buildPlainTarget(examData, adTarget, {});
    expect(ad.content!.slice(0, 2).map((b) => [b.type, b.attrs?.source])).toEqual([["paragraph", "attack-path"], ["table", "attack-path"]]);
    expect(ad.content!.filter((b) => b.type === "heading" && b.attrs?.level === 1).map((b) => b.attrs!.source)).toEqual(machinesInOrder(examData, adTarget).map((id) => `facts:${id}`));
    expect(sourceBlocks("attack-path", examData, null, {})).toEqual(ad.content!.slice(0, 2));
    for (const [source, run] of sourcedRuns(ad)) {
      if (source.startsWith("phase:") || source.startsWith("phase-steps:")) continue;
      expect([source, sourceBlocks(source, examData, adTarget, {})]).toEqual([source, run]);
    }
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
  it("cuts a scan to its open ports, keeping only the script blocks a finding on the port mentions", () => {
    const scan = "PORT STATE\n22/tcp open ssh\n| ssh-hostkey:\n|_ key\n80/tcp open http\n|_http-title: Shop\n| http-git:\n|_ found\nNmap done";
    expect(openPortLines(scan)).toBe("22/tcp open ssh\n80/tcp open http");
    expect(openPortLines(scan, new Map([[80, "The web root serves .git/"]]))).toBe("22/tcp open ssh\n80/tcp open http\n| http-git:\n|_ found");
  });

  it("turns a title into a sentence", () => {
    expect(titleSentence("full TCP scan.")).toBe("Full TCP scan:");
    expect(titleSentence("  ")).toBe("Run the following:");
  });

  it("keeps short output whole; a long one keeps its edges and proving lines, one marker per gap", () => {
    expect(trimmedOutput("a\nb\n")).toBe("a\nb");
    const long = Array.from({ length: 30 }, (_, i) => (i === 15 ? "[+] admin:pw (Pwn3d!)" : `l${i}`)).join("\n");
    expect(trimmedOutput(long).split("\n")).toEqual([
      "l0", "l1", "l2", "l3", "[… 11 lines omitted …]", "[+] admin:pw (Pwn3d!)", "[… 10 lines omitted …]", "l26", "l27", "l28", "l29",
    ]);
    const thirteen = Array.from({ length: 13 }, (_, i) => `l${i}`).join("\n");
    expect(trimmedOutput(thirteen)).toContain("[… 5 lines omitted …]");
  });

  it("cuts address output to the machine's own interface and address", () => {
    const out = "h\n1: lo: <LOOPBACK>\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <UP>\n    link/ether aa\n    inet 10.0.0.5/24 scope global eth0";
    expect(trimmedOutput(out, "hostname; ip a", "10.0.0.5")).toBe("h\n2: eth0: <UP>\n    inet 10.0.0.5/24 scope global eth0");
    expect(trimmedOutput(out, "cat x", "10.0.0.5")).toBe(out);
  });
});
