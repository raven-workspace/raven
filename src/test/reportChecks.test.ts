import { describe, expect, it } from "vitest";
import { absoluteClaims, isReady, proofFacts, reportChecks, targetChecks } from "../engines/report";
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
  return { engagement: { id: "eng" }, hosts: [host()], services: [], log: [], checklist: [], findings: [], findingFiles: [], attempts: [], ruledOut: [], grants: [], usernames: [], hops: [], cleanup: [], notes: [], credentials: [], ...o } as unknown as ReportData;
}
function run(d: ReportData, page: ReportNode, extra: Record<string, unknown> = {}, flags: ("local" | "proof")[] = ["proof"]): Check[] {
  return targetChecks({ data: d, target, doc: page, meta: { expectedFlags: { h1: flags } }, appendixRefs: noRefs, ...extra });
}
const find = (cs: Check[], prefix: string) => cs.find((c) => c.id.startsWith(prefix));
const good = () => data({ log: [flag()] });
const goodDoc = () => doc(ev("f1", { block: null }), slot("Proof of root"));

describe("proofFacts", () => {
  it("reads the pasted proof", () => {
    const f = proofFacts(flag(), host());
    expect(f).toEqual({ showsIp: true, showsIdentity: true, showsHostname: true, usualPath: true, hasScreenshot: true });
  });
  it("needs the IP and a command, and a usual path", () => {
    const f = proofFacts(flag({}, { proof: "ipconfig\ncat /tmp/x", attachmentId: null }), host());
    expect(f).toMatchObject({ showsIp: false, usualPath: false, hasScreenshot: false });
    expect(proofFacts(flag({}, { proof: "ip a\n inet 10.0.0.5\nid\ncat /home/bob/local.txt" }), host()))
      .toMatchObject({ showsIp: true, showsIdentity: true, usualPath: true });
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
  it("proof-ip fails with a fix by OS", () => {
    const d = data({ log: [flag({}, { proof: "whoami" })] });
    const c = find(run(d, goodDoc()), "proof-ip")!;
    expect(c).toMatchObject({ id: "proof-ip:DC01", level: "fail" });
    expect(c.text).toContain("10.0.0.5");
    expect(c.fix).toContain("ipconfig");
    const lin = find(run(data({ hosts: [host({ os: "linux" })], log: [flag({}, { proof: "x" })] }), goodDoc()), "proof-ip")!;
    expect(lin.fix).toContain("ip addr");
  });
  it("proof-screenshot fails without an attachment", () => {
    const c = find(run(data({ log: [flag({}, { attachmentId: null })] }), goodDoc()), "proof-screenshot")!;
    expect(c).toMatchObject({ id: "proof-screenshot:DC01", level: "fail" });
    expect(c.text).toContain("DC01");
  });
  it("proof-web fails when the entry before the flag is http", () => {
    const d = data({ log: [entry({ id: "w", kind: "http", at: 4000, content: { kind: "http", request: "GET /" } }), flag()] });
    expect(find(run(d, goodDoc()), "proof-web")).toMatchObject({ id: "proof-web:DC01", level: "fail" });
    const ok = data({ log: [entry({ id: "w", kind: "http", at: 4000, content: { kind: "http", request: "GET /" } }), entry({ id: "c", at: 4500 }), flag()] });
    expect(find(run(ok, goodDoc()), "proof-web")).toBeUndefined();
  });
  it("proof-identity and proof-path are soft", () => {
    const d = data({ log: [flag({}, { proof: "ipconfig\n10.0.0.5\ncat /tmp/proof.txt" })] });
    const c = run(d, goodDoc());
    expect(find(c, "proof-identity")).toMatchObject({ id: "proof-identity:DC01", level: "soft" });
    expect(find(c, "proof-path")).toMatchObject({ id: "proof-path:DC01", level: "soft" });
    expect(isReady(c)).toBe(true);
  });
  it("output fails on blank output unless it returned nothing", () => {
    const blank = (extra = {}) => entry({ id: "c1", content: { kind: "command", blocks: [{ command: "ls", output: "  " }] }, ...extra });
    const page = doc(ev("c1"), slot("x"), ...goodDoc().content!);
    const c = find(run(data({ log: [blank(), flag()] }), page), "output")!;
    expect(c).toMatchObject({ id: "output:c1", level: "fail", text: "A command on the page has no output." });
    expect(find(run(data({ log: [blank({ returnedNothing: true }), flag()] }), page), "output")).toBeUndefined();
  });
  it("explain is soft, screenshots first", () => {
    const shot = entry({ id: "s1", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" } });
    const cmd = entry({ id: "c1" });
    const page = doc(ev("c1"), ev("s1", { block: null }), ...goodDoc().content!);
    const c = run(data({ log: [cmd, shot, flag()] }), page).filter((x) => x.id.startsWith("explain"));
    expect(c.map((x) => [x.id, x.level])).toEqual([["explain:s1", "soft"], ["explain:c1", "soft"]]);
    expect(c[0].text).toBe("A step has no explanation after it.");
    const done = doc(ev("c1"), slot("because"), ...goodDoc().content!);
    expect(find(run(data({ log: [cmd, flag()] }), done), "explain")).toBeUndefined();
  });
  it("access-shot is soft when no screenshot is within 5 minutes", () => {
    const grant = { id: "g", hostId: "h1", level: "admin", at: 10_000_000, via: "x", logEntryId: null };
    const shot = entry({ id: "s1", kind: "screenshot", at: 10_000_000 + 60_000, content: { kind: "screenshot", attachmentId: "a", caption: "ok", fileName: "x" } });
    const far = { ...shot, at: 10_000_000 + 600_000 } as LogEntry;
    const page = doc(ev("s1", { block: null }), slot("x"), ...goodDoc().content!);
    expect(find(run(data({ log: [shot, flag()], grants: [grant] as never }), page), "access-shot")).toBeUndefined();
    const c = find(run(data({ log: [far, flag()], grants: [grant] as never }), page), "access-shot")!;
    expect(c).toMatchObject({ id: "access-shot:DC01:admin", level: "soft" });
    expect(c.text).toContain("DC01");
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
  it("appendix-ref fails when the moved node has no entry", () => {
    const page = doc({ ...ev("f1", { block: null, appendix: "moved" }) }, slot("x"));
    expect(find(run(good(), page), "appendix-ref")).toMatchObject({ id: "appendix-ref:0", level: "fail" });
    const refs: AppendixIndex = { entries: [{ key: "t1:0", letter: "E", n: 1, title: "", sectionId: "t1" }], refFor: () => "E.1" };
    expect(find(run(good(), page, { appendixRefs: refs }), "appendix-ref")).toBeUndefined();
    expect(find(run(good(), page, { appendixRefs: refs, sectionId: "t1" }), "appendix-ref")).toBeUndefined();
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
    expect(reportChecks({ report: report(), targets: [target] })).toEqual([]);
  });
  it("details, osid and no-targets", () => {
    expect(reportChecks({ report: report({ email: " " }), targets: [target] }).map((c) => [c.id, c.level])).toEqual([["details", "fail"]]);
    expect(reportChecks({ report: report({ osid: "123" }), targets: [target] }).map((c) => [c.id, c.level])).toEqual([["osid", "fail"]]);
    expect(reportChecks({ report: report(), targets: [] }).map((c) => c.id)).toEqual(["no-targets"]);
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
