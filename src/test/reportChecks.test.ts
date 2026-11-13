import { describe, expect, it } from "vitest";
import { absoluteClaims, buildPlainTarget, checkKind, groupChecks, isReady, legibilityChecks, proofFacts, reportChecks, stepTitleBefore, targetChecks, fixSteps } from "../engines/report";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import type { Check, ReportData, ReportNode, ReportTarget } from "../engines/report";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Report } from "../types/report";

const host = (o: Partial<Host> = {}) => ({ id: "h1", name: "DC01", ip: "10.0.0.5", os: "windows", ...o }) as Host;
const entry = (o: Record<string, unknown>) =>
  ({ id: "e", kind: "command", private: false, hostIds: ["h1"], returnedNothing: false, at: 1000, createdAt: 1000, content: { kind: "command", blocks: [{ command: "id", output: "uid=0" }] }, ...o }) as unknown as LogEntry;
const flag = (o: Record<string, unknown> = {}, content: Record<string, unknown> = {}) =>
  entry({
    id: "f1",
    kind: "flag",
    at: 5000,
    content: { kind: "flag", flagKind: "proof", value: "abc", attachmentId: "a1", proof: "whoami\nhostname\ntype C:\\Users\\Administrator\\Desktop\\proof.txt\nipconfig\n10.0.0.5", ...content },
    ...o,
  });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const words = (text: string, source?: string): ReportNode => ({ type: "paragraph", ...(source ? { attrs: { source } } : {}), content: [{ type: "text", text }] });
const hint = (): ReportNode => ({ type: "paragraph", attrs: { hint: "h" } });
const heading = (level: number, text: string, source: string): ReportNode => ({ type: "heading", attrs: { level, source }, content: [{ type: "text", text }] });
const h1 = (text: string, source = "facts:h1") => heading(1, text, source);
const h2 = (text: string, source: string) => heading(2, text, source);
const code = (text: string, source: string): ReportNode => ({ type: "codeBlock", attrs: { language: "", source }, content: [{ type: "text", text }] });
/** A block an entry puts on the page: its value, so it is on the page without a command or output. */
const ev = (entryId: string): ReportNode => code("x", `entry:${entryId}:value`);
/** A command entry's blocks: the command and its output. */
const cmd = (entryId: string, output = "uid=0"): ReportNode[] => [code("id", `entry:${entryId}:0:command`), ...(output ? [code(output, `entry:${entryId}:0:output`)] : [])];
const fig = (entryId: string, caption = "A caption"): ReportNode => ({ type: "figure", attrs: { attachmentId: "a", entryId, source: `entry:${entryId}` }, ...(caption ? { content: [{ type: "text", text: caption }] } : {}) });
const step = (...children: ReportNode[]): ReportNode => ({ type: "list", attrs: { kind: "ordered" }, content: children });
const stepsPara = (hostId = "h1"): ReportNode => words("Steps to reproduce:", `phase-steps:${hostId}`);
const target: ReportTarget = { key: "h1", kind: "standalone", hostIds: ["h1"] };

function data(o: Partial<ReportData> = {}): ReportData {
  return { engagement: { id: "eng" }, hosts: [host()], services: [], log: [], checklist: [], findings: [], findingFiles: [], attempts: [], ruledOut: [], grants: [], usernames: [], hops: [], cleanup: [], notes: [], credentials: [], credAttempts: [], ...o } as unknown as ReportData;
}
function run(d: ReportData, page: ReportNode, extra: Record<string, unknown> = {}, flags: ("local" | "proof")[] = ["proof"]): Check[] {
  return targetChecks({ data: d, target, doc: page, meta: { expectedFlags: { h1: flags } }, sectionId: "t1", ...extra });
}
const find = (cs: Check[], prefix: string) => cs.find((c) => c.id.startsWith(prefix));
const good = () => data({ log: [flag()] });
const goodDoc = () => doc(words("Proof of root"), ev("f1"));

describe("proofFacts", () => {
  it("reads the pasted proof", () => {
    const f = proofFacts(flag(), host());
    expect(f).toEqual({ showsIp: true, showsIdentity: true, showsHostname: true, usualPath: true, pathKnown: true, hasScreenshot: true });
  });
  it("needs the IP and a command, and a usual path", () => {
    const f = proofFacts(flag({}, { proof: "ipconfig\ncat /tmp/x", attachmentId: null }), host());
    expect(f).toMatchObject({ showsIp: false, usualPath: false, hasScreenshot: false });
    expect(proofFacts(flag({}, { proof: "ip a\n inet 10.0.0.5\nid\ncat /home/bob/local.txt" }), host()))
      .toMatchObject({ showsIp: true, showsIdentity: true, usualPath: true });
  });
});

describe("proofFacts details", () => {
  const f = (proof: string, h = host()) => proofFacts(flag({}, { proof }), h);
  it("matches the IP on a boundary", () => {
    expect(f("ipconfig\n10.0.0.50").showsIp).toBe(false);
    expect(f("ipconfig\n110.0.0.5").showsIp).toBe(false);
    expect(f("ipconfig\nIPv4 10.0.0.5.").showsIp).toBe(true);
  });
  it("accepts ip address forms", () => {
    for (const c of ["ip address", "ip addr show", "ip -br a", "ip -4 a"]) expect(f(`${c}\n10.0.0.5`).showsIp, c).toBe(true);
    expect(f("ip route\n10.0.0.5").showsIp).toBe(false);
  });
  it("accepts a usual directory from the prompt or a cd", () => {
    expect(f("C:\\Users\\Administrator\\Desktop> type proof.txt").usualPath).toBe(true);
    expect(f("root@x:/root# cat proof.txt").usualPath).toBe(true);
    expect(f("cd /root\ncat proof.txt").usualPath).toBe(true);
    expect(f("cd /tmp\ncat proof.txt").usualPath).toBe(false);
    expect(f("user@x:/tmp$ cat proof.txt").usualPath).toBe(false);
  });
  it("reads the folder from PowerShell, Evil-WinRM and home-directory (~) prompts", () => {
    expect(f("PS C:\\Users\\Administrator\\Desktop> type proof.txt").usualPath).toBe(true);
    expect(f("*Evil-WinRM* PS C:\\Users\\Administrator\\Desktop> type proof.txt").usualPath).toBe(true);
    expect(f("PS C:\\Windows\\Temp> type proof.txt").usualPath).toBe(false);
    // ~ is the shell user's home: /root for root, /home/<user> for anyone else.
    expect(f("root@web01:~# cat proof.txt").usualPath).toBe(true);
    expect(f("dev@web01:~$ cat local.txt").usualPath).toBe(true);
    expect(f("dev@web01:~/tools$ cat local.txt").usualPath).toBe(false);
  });
  it("lets a cd before the read on the same line override the prompt's folder", () => {
    // Relative to the prompt's folder: C:\Users\bob\Desktop.
    expect(f("PS C:\\Users\\bob> cd Desktop; type proof.txt").usualPath).toBe(true);
    expect(f("bob@x:/tmp$ cd ~; cat local.txt").usualPath).toBe(true);
    expect(f("root@x:/root# cd /tmp && cat proof.txt")).toMatchObject({ usualPath: false, pathKnown: true });
    expect(f("root@x:/root# cd /tmp | cat proof.txt").usualPath).toBe(false);
    expect(f("bob@x:/home$ cd bob; cat local.txt").usualPath).toBe(true);
  });
});

describe("absoluteClaims", () => {
  it("finds whole words, case-insensitively", () => {
    expect(absoluteClaims("It is Impossible and NOT vulnerable.")).toEqual(["impossible", "not vulnerable"]);
    expect(absoluteClaims("an impossibly hard box")).toEqual([]);
  });
});

describe("targetChecks", () => {
  it("is clean for a good proof", () => {
    expect(run(good(), goodDoc())).toEqual([]);
  });
  it("proof-missing names the host and file", () => {
    const c = run(data(), doc(), {}, ["local", "proof"]);
    expect(c.map((x) => [x.id, x.level, x.text])).toEqual([
      ["proof-missing:DC01:local", "fail", "No local.txt for DC01 on the page."],
      ["proof-missing:DC01:proof", "fail", "No proof.txt for DC01 on the page."],
    ]);
  });
  it("proof-missing when the flag exists but is not on the page", () => {
    expect(find(run(good(), doc()), "proof-missing")).toBeDefined();
  });
  it("proof-ip fails with a fix by OS when there is no screenshot", () => {
    const d = data({ log: [flag({}, { proof: "whoami", attachmentId: null })] });
    const c = find(run(d, goodDoc()), "proof-ip")!;
    expect(c).toMatchObject({ id: "proof-ip:DC01:proof", level: "fail" });
    expect(c.text).toContain("10.0.0.5");
    expect(c.fix).toContain("ipconfig");
    const lin = find(run(data({ hosts: [host({ os: "linux" })], log: [flag({}, { proof: "x", attachmentId: null })] }), goodDoc()), "proof-ip")!;
    expect(lin.fix).toContain("ip addr");
  });
  it("proof-screenshot fails without an attachment", () => {
    const c = find(run(data({ log: [flag({}, { attachmentId: null })] }), goodDoc()), "proof-screenshot")!;
    expect(c).toMatchObject({ id: "proof-screenshot:DC01:proof", level: "fail" });
    expect(c.text).toContain("DC01");
  });
  it("proof-web fails when the entry before the flag is http", () => {
    const d = data({ log: [entry({ id: "w", kind: "http", at: 4000, content: { kind: "http", request: "GET /" } }), flag()] });
    expect(find(run(d, goodDoc()), "proof-web")).toMatchObject({ id: "proof-web:DC01:proof", level: "fail" });
    const ok = data({ log: [entry({ id: "w", kind: "http", at: 4000, content: { kind: "http", request: "GET /" } }), entry({ id: "c", at: 4500 }), flag()] });
    expect(find(run(ok, goodDoc()), "proof-web")).toBeUndefined();
  });
  it("proof-identity, proof-hostname and proof-path are soft; identity and hostname only without a screenshot", () => {
    const d = data({ log: [flag({}, { proof: "ipconfig\n10.0.0.5\ncat /tmp/proof.txt", attachmentId: null })] });
    const c = run(d, goodDoc());
    expect(find(c, "proof-identity")).toMatchObject({ id: "proof-identity:DC01:proof", level: "soft" });
    expect(find(c, "proof-path")).toMatchObject({ id: "proof-path:DC01:proof", level: "soft" });
    expect(find(c, "proof-hostname")).toMatchObject({ id: "proof-hostname:DC01:proof", level: "soft", text: "The proof.txt proof for DC01 doesn't show hostname." });
    for (const id of ["proof-identity", "proof-path", "proof-hostname"]) expect(find(c, id)!.fix).toContain("ipconfig");
    const lin = run(data({ hosts: [host({ os: "linux" })], log: [flag({}, { proof: "id\nip addr\n10.0.0.5\ncat /root/proof.txt", attachmentId: null })] }), goodDoc());
    expect(find(lin, "proof-hostname")!.fix).toContain("ip addr");
    // With a screenshot, what the text lacks may be on it: only a read from a known odd folder is said.
    const shot = run(data({ log: [flag({}, { proof: "ipconfig\n10.0.0.5\ncat /tmp/proof.txt" })] }), goodDoc());
    expect(shot.map((x) => x.id)).toEqual(["proof-path:DC01:proof"]);
    expect(isReady(shot)).toBe(true);
  });
  it("never says a relative read was from an odd folder when the folder isn't shown", () => {
    const c = run(data({ log: [flag({}, { proof: "whoami\nhostname\ntype proof.txt\nipconfig\n10.0.0.5" })] }), goodDoc());
    expect(c).toEqual([]);
  });
  it("with a screenshot and no IP in the text: one soft line per proof naming its flag and the host's IP command, never a fail", () => {
    const local = flag({ id: "f0", at: 4000 }, { flagKind: "local", value: "a".repeat(32), proof: null });
    const proof = flag({}, { value: "b".repeat(32), proof: null });
    const c = run(data({ log: [local, proof] }), doc(ev("f0"), ...goodDoc().content!), {}, ["local", "proof"]);
    expect(c.map((x) => [x.id, x.level, x.text, x.anchor?.entryId])).toEqual([
      ["proof-shot:DC01:local", "soft", "Raven can't read screenshots; make sure the local.txt screenshot for DC01 shows ipconfig with 10.0.0.5.", "f0"],
      ["proof-shot:DC01:proof", "soft", "Raven can't read screenshots; make sure the proof.txt screenshot for DC01 shows ipconfig with 10.0.0.5.", "f1"],
    ]);
    expect(groupChecks(c).map((g) => g.text)).toEqual(["2 proof screenshots: Raven can't read them; check each shows the target IP"]);
    expect(groupChecks(c.slice(0, 1)).map((g) => g.text)).toEqual(["local.txt: screenshot shows IP?"]);
    const lin = run(data({ hosts: [host({ os: "linux" })], log: [local] }), doc(ev("f0")), {}, ["local"]);
    expect(lin[0].text).toBe("Raven can't read screenshots; make sure the local.txt screenshot for DC01 shows ip a or ifconfig with 10.0.0.5.");
  });
  describe("real capture shapes", () => {
    const HASH = "0123456789abcdef0123456789abcdef";
    const bare = (content: Record<string, unknown> = {}) => flag({ at: 600_000 }, { value: HASH, proof: null, attachmentId: "", ...content });
    const read = (o: Record<string, unknown> = {}) =>
      entry({
        id: "r1",
        at: 660_000,
        content: { kind: "command", blocks: [{ command: "cat C:\\Users\\Administrator\\Desktop\\proof.txt; whoami; hostname; ipconfig", output: `${HASH}\nnt authority\\system\nDC01\nIPv4 Address. . . : 10.0.0.5` }] },
        ...o,
      });
    const shot = (o: Record<string, unknown> = {}) =>
      entry({ id: "s1", kind: "screenshot", at: 700_000, content: { kind: "screenshot", attachmentId: "a9", caption: "root shell", fileName: "x.png" }, ...o });

    it("(b) a bare flag value with a separate proof command and screenshot: no proof check", () => {
      const page = doc(ev("f1"), ...cmd("r1"), fig("s1"));
      expect(run(data({ log: [bare(), read(), shot()] }), page)).toEqual([]);
    });
    it("(b) the command alone: the text passes, only the missing screenshot is said", () => {
      const c = run(data({ log: [bare(), read()] }), doc(ev("f1"), ...cmd("r1")));
      expect(c.map((x) => x.id)).toEqual(["proof-screenshot:DC01:proof"]);
    });
    it("(b) the screenshot alone: one soft reminder, no fail and no whoami or hostname line", () => {
      const c = run(data({ log: [bare(), shot()] }), doc(ev("f1"), fig("s1")));
      expect(c.map((x) => [x.id, x.level])).toEqual([["proof-shot:DC01:proof", "soft"]]);
    });
    it("(b) a screenshot taken more than 15 minutes away, or nearer another step, is not the proof", () => {
      const far = run(data({ log: [bare(), shot({ at: 600_000 + 16 * 60_000 })] }), doc(ev("f1")));
      expect(far.map((x) => x.id)).toContain("proof-screenshot:DC01:proof");
      const step = entry({ id: "c9", at: 710_000 });
      const nearer = run(data({ log: [bare(), step, shot()], checklist: [{ ownerId: "h1", evidence: [{ entryId: "c9" }] }] as never }), doc(ev("f1")));
      expect(nearer.map((x) => x.id)).toContain("proof-screenshot:DC01:proof");
    });
    it("(c) a flag with its own screenshot and no text: one soft reminder", () => {
      const c = run(data({ log: [bare({ attachmentId: "a1" })] }), doc(ev("f1")));
      expect(c.map((x) => x.id)).toEqual(["proof-shot:DC01:proof"]);
    });
    it("a proof read pasted only as a command still puts the flag on the page", () => {
      const only = entry({ id: "r2", content: { kind: "command", blocks: [{ command: "type proof.txt", output: HASH }] } });
      const c = run(data({ log: [only] }), doc(words("Read the proof."), ...cmd("r2")));
      expect(find(c, "proof-missing")).toBeUndefined();
    });
    it("checks a proof read on the page as the proof when its flag entry isn't there", () => {
      const only = entry({ id: "r2", at: 660_000, content: { kind: "command", blocks: [{ command: "type proof.txt", output: HASH }] } });
      const c = run(data({ log: [only] }), doc(words("Read the proof."), ...cmd("r2")));
      expect(c.filter((x) => x.id.startsWith("proof")).map((x) => [x.id, x.level, x.anchor?.entryId])).toEqual([
        ["proof-ip:DC01:proof", "fail", "r2"],
        ["proof-screenshot:DC01:proof", "fail", "r2"],
        ["proof-identity:DC01:proof", "soft", "r2"],
        ["proof-hostname:DC01:proof", "soft", "r2"],
      ]);
      // The full read with its screenshot: nothing to say. A flag entry that isn't on the page changes nothing.
      expect(run(data({ log: [read(), shot()] }), doc(words("Read the proof."), ...cmd("r1"), fig("s1")))).toEqual([]);
      expect(run(data({ log: [bare(), read(), shot()] }), doc(words("Read the proof."), ...cmd("r1"), fig("s1")))).toEqual([]);
    });
    it("counts another proof.txt flag entry's screenshot on the page as the proof's screenshot", () => {
      const text = flag({ at: 600_000 }, { value: HASH, attachmentId: null });
      const pic = flag({ id: "f2", at: 610_000 }, { value: HASH, proof: null, attachmentId: "a2" });
      const c = run(data({ log: [text, pic] }), doc(ev("f1"), fig("f2")));
      expect(find(c, "proof-screenshot")).toBeUndefined();
      // Off the page, it isn't shown.
      expect(find(run(data({ log: [text, pic] }), doc(ev("f1"))), "proof-screenshot")).toBeDefined();
    });
    it("counts an entry a block already shows (its also ids) as on the page", () => {
      const text = flag({ at: 600_000 }, { value: HASH, attachmentId: null });
      const pic = flag({ id: "f2", at: 610_000 }, { value: HASH, proof: null, attachmentId: "a2" });
      const shown = { ...ev("f1"), attrs: { source: "entry:f1:value", also: ["f2"] } };
      expect(find(run(data({ log: [text, pic] }), doc(shown)), "proof-screenshot")).toBeUndefined();
    });
    it("never reads a private web request before the flag as the proof's source", () => {
      const web = entry({ id: "w", kind: "http", at: 4000, private: true, content: { kind: "http", request: "GET /" } });
      expect(find(run(data({ log: [web, flag()] }), goodDoc()), "proof-web")).toBeUndefined();
    });
    it("a shell's own output beside the flag is no web request", () => {
      const web = entry({ id: "w", kind: "http", at: 590_000, content: { kind: "http", request: "GET /" } });
      expect(find(run(data({ log: [web, bare(), read(), shot()] }), doc(ev("f1"), ...cmd("r1"), fig("s1"))), "proof-web")).toBeUndefined();
    });
    it("asks no explanation of a flag's step: it opens with its own sentence", () => {
      const page = doc(step(words("Read proof.txt:"), ev("f1"), ...cmd("r1"), fig("s1")));
      expect(find(run(data({ log: [bare(), read(), shot()] }), page), "explain")).toBeUndefined();
    });
  });

  it("names which flag's proof falls short, one check per flag", () => {
    const local = flag({ id: "f0", at: 4000 }, { flagKind: "local", proof: "dev@web01:/tmp$ cat local.txt\nid\nhostname\nip addr\n10.0.0.5" });
    const proof = flag({}, { proof: "root@web01:/tmp# cat proof.txt\nid\nhostname\nip addr\n10.0.0.5" });
    const c = run(data({ hosts: [host({ os: "linux" })], log: [local, proof] }), doc(ev("f0"), words("x"), ...goodDoc().content!), {}, ["local", "proof"]);
    expect(c.filter((x) => x.id.startsWith("proof-path")).map((x) => [x.id, x.text])).toEqual([
      ["proof-path:DC01:local", "The local.txt proof for DC01 doesn't read the flag from its usual location."],
      ["proof-path:DC01:proof", "The proof.txt proof for DC01 doesn't read the flag from its usual location."],
    ]);
  });

  describe("output", () => {
    const blank = (extra = {}) => entry({ id: "c1", content: { kind: "command", blocks: [{ command: "ls", output: "  " }] }, ...extra });
    const noOutput = (id: string) => code("ls", `entry:${id}:0:command`);
    it("is soft for a command on the page with no output block, anchored at its command", () => {
      const c = find(run(data({ log: [blank(), flag()] }), doc(words("Listed."), noOutput("c1"), ...goodDoc().content!)), "output")!;
      expect(c).toMatchObject({
        id: "output:c1",
        level: "soft",
        text: "A command on the page shows no output. Fine if it printed nothing; otherwise paste its output.",
        anchor: { entryId: "c1", nodeIndex: 2 },
      });
    });
    it("says nothing when the entry returned nothing, or an output block is there", () => {
      expect(find(run(data({ log: [blank({ returnedNothing: true }), flag()] }), doc(noOutput("c1"), ...goodDoc().content!)), "output")).toBeUndefined();
      expect(find(run(data({ log: [blank(), flag()] }), doc(...cmd("c1"), ...goodDoc().content!)), "output")).toBeUndefined();
      // Any output block of the entry counts, a second command with none included.
      const two = entry({ id: "c2", content: { kind: "command", blocks: [{ command: "a", output: "x" }, { command: "b", output: "" }] } });
      expect(find(run(data({ log: [two, flag()] }), doc(...cmd("c2"), noOutput("c2"), ...goodDoc().content!)), "output")).toBeUndefined();
    });
  });

  describe("explain", () => {
    it("is soft, one per step whose first child is no sentence, anchored to the step, screenshot steps first", () => {
      const shot = entry({ id: "s1", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" } });
      const page = doc(h2("Initial access", "phase:h1:foothold"), stepsPara(), step(hint(), ...cmd("c1")), step(hint(), fig("s1")), ...goodDoc().content!);
      const c = run(data({ log: [entry({ id: "c1" }), shot, flag()] }), page).filter((x) => x.id.startsWith("explain"));
      expect(c.map((x) => [x.id, x.level, x.anchor])).toEqual([
        ["explain:s1", "soft", { entryId: "s1", nodeIndex: 10 }],
        ["explain:c1", "soft", { entryId: "c1", nodeIndex: 4 }],
      ]);
      expect(c[0].text).toBe("A step has no explanation before it.");
    });
    it("a step opening with words, or a step with no sourced block, is judged by its first child", () => {
      const page = doc(step(words("Listed the shares:"), ...cmd("c1")), ...goodDoc().content!);
      expect(find(run(data({ log: [entry({ id: "c1" }), flag()] }), page), "explain")).toBeUndefined();
      expect(find(run(data({ log: [flag()] }), doc(step(code("x", "free")), ...goodDoc().content!)), "explain:node-0")).toBeDefined();
    });
  });

  describe("step-replay", () => {
    const check = (page: ReportNode, log: LogEntry[] = [entry({ id: "c1" }), flag()]) => find(run(data({ log }), page), "step-replay");
    it("step-replay: a step with words and no code or figure", () => {
      const page = doc(h2("Initial access", "phase:h1:foothold"), stepsPara(), step(words("I logged in over SSH as ronan.")));
      const c = targetChecks({ data: data({ log: [flag()] }), target, doc: page, meta: {}, sectionId: "sec-1" }).filter((x) => x.id.startsWith("step-replay"));
      expect(c.map((x) => x.id)).toEqual(["step-replay:sec-1:2"]);
      expect(c[0]).toMatchObject({
        level: "soft",
        text: "Step 1 of Initial access has no command or output under it, so a reader can't replay it. Add it from the log column",
        anchor: { nodeIndex: 4 },
      });
      expect(checkKind(c[0].id)).toBe("step-replay");
    });
    it("counts steps since the last heading and names the nearest level-2 heading", () => {
      const page = doc(
        h1("DC01 (10.0.0.5)"),
        h2("Initial access", "phase:h1:foothold"),
        step(words("Scanned:"), ...cmd("c1")),
        step(words("Then this.")),
        h2("Privilege escalation", "phase:h1:privesc"),
        step(words("And this.")),
      );
      expect(run(data({ log: [entry({ id: "c1" }), flag()] }), page).filter((x) => x.id.startsWith("step-replay")).map((x) => x.text.slice(0, 40))).toEqual([
        "Step 2 of Initial access has no command ",
        "Step 1 of Privilege escalation has no co",
      ]);
    });
    it("falls back to the level-1 heading, then to this page", () => {
      expect(check(doc(h1("DC01 (10.0.0.5)"), step(words("Said."))))!.text).toMatch(/^Step 1 of DC01 \(10.0.0.5\) /);
      expect(check(doc(step(words("Said."))))!.text).toMatch(/^Step 1 of this page /);
    });
    it("a step holding a command or a figure, at any depth, passes", () => {
      expect(check(doc(step(words("Said:"), ...cmd("c1"))))).toBeUndefined();
      expect(check(doc(step(words("Said:"), fig("s1"))))).toBeUndefined();
      expect(check(doc(step(words("Said:"), { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [code("x", "entry:c1:0:command")] }] }] })))).toBeUndefined();
    });
    it("a note step is prose already", () => {
      expect(check(doc(step(words("What I saw.", "entry:n1:note"))), [entry({ id: "n1", kind: "note", content: { kind: "note", text: "What I saw." } }), flag()])).toBeUndefined();
    });
    it("a step with no sentence is the explain check's, not this one's", () => {
      const c = run(data({ log: [flag()] }), doc(step(hint())));
      expect(find(c, "step-replay")).toBeUndefined();
      expect(find(c, "explain")).toBeDefined();
    });
    it("a bullet is no step", () => {
      expect(check(doc({ type: "list", attrs: { kind: "bullet" }, content: [words("A bullet.")] }))).toBeUndefined();
    });
  });
  describe("cred-finding", () => {
    const two = [host({ id: "h1", name: "ms02" }), host({ id: "h2", name: "ms01" })];
    const cred = (o: Record<string, unknown> = {}) => ({ id: "cr1", username: "sam.rivera", secret: "Hunter2!Sup3r", sourceHostId: "h2", ...o });
    const grant = (o: Record<string, unknown> = {}) => ({ id: "g1", usernameId: "u1", hostId: "h1", level: "user", via: "winrm", logEntryId: "sh", at: 1, ...o });
    const base = (o: Record<string, unknown> = {}) => data({ hosts: two, log: [flag()], credentials: [cred()] as never, usernames: [{ id: "u1", username: "sam.rivera" }] as never, grants: [grant()] as never, ...o });
    const finding = (o: Record<string, unknown> = {}) => ({ id: "fd1", title: "Weak", description: "", remediation: "", hostIds: ["h1"], serviceIds: [], stepEntryIds: [], ...o });
    const texts = (d: ReportData) => run(d, goodDoc()).filter((x) => x.id.startsWith("cred-finding"));
    it("flags a credential from one machine that granted access on another with no finding naming it", () => {
      const [c] = texts(base());
      expect(c.text).toBe("sam.rivera's credential from ms01 got you onto ms02, but no finding covers it. A credential that lets you move is a finding too");
      expect(c).toMatchObject({ id: "cred-finding:cr1:h1", level: "soft" });
      expect(checkKind(c.id)).toBe("cred-finding");
    });
    it("also reads a hop whose via names the user", () => {
      const d = base({ grants: [], hops: [{ id: "hp", fromHostId: "h2", toHostId: "h1", via: "evil-winrm as sam.rivera", logEntryId: "hx", at: 1 }] as never });
      expect(texts(d)).toHaveLength(1);
    });
    it("no check when a finding on either machine names the username, or has the grant's entry as a step", () => {
      expect(texts(base({ findings: [finding({ description: "Reused SAM.RIVERA's password" })] as never }))).toEqual([]);
      expect(texts(base({ findings: [finding({ hostIds: ["h2"], title: "sam.rivera reuse" })] as never }))).toEqual([]);
      expect(texts(base({ findings: [finding({ stepEntryIds: ["sh"] })] as never }))).toEqual([]);
      expect(texts(base({ findings: [finding({ hostIds: ["h3"], title: "sam.rivera" })] as never }))).toHaveLength(1);
    });
    it("no check for access on the credential's own machine, or on a machine outside the target", () => {
      expect(texts(base({ credentials: [cred({ sourceHostId: "h1" })] as never }))).toEqual([]);
      expect(texts(base({ grants: [grant({ hostId: "h2" })] as never, credentials: [cred({ sourceHostId: "h3" })] as never }))).toEqual([]);
    });
    it("matches the username as a whole word, any case", () => {
      const admin = (o: Record<string, unknown> = {}) =>
        base({ credentials: [cred({ username: "admin" })] as never, usernames: [{ id: "u1", username: "admin" }] as never, ...o });
      expect(texts(admin({ findings: [finding({ title: "Administrator password reuse" })] as never }))).toHaveLength(1);
      expect(texts(admin({ findings: [finding({ description: "Reused ADMIN's password" })] as never }))).toEqual([]);
      const sa = (o: Record<string, unknown> = {}) =>
        base({ credentials: [cred({ username: "sa" })] as never, usernames: [{ id: "u9", username: "nobody" }] as never, grants: [], ...o });
      expect(texts(sa({ hops: [{ id: "hp", fromHostId: "h2", toHostId: "h1", via: "psexec as salvador", logEntryId: "hx", at: 1 }] as never }))).toEqual([]);
      expect(texts(sa({ hops: [{ id: "hp", fromHostId: "h2", toHostId: "h1", via: "mssqlclient as sa", logEntryId: "hx", at: 1 }] as never }))).toHaveLength(1);
    });
    it("never puts the credential's secret in the text", () => {
      const c = texts(base())[0];
      expect(JSON.stringify(c)).not.toContain("Hunter2");
    });
  });
  describe("access-shot", () => {
    const HOUR = 3_600_000;
    const shell = entry({ id: "sh", at: 10_000_000 });
    const shot = (o: Record<string, unknown> = {}) =>
      entry({ id: "s1", kind: "screenshot", at: 10_000_000 + 60_000, content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" }, ...o });
    const page = doc(words("x"), ...cmd("sh"), fig("s1"), ...goodDoc().content!);
    const grant = (o: Record<string, unknown> = {}) => ({ id: "g", hostId: "h1", level: "admin", at: 10_000_000, via: "x", logEntryId: "sh", ...o });
    const check = (log: LogEntry[], g = grant(), p = page) => find(run(data({ log: [...log, flag()], grants: [g] as never }), p), "access-shot");

    it("times a linked grant by its step, not by when it was recorded", () => {
      expect(check([shell, shot()], grant({ at: 10_000_000 + 2 * HOUR }))).toBeUndefined();
      const c = check([shell, shot({ at: 10_000_000 + 10 * 60_000 })])!;
      expect(c).toMatchObject({ id: "access-shot:DC01:admin", level: "soft" });
      expect(c.text).toContain("DC01");
    });
    it("with no step linked, takes any of the host's screenshots from its first access step on", () => {
      // Recorded two hours after the shell screenshot, with no step: the screenshot still shows it.
      const unlinked = grant({ logEntryId: null, at: 10_000_000 + 2 * HOUR });
      expect(check([shell, shot()], unlinked)).toBeUndefined();
      const first = grant({ id: "g0", level: "user", logEntryId: "sh" });
      const before = shot({ at: 10_000_000 - HOUR });
      const d = data({ log: [shell, before, flag()], grants: [first, unlinked] as never });
      expect(run(d, page).filter((c) => c.id.startsWith("access-shot")).map((c) => c.id)).toEqual(["access-shot:DC01:user", "access-shot:DC01:admin"]);
    });
    it("counts only the host's own, non-private screenshots that are figures on the page", () => {
      expect(check([shell, shot({ hostIds: ["h2"] })])).toBeDefined();
      expect(check([shell, shot({ private: true })])).toBeDefined();
      expect(check([shell], grant(), doc(words("x"), ...cmd("sh")))).toBeDefined();
      // A screenshot the page doesn't show as a figure shows no access.
      expect(check([shell, shot()], grant(), doc(words("x"), ...cmd("sh")))).toBeDefined();
      const flagShot = flag({ id: "fs", at: 10_000_000 + 1000 });
      expect(check([shell, flagShot], grant(), doc(words("x"), ...cmd("sh"), fig("fs")))).toBeUndefined();
    });
  });
  describe("captions", () => {
    const shotEntry = (caption: string, o: Record<string, unknown> = {}) =>
      entry({ id: "s1", kind: "screenshot", title: "Screenshot", content: { kind: "screenshot", attachmentId: "a", caption, fileName: "x" }, ...o });
    const ids = (log: LogEntry[], page: ReportNode) => run(data({ log: [...log, flag()] }), page).filter((c) => c.id.startsWith("caption")).map((c) => [c.id, c.level]);
    it("caption-weak: a figure with no caption, or a bare Screenshot", () => {
      expect(ids([shotEntry("")], doc(fig("s1", ""), ...goodDoc().content!))).toEqual([["caption-weak:s1", "soft"]]);
      expect(ids([shotEntry("")], doc(fig("s1", "Screenshot"), ...goodDoc().content!))).toEqual([["caption-weak:s1", "soft"]]);
      expect(ids([shotEntry("")], doc(fig("s1", "Root shell on DC01"), ...goodDoc().content!))).toEqual([]);
      const c = run(data({ log: [shotEntry(""), flag()] }), doc(fig("s1", ""), ...goodDoc().content!)).filter((x) => x.id.startsWith("caption-weak"));
      expect(groupChecks(c).map((g) => g.text)).toEqual(["A screenshot has no caption"]);
      expect(c[0].anchor).toEqual({ entryId: "s1", nodeIndex: 0 });
    });
    it("caption: a figure caption over 10 words", () => {
      const long = "one two three four five six seven eight nine ten eleven";
      expect(ids([shotEntry(long)], doc(fig("s1", long), ...goodDoc().content!))).toEqual([["caption:s1", "soft"]]);
      expect(ids([shotEntry("")], doc(fig("s1", "one two three four five six seven eight nine ten"), ...goodDoc().content!))).toEqual([]);
    });
    it("a figure prints only its own caption: no step-title check exists", () => {
      const step = entry({ id: "c1", title: "Full port scan" });
      expect(ids([step, shotEntry("")], doc(...cmd("c1"), fig("s1", ""), ...goodDoc().content!))).toEqual([["caption-weak:s1", "soft"]]);
    });
    it("legible: a too-narrow figure, named by its caption, never a private entry's", () => {
      const page = doc(fig("s1", "Full port scan"));
      const named = legibilityChecks(page, data({ log: [shotEntry("")] }), { s1: 300 });
      expect(named.map((c) => c.text)).toEqual(['The screenshot "Full port scan" is narrower than would print legibly. Retake it larger or crop it tighter.']);
      expect(named[0]).toMatchObject({ id: "legible:s1", level: "soft", anchor: { entryId: "s1" } });
      expect(legibilityChecks(doc(fig("s1", "")), data({ log: [shotEntry("")] }), { s1: 300 })[0].text).toContain('"A screenshot"');
      expect(legibilityChecks(page, data({ log: [shotEntry("", { private: true })] }), { s1: 300 })).toEqual([]);
      expect(legibilityChecks(page, data({ log: [shotEntry("")] }), { s1: 900 })).toEqual([]);
    });
  });
  describe("copied-private and copied-deleted", () => {
    const note = (o: Record<string, unknown> = {}) => entry({ id: "n1", kind: "note", content: { kind: "note", text: "copied words" }, ...o });
    const copied = (cs: Check[]) => cs.filter((c) => c.id.startsWith("copied")).map((c) => [c.id, c.level, c.anchor?.nodeIndex]);

    it("copied-deleted: a block from a deleted entry is a fail at that block", () => {
      const page = doc(words("x"), code("id", "entry:gone:0:output"), code("again", "entry:gone:1:command"), ...goodDoc().content!);
      expect(run(good(), page).filter((c) => c.id.startsWith("copied"))).toEqual([
        { id: "copied-deleted:gone", level: "fail", text: "A block on the page comes from an entry that was deleted.", anchor: { nodeIndex: 2 } },
      ]);
    });
    it("copied-private: a block, or a figure, from a private entry fails once per entry, at its first block", () => {
      const priv = [note({ private: true }), entry({ id: "s1", kind: "screenshot", private: true, content: { kind: "screenshot", attachmentId: "a", caption: "", fileName: "x" } }), flag()];
      const page = doc(words("copied words", "entry:n1:note"), fig("s1"), words("more", "entry:n1:note"), ...goodDoc().content!);
      expect(copied(run(data({ log: priv }), page))).toEqual([
        ["copied-private:n1", "fail", 0],
        ["copied-private:s1", "fail", 2],
      ]);
      expect(groupChecks(run(data({ log: priv }), page).filter((c) => c.id.startsWith("copied"))).map((g) => g.text)).toEqual(["2 entries now private had text copied to the page"]);
      expect(groupChecks(run(data({ log: priv }), doc(words("copied words", "entry:n1:note"), ...goodDoc().content!)).filter((c) => c.id.startsWith("copied"))).map((g) => g.text)).toEqual(["Text from a now-private entry"]);
    });
    it("says nothing while the entries are there", () => {
      const page = doc(words("copied words", "entry:n1:note"), ...goodDoc().content!);
      expect(copied(run(data({ log: [note(), flag()] }), page))).toEqual([]);
    });
    it("operator attempts are never mentioned", () => {
      const attempt = { id: "a", hostId: "h1", title: "SECRETOPERATORNOTE", reasonKind: "operator", reason: "SECRETREASON", private: true, logEntryId: "p1" };
      const page = doc(code("x", "entry:p1:0:command"), ...goodDoc().content!);
      const c = run(data({ log: [entry({ id: "p1", private: true }), flag()], attempts: [attempt] as never }), page);
      expect(find(c, "copied-private:p1")).toBeDefined();
      expect(JSON.stringify(c)).not.toMatch(/SECRET/);
    });
  });
  describe("gone", () => {
    it("fails once per finding or file that no longer exists, at its first block", () => {
      const page = doc(words("Why.", "finding:nf:explanation"), words("Fix.", "finding:nf:fix"), code("x", "file:nx"), ...goodDoc().content!);
      expect(run(good(), page).filter((c) => c.id.startsWith("gone"))).toEqual([
        { id: "gone:nf", level: "fail", text: "A finding or file on the page was deleted.", anchor: { nodeIndex: 0 } },
        { id: "gone:nx", level: "fail", text: "A finding or file on the page was deleted.", anchor: { nodeIndex: 4 } },
      ]);
    });
    it("says nothing for a finding and a file that exist", () => {
      const f = { id: "f9", title: "Two words", severity: "high", hostIds: ["h1"], serviceIds: [], description: "Why.", remediation: "Fix.", stepEntryIds: [], refs: [] };
      const file = { id: "x1", findingId: "f9", name: "poc.py", modified: false, originalUrl: null, originalContent: null, content: "a" };
      const page = doc(words("Why.", "finding:f9:explanation"), words("Exploit code:", "file:x1"), ...goodDoc().content!);
      expect(find(run(data({ log: [flag()], findings: [f], findingFiles: [file] } as never), page), "gone")).toBeUndefined();
    });
  });
  describe("finding checks", () => {
    const f = { id: "f9", title: "nmap", severity: null, hostIds: [], serviceIds: [], description: "", remediation: "", stepEntryIds: [] };
    it("raises one soft check per problem, once per finding, anchored at its first block", () => {
      const page = doc(words("x"), words("Fix.", "finding:f9:fix"), words("Why.", "finding:f9:explanation"), ...goodDoc().content!);
      const c = run(data({ log: [flag()], findings: [f] as never }), page).filter((x) => x.id.startsWith("finding:f9"));
      expect(c.map((x) => x.id).sort()).toEqual(["finding:f9:affected", "finding:f9:description", "finding:f9:remediation", "finding:f9:severity", "finding:f9:title"]);
      expect(c.every((x) => x.level === "soft" && x.anchor?.nodeIndex === 2)).toBe(true);
    });
    it("reads any finding source, and none for a finding the page doesn't name", () => {
      expect(run(data({ log: [flag()], findings: [f] as never }), doc(words("Bullet", "finding:f9"), ...goodDoc().content!)).some((x) => x.id.startsWith("finding:f9"))).toBe(true);
      expect(run(data({ log: [flag()], findings: [f] as never }), goodDoc()).some((x) => x.id.startsWith("finding:"))).toBe(false);
    });
  });
  it("wording flags each absolute claim in a paragraph at any depth, table cells included", () => {
    const cell: ReportNode = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [words("This is impossible.")] }] }] };
    const page = doc(words("Fully secure, not vulnerable."), cell, step(words("Impossible to reach:")), ...goodDoc().content!);
    const c = run(good(), page).filter((x) => x.id.startsWith("wording"));
    expect(c.map((x) => x.id)).toEqual(["wording:0", "wording:1", "wording:2", "wording:3"]);
    expect(c.every((x) => x.level === "soft")).toBe(true);
    expect(c[0].anchor).toEqual({ nodeIndex: 0 });
  });
  describe("exploit checks", () => {
    const file = { id: "x1", findingId: "f9", name: "poc.py", modified: true, originalUrl: null, originalContent: null, content: "a" };
    const blocks = (): ReportNode[] => [words("Exploit code:", "file:x1"), code("a", "file:x1")];
    const exploit = (f: object, ...after: ReportNode[]) => run(data({ log: [flag()], findingFiles: [f] as never }), doc(...goodDoc().content!, ...blocks(), ...after)).filter((x) => x.id.startsWith("exploit"));
    it("a modified file with no URL, no original and nothing after it", () => {
      expect(exploit(file).map((x) => [x.id, x.level])).toEqual([
        ["exploit:x1:url", "fail"],
        ["exploit:x1:explain", "soft"],
        ["exploit:x1:original", "fail"],
      ]);
      expect(exploit(file)[0].anchor).toEqual({ nodeIndex: 4 });
    });
    it("is clean with its URL, its original and a sentence after the run", () => {
      expect(exploit({ ...file, originalUrl: "https://e", originalContent: "b" }, words("Changed the host."))).toEqual([]);
    });
    it("a paragraph of the run after its code (the exploit notes) explains it", () => {
      const ok = { ...file, originalUrl: "https://e", originalContent: "b" };
      const page = doc(words("Exploit code:", "file:x1"), code("a", "file:x1"), words("Changed the host.", "file:x1"), words("Next", "finding:f9:fix"));
      expect(run(data({ log: [flag()], findingFiles: [ok] as never }), page).filter((x) => x.id.startsWith("exploit"))).toEqual([]);
    });
    it("an unmodified file asks nothing, and a missing original content fails with no marked-lines escape", () => {
      expect(exploit({ ...file, modified: false })).toEqual([]);
      const c = exploit({ ...file, originalUrl: "https://e" }, words("Changed it."));
      expect(c.map((x) => [x.id, x.level])).toEqual([["exploit:x1:original", "fail"]]);
      expect(c[0].text).toBe("The modified exploit poc.py has no original to compare against.");
    });
  });
  it("coverage is soft for untested services", () => {
    const svc = { id: "sv1", hostId: "h1", port: 445, protocol: "tcp", nmapService: "smb", nmapVersion: null, confirmedProduct: null, confirmedVersion: null, verdict: null };
    const c = find(run(data({ log: [flag()], services: [svc] as never }), goodDoc()), "coverage")!;
    expect(c).toMatchObject({ id: "coverage:sv1", level: "soft" });
    expect(c.text).toContain("DC01");
  });
  it("move: a code block over 60 lines is a soft suggestion with its path", () => {
    const long = Array.from({ length: 61 }, (_, i) => `l${i}`).join("\n");
    const c = find(run(good(), doc(words("x"), code(long, "entry:c1:0:output"), ...goodDoc().content!)), "move")!;
    expect(c).toMatchObject({ id: "move:1", level: "soft", text: "This block is long (61 lines). Consider moving it to an appendix page." });
    expect(groupChecks([c]).map((g) => g.text)).toEqual(["Long block (61 lines)"]);
  });
  it("no check reads caption-step or appendix-ref any more", () => {
    const garnet = garnetFixtures(1_700_000_000_000);
    const t: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
    const ids = targetChecks({ data: garnet, target: t, doc: buildPlainTarget(garnet, t, {}), meta: {}, sectionId: "t1" }).map((c) => c.id);
    expect(ids.filter((id) => id.startsWith("caption-step") || id.startsWith("appendix-ref"))).toEqual([]);
  });
  it("the garnet draft as drafted has no fail", () => {
    const garnet = garnetFixtures(1_700_000_000_000);
    const t: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
    const checks = targetChecks({ data: garnet, target: t, doc: buildPlainTarget(garnet, t, {}), meta: {}, sectionId: "t1" });
    expect(checks.filter((c) => c.level === "fail")).toEqual([]);
  });
});

describe("reportChecks", () => {
  const report = (o: Partial<Report> = {}) => ({ candidateName: "A", email: "a@b.c", osid: "OS-123", ...o }) as Report;
  it("is clean for complete details", () => {
    expect(reportChecks({ report: report(), targets: [target], data: data() })).toEqual([]);
  });
  it("details, osid and no-targets", () => {
    expect(reportChecks({ report: report({ email: " " }), targets: [target], data: data() }).map((c) => [c.id, c.level])).toEqual([["details", "fail"]]);
    expect(reportChecks({ report: report({ osid: "123" }), targets: [target], data: data() }).map((c) => [c.id, c.level])).toEqual([["osid", "fail"]]);
    expect(reportChecks({ report: report(), targets: [], data: data() }).map((c) => c.id)).toEqual(["no-targets"]);
  });
  it("msf-many when Metasploit modules are attributed to more than one host", () => {
    const msf = (id: string, hostId: string) => entry({ id, hostIds: [hostId], content: { kind: "command", blocks: [{ command: "msfconsole -q\nuse exploit/windows/smb/ms17_010_eternalblue", output: "x" }] } });
    const two = data({ hosts: [host(), host({ id: "h2", name: "WS01" })], log: [msf("m1", "h1"), msf("m2", "h2")] });
    const targets: ReportTarget[] = [target, { key: "h2", kind: "standalone", hostIds: ["h2"] }];
    const c = reportChecks({ report: report(), targets, data: two });
    expect(c.map((x) => [x.id, x.level])).toEqual([["msf-many", "fail"]]);
    expect(reportChecks({ report: report(), targets: [target], data: two })).toEqual([]);
  });
});

describe("isReady", () => {
  it("is true when only soft checks remain", () => {
    expect(isReady([{ id: "a", level: "soft", text: "" }])).toBe(true);
    expect(isReady([{ id: "a", level: "soft", text: "" }, { id: "b", level: "fail", text: "" }])).toBe(false);
  });
});

describe("groupChecks", () => {
  const c = (id: string, level: "fail" | "soft" = "soft", text = id): Check => ({ id, level, text });
  it("groups checks of one kind into a counted row, fails first, in first-seen order", () => {
    const groups = groupChecks([
      c("explain:a"),
      c("coverage:s1", "soft", "22/tcp on web01 is untested."),
      c("explain:b"),
      c("proof-missing:web01:local", "fail", "No local.txt for web01 on the page."),
      c("explain:c"),
    ]);
    expect(groups.map((g) => [g.key, g.level, g.text, g.full, g.checks.length])).toEqual([
      // One check reads short in the outline; its full text is the tooltip's.
      ["proof-missing", "fail", "No local.txt for web01", "No local.txt for web01 on the page.", 1],
      ["explain", "soft", "3 steps have no explanation", "3 steps have no explanation", 3],
      ["coverage", "soft", "22/tcp on web01 is untested", "22/tcp on web01 is untested.", 1],
    ]);
  });
  it("keys finding and exploit checks by their kind, not their id", () => {
    const groups = groupChecks([c("finding:f1:severity"), c("finding:f2:severity"), c("finding:f1:remediation"), c("exploit:x:url", "fail"), c("exploit:y:url", "fail")]);
    expect(groups.map((g) => [g.key, g.text])).toEqual([
      ["exploit-url", "2 modified exploits have no original URL"],
      ["finding-severity", "2 findings have no severity"],
      ["finding-remediation", "A finding has no remediation"],
    ]);
  });
  it("words one check of each kind briefly, naming the flag, host or reason from the check", () => {
    const one = (id: string, text = "x") => groupChecks([c(id, "soft", text)])[0].text;
    expect(one("proof-ip:ms01:local")).toBe("local.txt proof lacks ipconfig");
    expect(one("access-shot:ms01:system")).toBe("ms01: no system screenshot");
    expect(one("output:e1")).toBe("A command shows no output");
    expect(one("exploit:f:explain")).toBe("Explain the modified exploit");
    expect(one("move:0.3", "This block is long (80 lines). Consider moving it to an appendix page.")).toBe("Long block (80 lines)");
    expect(one("gone:f1")).toBe("Deleted finding or file on the page");
    for (const k of ["proof-missing:h:proof", "proof-shot:h:local", "copied-private:1", "copied-deleted:1", "proof-screenshot:h:proof", "proof-web:h:proof", "proof-identity:h:proof", "proof-hostname:h:proof", "proof-path:h:proof", "gone:1", "explain:1", "caption:1", "finding:x:severity", "finding:x:title", "finding:x:affected", "finding:x:description", "finding:x:remediation", "wording:1", "exploit:x:url", "exploit:x:original", "legible:1"]) {
      expect(one(k, "the full text"), k).not.toBe("the full text");
      expect(one(k).length, k).toBeLessThanOrEqual(38);
      // Single and counted lines end alike: no full stop.
      expect(one(k), k).not.toMatch(/\.$/);
    }
  });
  it("words every kind targetChecks makes when there are two of it", () => {
    const kinds = ["proof-missing", "proof-ip", "proof-screenshot", "proof-web", "proof-identity", "proof-hostname", "proof-path", "proof-shot", "gone", "copied-private", "copied-deleted", "output", "explain", "step-replay:t1", "cred-finding", "caption", "caption-weak", "access-shot", "finding:x:severity", "finding:x:title", "finding:x:affected", "finding:x:description", "finding:x:remediation", "wording", "exploit:x:url", "exploit:x:explain", "exploit:x:original", "coverage", "move", "legible"];
    for (const k of kinds) {
      const id = (n: number) => (k.includes(":x:") ? k.replace(":x:", `:${n}:`) : `${k}:${n}`);
      const [g] = groupChecks([c(id(1), "soft", "one"), c(id(2), "soft", "two")]);
      expect(g.text, k).toMatch(/^2 /);
      expect(g.text, k).not.toMatch(/\.$/);
    }
  });
});

describe("stepTitleBefore", () => {
  const top = (...ids: string[]) => ids.map((id) => ({ type: "evidence", attrs: { entryId: id } }));
  const log = [
    entry({ id: "c1", title: "Full port scan" }),
    entry({ id: "p1", title: "secret box", private: true }),
    entry({ id: "s0", kind: "screenshot", title: "Screenshot", private: true }),
    entry({ id: "s1", kind: "screenshot", title: "Screenshot" }),
  ];
  const of = (id: string) => log.find((e) => e.id === id);
  it("takes the nearest step above, past screenshots (private ones too)", () => {
    expect(stepTitleBefore(top("c1", "s0", "s1"), 2, of)).toBe("Full port scan");
  });
  it("never borrows a title when the step above is private or deleted", () => {
    expect(stepTitleBefore(top("c1", "p1", "s1"), 2, of)).toBeNull();
    expect(stepTitleBefore(top("c1", "gone", "s1"), 2, of)).toBeNull();
  });
});

describe("fixSteps", () => {
  it("splits on bullets, blank lines and sentence ends", () => {
    expect(fixSteps("- Patch Umbraco\n- Rotate the sa password\n\nRemove the share.\nDisable SMBv1")).toEqual([
      "Patch Umbraco",
      "Rotate the sa password",
      "Remove the share.",
      "Disable SMBv1",
    ]);
  });

  it("never ends a step after a common abbreviation", () => {
    expect(fixSteps("Restrict the service accounts, e.g.\nsvc_sql and svc_web.\nRemove old tools, etc.\nand reboot.")).toEqual([
      "Restrict the service accounts, e.g. svc_sql and svc_web.",
      "Remove old tools, etc. and reboot.",
    ]);
    expect(fixSteps("Harden hosts, i.e.\nthe DCs.\nUse a vendor fix vs.\na workaround.")).toEqual([
      "Harden hosts, i.e. the DCs.",
      "Use a vendor fix vs. a workaround.",
    ]);
  });
});
