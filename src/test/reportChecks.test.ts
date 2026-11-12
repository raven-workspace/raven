import { describe, expect, it } from "vitest";
import { absoluteClaims, groupChecks, isReady, legibilityChecks, proofFacts, reportChecks, stepTitleBefore, targetChecks, fixSteps } from "../engines/report";
import type { AppendixIndex, Check, ReportData, ReportNode, ReportTarget } from "../engines/report";
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
const ev = (entryId: string, extra: Record<string, unknown> = {}): ReportNode => ({ type: "evidence", attrs: { entryId, block: 0, keep: null, emphasis: [], appendix: "inline", ...extra } });
const slot = (text = ""): ReportNode => ({ type: "slot", attrs: { hint: "h" }, content: text ? [{ type: "text", text }] : [] });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const target: ReportTarget = { key: "h1", kind: "standalone", hostIds: ["h1"] };
const noRefs: AppendixIndex = { entries: [], refFor: () => null };

function data(o: Partial<ReportData> = {}): ReportData {
  return { engagement: { id: "eng" }, hosts: [host()], services: [], log: [], checklist: [], findings: [], findingFiles: [], attempts: [], ruledOut: [], grants: [], usernames: [], hops: [], cleanup: [], notes: [], credentials: [], credAttempts: [], ...o } as unknown as ReportData;
}
function run(d: ReportData, page: ReportNode, extra: Record<string, unknown> = {}, flags: ("local" | "proof")[] = ["proof"]): Check[] {
  return targetChecks({ data: d, target, doc: page, meta: { expectedFlags: { h1: flags } }, appendixRefs: noRefs, sectionId: "t1", ...extra });
}
const find = (cs: Check[], prefix: string) => cs.find((c) => c.id.startsWith(prefix));
const good = () => data({ log: [flag()] });
const goodDoc = () => doc(ev("f1", { block: null }), slot("Proof of root"));

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
    const c = run(data({ log: [local, proof] }), doc(ev("f0", { block: null }), ...goodDoc().content!), {}, ["local", "proof"]);
    expect(c.map((x) => [x.id, x.level, x.text, x.anchor?.entryId])).toEqual([
      ["proof-shot:DC01:local", "soft", "Raven can't read screenshots; make sure the local.txt screenshot for DC01 shows ipconfig with 10.0.0.5.", "f0"],
      ["proof-shot:DC01:proof", "soft", "Raven can't read screenshots; make sure the proof.txt screenshot for DC01 shows ipconfig with 10.0.0.5.", "f1"],
    ]);
    expect(groupChecks(c).map((g) => g.text)).toEqual(["2 proof screenshots: Raven can't read them; check each shows the target IP"]);
    expect(groupChecks(c.slice(0, 1)).map((g) => g.text)).toEqual(["local.txt: screenshot shows IP?"]);
    const lin = run(data({ hosts: [host({ os: "linux" })], log: [local] }), doc(ev("f0", { block: null })), {}, ["local"]);
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
      const page = doc(ev("f1", { block: null }), ev("r1"), ev("s1", { block: null }));
      expect(run(data({ log: [bare(), read(), shot()] }), page)).toEqual([]);
    });
    it("(b) the command alone: the text passes, only the missing screenshot is said", () => {
      const c = run(data({ log: [bare(), read()] }), doc(ev("f1", { block: null }), ev("r1")));
      expect(c.map((x) => x.id)).toEqual(["proof-screenshot:DC01:proof"]);
    });
    it("(b) the screenshot alone: one soft reminder, no fail and no whoami or hostname line", () => {
      const c = run(data({ log: [bare(), shot()] }), doc(ev("f1", { block: null }), ev("s1", { block: null })));
      expect(c.map((x) => [x.id, x.level])).toEqual([["proof-shot:DC01:proof", "soft"]]);
    });
    it("(b) a screenshot taken more than 15 minutes away, or nearer another step, is not the proof", () => {
      const far = run(data({ log: [bare(), shot({ at: 600_000 + 16 * 60_000 })] }), doc(ev("f1", { block: null })));
      expect(far.map((x) => x.id)).toContain("proof-screenshot:DC01:proof");
      const step = entry({ id: "c9", at: 710_000 });
      const nearer = run(data({ log: [bare(), step, shot()], checklist: [{ ownerId: "h1", evidence: [{ entryId: "c9" }] }] as never }), doc(ev("f1", { block: null })));
      expect(nearer.map((x) => x.id)).toContain("proof-screenshot:DC01:proof");
    });
    it("(c) a flag with its own screenshot and no text: one soft reminder", () => {
      const c = run(data({ log: [bare({ attachmentId: "a1" })] }), doc(ev("f1", { block: null })));
      expect(c.map((x) => x.id)).toEqual(["proof-shot:DC01:proof"]);
    });
    it("a proof read pasted only as a command still puts the flag on the page", () => {
      const only = entry({ id: "r2", content: { kind: "command", blocks: [{ command: "type proof.txt", output: HASH }] } });
      const c = run(data({ log: [only] }), doc(slot("Read the proof."), ev("r2")));
      expect(find(c, "proof-missing")).toBeUndefined();
    });
    it("checks a proof read on the page as the proof when its flag entry isn't there", () => {
      const only = entry({ id: "r2", at: 660_000, content: { kind: "command", blocks: [{ command: "type proof.txt", output: HASH }] } });
      const c = run(data({ log: [only] }), doc(slot("Read the proof."), ev("r2")));
      expect(c.filter((x) => x.id.startsWith("proof")).map((x) => [x.id, x.level, x.anchor?.entryId])).toEqual([
        ["proof-ip:DC01:proof", "fail", "r2"],
        ["proof-screenshot:DC01:proof", "fail", "r2"],
        ["proof-identity:DC01:proof", "soft", "r2"],
        ["proof-hostname:DC01:proof", "soft", "r2"],
      ]);
      // The full read with its screenshot: nothing to say. A flag entry that isn't on the page changes nothing.
      expect(run(data({ log: [read(), shot()] }), doc(slot("Read the proof."), ev("r1"), ev("s1", { block: null })))).toEqual([]);
      expect(run(data({ log: [bare(), read(), shot()] }), doc(slot("Read the proof."), ev("r1"), ev("s1", { block: null })))).toEqual([]);
    });
    it("counts another proof.txt flag entry's screenshot on the page as the proof's screenshot", () => {
      const text = flag({ at: 600_000 }, { value: HASH, attachmentId: null });
      const pic = flag({ id: "f2", at: 610_000 }, { value: HASH, proof: null, attachmentId: "a2" });
      const c = run(data({ log: [text, pic] }), doc(ev("f1", { block: null }), ev("f2", { block: null })));
      expect(find(c, "proof-screenshot")).toBeUndefined();
      // Off the page, it isn't shown.
      expect(find(run(data({ log: [text, pic] }), doc(ev("f1", { block: null }))), "proof-screenshot")).toBeDefined();
    });
    it("never reads a private web request before the flag as the proof's source", () => {
      const web = entry({ id: "w", kind: "http", at: 4000, private: true, content: { kind: "http", request: "GET /" } });
      expect(find(run(data({ log: [web, flag()] }), goodDoc()), "proof-web")).toBeUndefined();
    });
    it("a shell's own output beside the flag is no web request", () => {
      const web = entry({ id: "w", kind: "http", at: 590_000, content: { kind: "http", request: "GET /" } });
      expect(find(run(data({ log: [web, bare(), read(), shot()] }), doc(ev("f1", { block: null }), ev("r1"), ev("s1", { block: null }))), "proof-web")).toBeUndefined();
    });
    it("asks no explanation of a flag's companions", () => {
      const page = doc(ev("f1", { block: null }), ev("r1"), ev("s1", { block: null }));
      expect(find(run(data({ log: [bare(), read(), shot()] }), page), "explain")).toBeUndefined();
    });
  });

  it("names which flag's proof falls short, one check per flag", () => {
    const local = flag({ id: "f0", at: 4000 }, { flagKind: "local", proof: "dev@web01:/tmp$ cat local.txt\nid\nhostname\nip addr\n10.0.0.5" });
    const proof = flag({}, { proof: "root@web01:/tmp# cat proof.txt\nid\nhostname\nip addr\n10.0.0.5" });
    const c = run(data({ hosts: [host({ os: "linux" })], log: [local, proof] }), doc(ev("f0", { block: null }), slot("x"), ...goodDoc().content!), {}, ["local", "proof"]);
    expect(c.filter((x) => x.id.startsWith("proof-path")).map((x) => [x.id, x.text])).toEqual([
      ["proof-path:DC01:local", "The local.txt proof for DC01 doesn't read the flag from its usual location."],
      ["proof-path:DC01:proof", "The proof.txt proof for DC01 doesn't read the flag from its usual location."],
    ]);
  });
  it("output is soft on blank output unless it returned nothing (downloads print nothing)", () => {
    const blank = (extra = {}) => entry({ id: "c1", content: { kind: "command", blocks: [{ command: "ls", output: "  " }] }, ...extra });
    const page = doc(ev("c1"), slot("x"), ...goodDoc().content!);
    const c = find(run(data({ log: [blank(), flag()] }), page), "output")!;
    expect(c).toMatchObject({
      id: "output:c1",
      level: "soft",
      text: "A command on the page shows no output. Fine if it printed nothing; otherwise paste its output.",
    });
    expect(find(run(data({ log: [blank({ returnedNothing: true }), flag()] }), page), "output")).toBeUndefined();
    const two = entry({ id: "c2", content: { kind: "command", blocks: [{ command: "a", output: "x" }, { command: "b", output: "" }] } });
    const whole = doc(ev("c2", { block: null }), slot("x"), ...goodDoc().content!);
    expect(find(run(data({ log: [two, flag()] }), whole), "output")).toMatchObject({ id: "output:c2", level: "soft" });
    expect(find(run(data({ log: [two, flag()] }), doc(ev("c2", { block: 0 }), slot("x"), ...goodDoc().content!)), "output")).toBeUndefined();
  });
  it("explain is soft, screenshots first", () => {
    // Taken an hour before the flag: a step of its own, not the flag's screenshot.
    const shot = entry({ id: "s1", kind: "screenshot", at: -3_600_000, content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" } });
    const cmd = entry({ id: "c1" });
    const page = doc(slot(""), ev("c1"), slot(""), ev("s1", { block: null }), ...goodDoc().content!);
    const c = run(data({ log: [cmd, shot, flag()] }), page).filter((x) => x.id.startsWith("explain"));
    expect(c.map((x) => [x.id, x.level])).toEqual([["explain:s1", "soft"], ["explain:c1", "soft"]]);
    expect(c[0].text).toBe("A step has no explanation before it.");
    // The walkthrough explains a step before it (OffSec's sample): text after a step doesn't count.
    expect(find(run(data({ log: [cmd, flag()] }), doc(ev("c1"), slot("because"), ...goodDoc().content!)), "explain")).toBeDefined();
    const done = doc(slot("Next, list the shares."), ev("c1"), ...goodDoc().content!);
    expect(find(run(data({ log: [cmd, flag()] }), done), "explain")).toBeUndefined();
  });
  it("stops at another step: in [slot, A, B] only B is unexplained", () => {
    const a = entry({ id: "c1" });
    const b = entry({ id: "c2" });
    const page = doc(slot("List the shares."), ev("c1"), ev("c2"), ...goodDoc().content!);
    const c = run(data({ log: [a, b, flag()] }), page).filter((x) => x.id.startsWith("explain"));
    expect(c.map((x) => x.id)).toEqual(["explain:c2"]);
    // A command's other blocks share its slot.
    expect(find(run(data({ log: [a, flag()] }), doc(slot("Scan."), ev("c1", { block: 0 }), ev("c1", { block: 1 }), ...goodDoc().content!)), "explain")).toBeUndefined();
  });
  it("lets the evidence of one step share the slot before it, and asks nothing of a flag", () => {
    const shot = entry({ id: "s1", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" } });
    const cmd = entry({ id: "c1" });
    const page = doc(slot("Read the share."), ev("c1"), ev("s1", { block: null }), ev("f1", { block: null }));
    expect(find(run(data({ log: [cmd, shot, flag()] }), page), "explain")).toBeUndefined();
  });
  describe("access-shot", () => {
    const HOUR = 3_600_000;
    const shell = entry({ id: "sh", at: 10_000_000 });
    const shot = (o: Record<string, unknown> = {}) =>
      entry({ id: "s1", kind: "screenshot", at: 10_000_000 + 60_000, content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" }, ...o });
    const page = doc(slot("x"), ev("sh"), ev("s1", { block: null }), ...goodDoc().content!);
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
    it("counts only the host's own, non-private screenshots", () => {
      expect(check([shell, shot({ hostIds: ["h2"] })])).toBeDefined();
      expect(check([shell, shot({ private: true })])).toBeDefined();
      expect(check([shell], grant(), doc(slot("x"), ev("sh")))).toBeDefined();
      const flagShot = flag({ id: "fs", at: 10_000_000 + 1000 });
      expect(check([shell, flagShot], grant(), doc(slot("x"), ev("sh"), ev("fs", { block: null })))).toBeUndefined();
    });
  });
  it("caption-weak flags a screenshot with no caption of its own, or a bare \"Screenshot\"", () => {
    const bare = entry({ id: "s1", kind: "screenshot", title: "Screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "", fileName: "x" } });
    const page = doc(ev("s1", { block: null }), slot("x"), ...goodDoc().content!);
    expect(find(run(data({ log: [bare, flag()] }), page), "caption-weak")).toMatchObject({ id: "caption-weak:s1", level: "soft" });
    // A caption written on the page is its own.
    const named = doc(ev("s1", { block: null, caption: "Root shell on DC01" }), slot("x"), ...goodDoc().content!);
    expect(find(run(data({ log: [bare, flag()] }), named), "caption-weak")).toBeUndefined();
    expect(groupChecks(run(data({ log: [bare, flag()] }), page).filter((c) => c.id.startsWith("caption-weak"))).map((g) => g.text)).toEqual(["A screenshot has no caption"]);
  });
  describe("text copied from the log", () => {
    const para = (fromEntry: string, text = "copied words", extra: Record<string, unknown> = {}): ReportNode => ({
      type: "paragraph",
      attrs: { fromEntry, ...extra },
      content: [{ type: "text", text }],
    });
    const code = (fromEntry: string): ReportNode => ({ type: "codeBlock", attrs: { language: "", fromEntry }, content: [{ type: "text", text: "id" }] });
    const note = (o: Record<string, unknown> = {}) => entry({ id: "n1", kind: "note", content: { kind: "note", text: "copied words" }, ...o });
    const copied = (cs: Check[]) => cs.filter((c) => c.id.startsWith("copied")).map((c) => [c.id, c.level, c.text, c.anchor?.nodeIndex]);

    it("fails, anchored, when the entry the text came from is now private", () => {
      const page = doc(para("n1"), para("c1", "said", { fromField: "observations" }), code("c1"), ...goodDoc().content!);
      expect(copied(run(data({ log: [note({ private: true }), entry({ id: "c1", private: true }), flag()] }), page))).toEqual([
        ["copied-private:n1", "fail", "Text copied from an entry that is now private.", 0],
        ["copied-private:c1", "fail", "Text copied from an entry that is now private.", 2],
      ]);
      expect(groupChecks(run(data({ log: [note({ private: true }), flag()] }), doc(para("n1"), ...goodDoc().content!))).map((g) => g.text)).toEqual([
        "Text from a now-private entry",
      ]);
    });
    it("fails when it was deleted, and says nothing while the entry is there", () => {
      const page = doc(slot("x"), para("n1"), code("c9"), ...goodDoc().content!);
      expect(copied(run(data({ log: [flag()] }), page))).toEqual([
        ["copied-deleted:n1", "fail", "Text copied from an entry that was deleted.", 2],
        ["copied-deleted:c9", "fail", "Text copied from an entry that was deleted.", 4],
      ]);
      expect(copied(run(data({ log: [note(), entry({ id: "c9" }), flag()] }), page))).toEqual([]);
    });
  });
  describe("printed captions", () => {
    const bare = entry({ id: "s1", kind: "screenshot", title: "Screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "", fileName: "x" } });
    const step = (o: Record<string, unknown> = {}) => entry({ id: "c1", title: "Full port scan", ...o });
    const page = doc(slot("Scan."), ev("c1"), ev("s1", { block: null }), ...goodDoc().content!);
    const ids = (log: LogEntry[], p = page) => run(data({ log: [...log, flag()] }), p).filter((c) => c.id.startsWith("caption")).map((c) => [c.id, c.level, c.text]);

    it("an uncaptioned screenshot that prints its step's title is said softly as that, not as uncaptioned", () => {
      expect(ids([step(), bare])).toEqual([["caption-step:s1", "soft", "Screenshot uses its step's title as caption."]]);
      const groups = groupChecks(run(data({ log: [step(), bare, flag()] }), page).filter((c) => c.id.startsWith("caption")));
      expect(groups.map((g) => g.text)).toEqual(["Caption is its step's title"]);
    });
    it("counts the words of the caption the page prints", () => {
      const long = step({ title: "one two three four five six seven eight nine ten eleven" });
      expect(ids([long, bare]).map((x) => x[0])).toEqual(["caption-step:s1", "caption:s1"]);
    });
    it("never prints, or counts, a private or deleted step's title", () => {
      expect(ids([step({ private: true }), bare]).map((x) => x[0])).toEqual(["caption-weak:s1"]);
      expect(ids([bare]).map((x) => x[0])).toEqual(["caption-weak:s1"]);
    });
    it("names a too-narrow screenshot by the caption the page prints, never a private step's", () => {
      const named = legibilityChecks(page, data({ log: [step(), bare] }), { s1: 300 });
      expect(named.map((c) => c.text)).toEqual(['The screenshot "Full port scan" is narrower than would print legibly. Retake it larger or crop it tighter.']);
      const hidden = legibilityChecks(page, data({ log: [step({ title: "secret box", private: true }), bare] }), { s1: 300 });
      expect(hidden[0].text).not.toContain("secret");
    });
  });
  it("caption is soft over 10 words", () => {
    const long = entry({ id: "s1", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "one two three four five six seven eight nine ten eleven", fileName: "x" } });
    const page = doc(ev("s1", { block: null }), slot("x"), ...goodDoc().content!);
    expect(find(run(data({ log: [long, flag()] }), page), "caption")).toMatchObject({ id: "caption:s1", level: "soft" });
  });
  it("finding raises one soft check per problem", () => {
    const f = { id: "f9", title: "nmap", severity: null, hostIds: [], serviceIds: [], description: "", remediation: "" };
    const page = doc({ type: "vuln", attrs: { findingId: "f9" } }, ...goodDoc().content!);
    const c = run(data({ log: [flag()], findings: [f] as never }), page).filter((x) => x.id.startsWith("finding:f9"));
    expect(c.map((x) => x.id).sort()).toEqual(["finding:f9:affected", "finding:f9:description", "finding:f9:remediation", "finding:f9:severity", "finding:f9:title"]);
    expect(c.every((x) => x.level === "soft")).toBe(true);
  });
  it("wording flags each absolute claim in slots and paragraphs", () => {
    const page = doc(slot("This is impossible."), { type: "paragraph", content: [{ type: "text", text: "Fully secure, not vulnerable." }] }, ...goodDoc().content!);
    const c = run(good(), page).filter((x) => x.id.startsWith("wording"));
    expect(c.map((x) => x.id)).toEqual(["wording:0", "wording:1", "wording:2"]);
    expect(c.every((x) => x.level === "soft")).toBe(true);
  });
  it("exploit checks", () => {
    const file = { id: "x1", findingId: "f9", name: "poc.py", modified: true, originalUrl: null, originalContent: null, content: "a" };
    const exploit = (marked: number[] = []): ReportNode => ({ type: "exploit", attrs: { fileId: "x1", markedLines: marked, appendix: "inline" } });
    const c = run(data({ log: [flag()], findingFiles: [file] as never }), doc(exploit(), ...goodDoc().content!));
    expect(c.filter((x) => x.id.startsWith("exploit")).map((x) => [x.id, x.level])).toEqual([
      ["exploit:x1:url", "fail"],
      ["exploit:x1:explain", "soft"],
      ["exploit:x1:original", "fail"],
    ]);
    const ok = { ...file, originalUrl: "https://e", originalContent: "b" };
    const c2 = run(data({ log: [flag()], findingFiles: [ok] as never }), doc(exploit(), slot("Changed the host"), ...goodDoc().content!));
    expect(c2.filter((x) => x.id.startsWith("exploit"))).toEqual([]);
    const marked = run(data({ log: [flag()], findingFiles: [{ ...ok, originalContent: null }] as never }), doc(exploit([3]), slot("x"), ...goodDoc().content!));
    expect(marked.filter((x) => x.id.startsWith("exploit"))).toEqual([]);
  });
  it("coverage is soft for untested services", () => {
    const svc = { id: "sv1", hostId: "h1", port: 445, protocol: "tcp", nmapService: "smb", nmapVersion: null, confirmedProduct: null, confirmedVersion: null, verdict: null };
    const c = find(run(data({ log: [flag()], services: [svc] as never }), goodDoc()), "coverage")!;
    expect(c).toMatchObject({ id: "coverage:sv1", level: "soft" });
    expect(c.text).toContain("DC01");
  });
  it("gone fails for a deleted or private entry, and operator attempts are never mentioned", () => {
    const priv = entry({ id: "p1", private: true });
    const attempt = { id: "a", hostId: "h1", title: "SECRETOPERATORNOTE", reasonKind: "operator", reason: "SECRETREASON", private: true, logEntryId: "p1" };
    const page = doc(ev("p1"), slot("x"), ev("missing"), slot("x"), ...goodDoc().content!);
    const c = run(data({ log: [priv, flag()], attempts: [attempt] as never }), page);
    expect(c.filter((x) => x.id.startsWith("gone")).map((x) => [x.id, x.level])).toEqual([["gone:p1", "fail"], ["gone:missing", "fail"]]);
    expect(JSON.stringify(c)).not.toMatch(/SECRET/);
  });
  it("gone covers missing findings, files and blank entry ids", () => {
    const page = doc({ type: "vuln", attrs: { findingId: "nf" } }, { type: "exploit", attrs: { fileId: "nx", markedLines: [], appendix: "inline" } }, { type: "evidence", attrs: {} }, slot("x"), ...goodDoc().content!);
    const ids = run(good(), page).filter((c) => c.id.startsWith("gone")).map((c) => [c.id, c.level]);
    expect(ids).toEqual([["gone:node-2", "fail"], ["gone:nf", "fail"], ["gone:nx", "fail"]]);
  });
  it("appendix-ref fails when the moved node has no entry", () => {
    const page = doc({ ...ev("f1", { block: null, appendix: "moved" }) }, slot("x"));
    expect(find(run(good(), page), "appendix-ref")).toMatchObject({ id: "appendix-ref:t1:0", level: "fail" });
    const refs: AppendixIndex = { entries: [{ key: "t1:0", letter: "E", n: 1, title: "", sectionId: "t1" }], refFor: () => "E.1" };
    expect(find(run(good(), page, { appendixRefs: refs }), "appendix-ref")).toBeUndefined();
    expect(find(run(good(), page, { appendixRefs: refs, sectionId: "t2" }), "appendix-ref")?.id).toBe("appendix-ref:t2:0");
  });
  it("move suggestions are soft with the bare key", () => {
    const long = entry({ id: "big", content: { kind: "command", blocks: [{ command: "x", output: Array.from({ length: 100 }, (_, i) => `l${i}`).join("\n") }] } });
    const c = find(run(data({ log: [long, flag()] }), doc(ev("big"), slot("x"), ...goodDoc().content!)), "move")!;
    expect(c).toMatchObject({ id: "move:0", level: "soft" });
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
    expect(one("move:0.3", "This block is long (80 lines of output). Consider moving it to an appendix.")).toBe("Long block (80 lines of output)");
    for (const k of ["proof-missing:h:proof", "proof-shot:h:local", "caption-step:1", "copied-private:1", "copied-deleted:1", "proof-screenshot:h:proof", "proof-web:h:proof", "proof-identity:h:proof", "proof-hostname:h:proof", "proof-path:h:proof", "gone:1", "explain:1", "caption:1", "finding:x:severity", "finding:x:title", "finding:x:affected", "finding:x:description", "finding:x:remediation", "wording:1", "exploit:x:url", "exploit:x:original", "appendix-ref:1", "legible:1"]) {
      expect(one(k, "the full text"), k).not.toBe("the full text");
      expect(one(k).length, k).toBeLessThanOrEqual(38);
      // Single and counted lines end alike: no full stop.
      expect(one(k), k).not.toMatch(/\.$/);
    }
  });
  it("words every kind targetChecks makes when there are two of it", () => {
    const kinds = ["proof-missing", "proof-ip", "proof-screenshot", "proof-web", "proof-identity", "proof-hostname", "proof-path", "proof-shot", "gone", "copied-private", "copied-deleted", "output", "explain", "caption", "caption-weak", "caption-step", "access-shot", "finding:x:severity", "finding:x:title", "finding:x:affected", "finding:x:description", "finding:x:remediation", "wording", "exploit:x:url", "exploit:x:explain", "exploit:x:original", "coverage", "appendix-ref", "move", "legible"];
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
