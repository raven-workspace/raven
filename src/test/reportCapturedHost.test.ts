import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resetAuditState } from "../audit/fakeApi";
import { capturedHost, editsOf, XFER, XFER_CAPTURES, XFER_DOMAIN, XFER_MACHINES, XFER_SCOPE } from "../audit/capturedHost";
import { resolveCapture } from "../features/capture/resolve";
import { EMPTY_DRAFT } from "../features/capture/useCaptureStore";
import { FIXTURES } from "../audit/fixtures";
import { AUDIT_PNGS } from "../audit/images";
import {
  buildPlainTarget,
  entryIdsIn,
  sourceOf,
  groupChecks,
  proofCompanions,
  targetChecks,
  targetCredentials,
  type ReportData,
  type ReportNode,
  type ReportTarget,
} from "../engines/report";
import { saveCapture } from "../features/capture/saveCapture";
import type { LogContent } from "../types/log";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

afterEach(() => resetAuditState());

/** The exam engagement's report data as the audit serves it. */
function examData(): ReportData {
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

const target: ReportTarget = { key: XFER, kind: "standalone", hostIds: [XFER] };
const id = (key: string) => `l-exam-xfer-${key}`;
/** A stored entry's content without what only the store and the moment decide: the attachment id, and a screenshot's
 *  file name, which carries the host's board column at capture time (each save moves the board). */
const shape = (c: LogContent) => ({ ...c, ...("attachmentId" in c ? { attachmentId: "" } : {}), ...("fileName" in c ? { fileName: "" } : {}) });

describe("xfer03, captured through the real pipeline", () => {
  it("is what saving the same pastes stores", async () => {
    const eng = await api.engagementCreate({ name: "Pipeline", kind: "exam-sim", scopeCidrs: ["10.10.30.0/24"], domain: "exam.corp" } as never);
    // At Post-exploitation, as in the fixture: the form offers proof.txt for a bare flag value.
    const host = await api.hostCreate(eng.id, { name: "xfer03", ip: "10.10.30.22", boardColumn: "post-exploitation" } as never);
    const fixture = capturedHost(1_000_000_000, FIXTURES.hosts.filter((h) => h.engagementId === "e-exam"));
    for (const c of XFER_CAPTURES) {
      const hosts = await api.hostsList(eng.id);
      // The capture form as the owner fills it: the paste (a screenshot's text is its caption), the kind and flag
      // kind picked, the host preset when capture was opened from the host's view.
      const image = c.image ? { mime: "image/png", dataBase64: AUDIT_PNGS[c.image as keyof typeof AUDIT_PNGS].base64, objectUrl: "" } : null;
      const r = resolveCapture(
        { ...EMPTY_DRAFT, text: c.image ? "" : c.text, caption: c.image ? c.text : "", image, kind: c.kind ?? null, flagKind: c.flagKind ?? null, observations: c.observations ?? "" },
        { hosts, scope: XFER_SCOPE, domain: XFER_DOMAIN, machines: XFER_MACHINES, lastRanOn: "Kali (VM)", presetHostId: c.preset ? host.id : null },
      );
      const e = editsOf(c, hosts, host.id);
      expect({ ...r.edits, content: shape(r.edits.content) }, c.key).toMatchObject({ kind: e.kind, title: e.title, hostIds: e.hostIds, ranOn: e.ranOn, content: shape(e.content) });
      const { entry } = await saveCapture({
        engagementId: eng.id,
        draft: r.draft,
        edits: r.edits,
        image: image && { mime: image.mime, dataBase64: image.dataBase64 },
        hosts,
        draftInput: r.draftInput,
      });
      const want = fixture.log.find((x) => x.id === id(c.key))!;
      expect({ kind: entry.kind, title: entry.title, ranOn: entry.ranOn, content: shape(entry.content) }, c.key).toEqual({
        kind: want.kind, title: want.title, ranOn: want.ranOn, content: shape(want.content),
      });
      expect(entry.hostIds.map((h) => (h === host.id ? XFER : h)), c.key).toEqual(want.hostIds);
    }

    const creds = await api.credentialsList(eng.id);
    const name = (credId: string) => creds.find((c) => c.id === credId)?.username;
    // The credential was pasted with no host: nothing but the nxc result ties it to xfer03.
    expect(creds.map((c) => [c.username, c.sourceHostId, c.localHostId])).toEqual(
      fixture.credentials.map((c) => [c.username, c.sourceHostId, c.localHostId]),
    );
    const attempts = (await api.credAttemptsList(eng.id)).map((a) => [name(a.credId), a.hostId === host.id, a.service, a.port, a.result, a.authMode]);
    expect(attempts).toEqual(fixture.credAttempts.map((a) => [fixture.credentials.find((c) => c.id === a.credId)?.username, true, a.service, a.port, a.result, a.authMode]));
    expect(attempts).toEqual([["svc_backup", true, "ssh", 22, "valid", "local"]]);
    const tried = (await api.triedPairsList(eng.id)).map((t) => [t.username, t.secret, t.service, t.hostId === host.id]);
    expect(tried).toEqual(fixture.triedPairs.map((t) => [t.username, t.secret, t.service, true]));
    expect((await api.accessGrantsList(eng.id)).length).toBe(0);
    const services = (await api.servicesList(host.id)).map((s) => [s.port, s.nmapService, s.nmapVersion]);
    expect(services).toEqual(fixture.services.map((s) => [s.port, s.nmapService, s.nmapVersion]));
  });
});

describe("xfer03's report page makes no false claim", () => {
  const data = examData();
  const doc = buildPlainTarget(data, target, {});
  const checks = targetChecks({ data, target, doc, meta: {}, sectionId: "t-xfer" });

  it("finds each flag's companions: the screenshot beside it, the command that prints it", () => {
    const flag = (key: string) => data.log.find((e) => e.id === id(key))!;
    expect(proofCompanions(data, XFER, flag("local")).map((e) => e.id)).toEqual([id("local-shot")]);
    expect(proofCompanions(data, XFER, flag("proof")).map((e) => e.id)).toEqual([id("proof-read"), id("proof-shot")]);
  });

  it("shows the companions in the flag steps, once", () => {
    // The entries the page shows, each at its first block (a source's `entry:<id>`, a figure's entry).
    const shown: string[] = [];
    const walk = (n: ReportNode) => {
      const id = n.type === "figure" ? String(n.attrs?.entryId ?? "") : (/^entry:([^:]+)/.exec(sourceOf(n) ?? "")?.[1] ?? "");
      if (id !== "" && !shown.includes(id)) shown.push(id);
      n.content?.forEach(walk);
    };
    walk(doc);
    const after = (key: string, n: number) => shown.slice(shown.indexOf(id(key)), shown.indexOf(id(key)) + n);
    expect(after("local", 2)).toEqual([id("local"), id("local-shot")]);
    expect(after("proof", 3)).toEqual([id("proof"), id("proof-read"), id("proof-shot")]);
    expect(entryIdsIn(doc).has(id("proof-read"))).toBe(true);
  });

  it("raises no proof fail and at most the one screenshot reminder", () => {
    const proof = checks.filter((c) => c.id.startsWith("proof"));
    expect(proof.map((c) => [c.id, c.level, c.text])).toEqual([
      ["proof-shot:xfer03:local", "soft", "Raven can't read screenshots; make sure the local.txt screenshot for xfer03 shows ip a or ifconfig with 10.10.30.22."],
    ]);
    expect(checks.some((c) => c.level === "fail")).toBe(false);
    expect(checks.filter((c) => c.id.startsWith("coverage"))).toEqual([]);
    expect(groupChecks(checks).map((g) => g.text)).toEqual(expect.not.arrayContaining(["local.txt proof has no screenshot", "proof.txt proof has no screenshot"]));
  });

  it("ties the nxc-validated credential to the target, with no source host and no grant", () => {
    const { credentials, access } = targetCredentials(data, [XFER]);
    expect(credentials.map((c) => [c.username, c.type, c.ties])).toEqual([["svc_backup", "password", ["works on SSH, xfer03", "used on xfer03"]]]);
    expect(access).toEqual([]);
  });

  it("tells one finding per phase heading; observations are listed under Additional findings, info last", () => {
    const short = (id: string) => id.replace("f-exam-xfer-", "");
    const told: string[] = [];
    for (const n of doc.content ?? []) {
      const source = sourceOf(n) ?? "";
      const phase = /^phase:[^:]+:([^:]+)(?::(.+))?$/.exec(source);
      if (n.type === "heading" && phase) told.push(`# ${phase[1]}${phase[2] ? `:${short(phase[2])}` : ""}`);
      const finding = /^finding:([^:]+)/.exec(source)?.[1];
      if (finding && told[told.length - 1] !== `V:${short(finding)}`) told.push(`V:${short(finding)}`);
    }
    expect(told).toEqual(["# enum", "# foothold:reuse", "V:reuse", "# privesc:rsync", "V:rsync", "# additional", "V:listing", "V:ssh-passwords"]);
  });
});
