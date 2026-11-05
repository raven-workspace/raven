import { describe, expect, it } from "vitest";
import { buildImportPlan } from "../../../engines/import/plan";
import { listImportable } from "../../../engines/import/list";
import type { OldBackup, OldMachine } from "../../../engines/import/types";
import { commandOutput, image, lab, labBox, logEntry, PNG_B64, screenshot, standalone } from "./fixtures";

const NOW = 1_800_000_000_000;
const bk = (machines: unknown[], over: Record<string, unknown> = {}): OldBackup =>
  ({ version: "3.0.0", machines, ...over }) as OldBackup;
const plan = (b: OldBackup, ids: string[]) => buildImportPlan(b, ids, NOW);

describe("buildImportPlan: engagements", () => {
  it("maps a lab and a standalone with kind, scope and domain; nothing else is selected", () => {
    const p = plan(
      bk([
        lab({ engagementKind: "exam-sim", scope: ["10.10.10.0/24", 7 as never], domain: "corp.local" }),
        labBox(),
        standalone({ id: "custom-solo", name: "Solo", engagementKind: "real" }),
        standalone({ id: "custom-other", name: "Not picked" }),
      ]),
      ["custom-lab-1", "custom-solo", "custom-solo"],
    );
    expect(p.engagements).toEqual([
      {
        id: "custom-lab-1", name: "Lab One", kind: "exam-sim", client: null, subLabel: null,
        scopeCidrs: ["10.10.10.0/24"], domain: "corp.local", startsAt: null, endsAt: null,
        timeboxStart: null, timeboxMinutes: null, status: "active", msfHostId: null,
      },
      {
        id: "custom-solo#e", name: "Solo", kind: "client", client: null, subLabel: null,
        scopeCidrs: [], domain: null, startsAt: null, endsAt: null,
        timeboxStart: null, timeboxMinutes: null, status: "active", msfHostId: null,
      },
    ]);
  });

  it("standalone engagement id differs from its host id", () => {
    const p = plan(bk([standalone({ id: "custom-solo" })]), ["custom-solo"]);
    expect(p.engagements[0].id).toBe("custom-solo#e");
    expect(p.hosts.map((h) => [h.id, h.engagementId])).toEqual([["custom-solo", "custom-solo#e"]]);
  });

  it("unknown, catalog and lab-box ids are never imported", () => {
    const p = plan(bk([lab(), labBox(), { ...standalone({ id: "htb-1", platform: "HTB" }), isCustom: false }]), [
      "custom-lab-1-box-1", "htb-1", "nope",
    ]);
    expect(p.engagements).toEqual([]);
    expect(p.hosts).toEqual([]);
  });
});

describe("buildImportPlan: hosts", () => {
  it("a lab's hosts are its boxes; os, board column, dualHomed and accessReviewedAt are mapped", () => {
    const p = plan(
      bk([
        lab(),
        labBox({ id: "b1", name: "DC01", ip: "10.0.0.1", os: "Windows", status: "backlog", dualHomed: true, accessReviewedAt: "2024-03-01T00:00:00.000Z" }),
        labBox({ id: "b2", os: "BSD", status: "recon", ip: "" }),
        labBox({ id: "b3", os: "Android", status: "foothold" }),
        labBox({ id: "b4", os: "macOS", status: "root" }),
        labBox({ id: "b5", os: "Other", status: "completed", accessReviewedAt: "garbage" }),
        labBox({ id: "b6", os: "Linux", status: "weird" }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.hosts.map((h) => [h.id, h.os, h.boardColumn])).toEqual([
      ["b1", "windows", "enumerate"],
      ["b2", "linux", "enumerate"],
      ["b3", "linux", "foothold"],
      ["b4", "linux", "loot"],
      ["b5", "other", "done"],
      ["b6", "linux", "enumerate"],
    ]);
    expect(p.hosts[0]).toMatchObject({
      engagementId: "custom-lab-1", name: "DC01", ip: "10.0.0.1", boardManual: false, dualHomed: true,
      accessReviewedAt: Date.parse("2024-03-01T00:00:00.000Z"),
    });
    expect(p.hosts[1]).toMatchObject({ ip: null, dualHomed: false, accessReviewedAt: null });
    expect(p.hosts[4].accessReviewedAt).toBeNull();
  });

  it("a standalone is its own single host", () => {
    const p = plan(bk([standalone({ id: "custom-solo", name: "Solo", ip: "10.10.10.9", os: "Windows", status: "root" })]), ["custom-solo"]);
    expect(p.hosts).toEqual([
      expect.objectContaining({ id: "custom-solo", engagementId: "custom-solo#e", name: "Solo", ip: "10.10.10.9", os: "windows", boardColumn: "loot" }),
    ]);
  });
});

describe("buildImportPlan: services", () => {
  it("services rows map to nmap fields; open ports without a row become empty open services", () => {
    const p = plan(
      bk([
        standalone({
          id: "custom-solo",
          services: [
            { port: 22, protocol: "tcp", state: "open", service: "ssh", version: "OpenSSH 8.2" },
            { port: 161, protocol: "udp", state: "open|filtered", service: "snmp" },
            { port: "x", protocol: "tcp" } as never,
            null as never,
          ],
          openPorts: [22, 80, 80, -1 as never, "445" as never],
        }),
      ]),
      ["custom-solo"],
    );
    expect(p.services).toEqual([
      { id: "custom-solo:tcp/22", hostId: "custom-solo", port: 22, protocol: "tcp", state: "open", nmapService: "ssh", nmapVersion: "OpenSSH 8.2" },
      { id: "custom-solo:udp/161", hostId: "custom-solo", port: 161, protocol: "udp", state: "open|filtered", nmapService: "snmp", nmapVersion: null },
      { id: "custom-solo:tcp/80", hostId: "custom-solo", port: 80, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null },
    ]);
    expect(p.skipped.badService).toBe(4);
  });
});

describe("buildImportPlan: log entries", () => {
  it("entries keep ids and fields; kind is command when any block has a command, else note", () => {
    const p = plan(
      bk([
        lab({
          logEntries: [
            logEntry(1000, { id: "e1", title: "nmap b1", ranOn: "kali", observations: "ssh only", hostIds: ["b1", "ghost"] }),
            logEntry(2000, { id: "e2", title: "", blocks: [{ command: "", output: "first" }, { command: " ", output: "second" }] }),
          ] as never,
        }),
        labBox({ id: "b1" }),
      ]),
      ["custom-lab-1"],
    );
    const [e1, e2] = p.logEntries;
    expect(e1).toEqual({
      id: "e1", engagementId: "custom-lab-1", kind: "command", title: "nmap b1", titleEdited: true, ranOn: "kali",
      hostIds: ["b1"], observations: "ssh only", returnedNothing: false, private: false,
      content: { kind: "command", blocks: [{ command: "nmap -sV 10.10.10.5", output: "22/tcp open ssh" }] }, at: 1000,
    });
    expect(e2).toMatchObject({ kind: "note", content: { kind: "note", text: "first\n\nsecond" }, ranOn: null, observations: null, hostIds: [] });
    expect(e2.title.length).toBeGreaterThan(0);
    expect(p.skipped.droppedHostLink).toBe(1);
  });

  it("output-only blocks inside a command entry fold into a neighbour so nothing is lost", () => {
    const p = plan(
      bk([
        standalone({
          id: "custom-solo",
          logEntries: [logEntry(1, { id: "e", blocks: [{ command: "", output: "banner" }, { command: "id", output: "uid=0" }, { command: "", output: "more" }] })] as never,
        }),
      ]),
      ["custom-solo"],
    );
    expect(p.logEntries[0].content).toEqual({ kind: "command", blocks: [{ command: "id", output: "banner\n\nuid=0\n\nmore" }] });
  });

  it("a standalone's own entries with empty hostIds get its one host", () => {
    const p = plan(bk([standalone({ id: "custom-solo", logEntries: [logEntry(5)] as never })]), ["custom-solo"]);
    expect(p.logEntries[0]).toMatchObject({ engagementId: "custom-solo#e", hostIds: ["custom-solo"] });
  });

  it("deleted ids are skipped; malformed entries are skipped and counted; bad times fall back to now", () => {
    const p = plan(
      bk([
        standalone({
          id: "custom-solo",
          deletedLogEntryIds: ["gone"],
          logEntries: [null, 7, { title: "no id" }, logEntry(1, { id: "gone" }), logEntry(2, { id: "iso", at: "2024-01-02T00:00:00.000Z" }), logEntry(3, { id: "bad-at", at: "late" }), logEntry(4, { id: "iso" })] as never,
        }),
      ]),
      ["custom-solo"],
    );
    expect(p.logEntries.map((e) => [e.id, e.at])).toEqual([
      ["iso", Date.parse("2024-01-02T00:00:00.000Z")],
      ["bad-at", NOW],
    ]);
    expect(p.skipped.badLogEntry).toBe(3);
    expect(p.skipped.duplicate).toBe(1);
  });

  it("legacy commandOutputs fold into entries", () => {
    const p = plan(
      bk([
        lab({ deletedLogEntryIds: ["co-dead"], commandOutputs: [commandOutput("co-lab")] }),
        labBox({
          id: "b1",
          updatedAt: "2024-05-01T00:00:00.000Z",
          commandOutputs: [commandOutput("co-1"), commandOutput("co-dead"), { title: "no id", content: 42 }, null],
          rawScanOutput: "PORT STATE\n22/tcp open",
          scanSummary: "Full TCP",
        }),
        labBox({ id: "b2", rawScanOutput: "old", legacyLogsMigrated: true }),
      ]),
      ["custom-lab-1"],
    );
    const byId = Object.fromEntries(p.logEntries.map((e) => [e.id, e]));
    expect(Object.keys(byId).sort()).toEqual(["cmd-import-b1-2", "co-1", "co-lab", "scan-import-b1"]);
    expect(byId["co-lab"]).toMatchObject({ kind: "note", hostIds: [], title: "output co-lab", at: 1600000000000, content: { kind: "note", text: "content of co-lab" } });
    expect(byId["co-1"]).toMatchObject({ hostIds: ["b1"], engagementId: "custom-lab-1" });
    expect(byId["cmd-import-b1-2"]).toMatchObject({ content: { kind: "note", text: "42" }, at: Date.parse("2024-05-01T00:00:00.000Z") });
    expect(byId["scan-import-b1"]).toMatchObject({ title: "Full TCP", hostIds: ["b1"], content: { kind: "note", text: "PORT STATE\n22/tcp open" } });
  });

  it("an id already in the log wins over a legacy output with the same id", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", logEntries: [logEntry(1, { id: "same" })] as never, commandOutputs: [commandOutput("same")] })]),
      ["custom-solo"],
    );
    expect(p.logEntries).toHaveLength(1);
    expect(p.logEntries[0].kind).toBe("command");
  });

  it("entries left on a lab box move into the lab with that box as host", () => {
    const p = plan(bk([lab(), labBox({ id: "b1", logEntries: [logEntry(9, { id: "stray", hostIds: [] })] as never })]), ["custom-lab-1"]);
    expect(p.logEntries).toEqual([expect.objectContaining({ id: "stray", engagementId: "custom-lab-1", hostIds: ["b1"] })]);
  });
});

describe("buildImportPlan: screenshots", () => {
  it("screenshots with a stored image become screenshot entries with the image attached", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", ip: "10.10.10.9", screenshots: [screenshot("s1", "img-1")] })], {
        indexedDb: { images: [image("img-1")] },
      }),
      ["custom-solo"],
    );
    expect(p.logEntries).toEqual([
      {
        id: "custom-solo:shot:s1", engagementId: "custom-solo#e", kind: "screenshot", title: "Shot s1", titleEdited: true,
        ranOn: null, hostIds: ["custom-solo"], observations: null, returnedNothing: false, private: false,
        content: { kind: "screenshot", attachmentId: "", caption: "notes for s1", fileName: expect.stringMatching(/\.png$/) },
        at: 1700000000000, attachment: { mime: "image/png", dataBase64: PNG_B64 },
      },
    ]);
  });

  it("a missing screenshot image is skipped and counted", () => {
    const p = plan(
      bk([lab({ screenshots: [screenshot("s0", "img-0")] }), labBox({ id: "b1", screenshots: [screenshot("s1", "img-x"), screenshot("s2", "img-2"), null] })], {
        indexedDb: { images: [image("img-2", { mime: "bogus", data: "data:image/png;base64," + PNG_B64 }), image("img-0", { mime: "image/jpeg" })] },
      }),
      ["custom-lab-1"],
    );
    expect(p.logEntries.map((e) => [e.id, e.hostIds])).toEqual([
      ["custom-lab-1:shot:s0", []],
      ["b1:shot:s2", ["b1"]],
    ]);
    expect(p.logEntries[1].attachment).toEqual({ mime: "image/png", dataBase64: PNG_B64 });
    expect(p.skipped.missingImage).toBe(1);
    expect(p.skipped.badScreenshot).toBe(1);
  });
});

describe("buildImportPlan: flags", () => {
  it("userFlag is a local flag and rootFlag a proof flag on that host", () => {
    const p = plan(
      bk([lab(), labBox({ id: "b1", name: "Web", userFlag: " abc123 ", userPwnedAt: "2024-04-01T00:00:00.000Z", rootFlag: "def456" })]),
      ["custom-lab-1"],
    );
    expect(p.logEntries).toEqual([
      {
        id: "b1:flag:local", engagementId: "custom-lab-1", kind: "flag", title: "local.txt · Web", titleEdited: true, ranOn: null,
        hostIds: ["b1"], observations: null, returnedNothing: false, private: false,
        content: { kind: "flag", flagKind: "local", value: "abc123", attachmentId: null, proof: null },
        at: Date.parse("2024-04-01T00:00:00.000Z"),
      },
      expect.objectContaining({ id: "b1:flag:proof", title: "proof.txt · Web", at: NOW, content: expect.objectContaining({ flagKind: "proof", value: "def456" }) }),
    ]);
  });
});

describe("buildImportPlan: notes", () => {
  it("quickNotes \"? \" lines are escaped so they are not threads", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", quickNotes: "plain\n? was a question\n  ? indented\n```\n? in code\n```\n?no space" })]),
      ["custom-solo"],
    );
    expect(p.notes).toEqual([
      {
        ownerId: "custom-solo", engagementId: "custom-solo#e", hostId: "custom-solo", private: false,
        body: "plain\n\\? was a question\n  \\? indented\n```\n? in code\n```\n?no space",
      },
    ]);
  });

  it("nextMove becomes one open thread", () => {
    const p = plan(
      bk([
        lab({ nextMove: "\n  pivot via\n? web01\n  later  \n", quickNotes: "lab notes", os: "" }),
        labBox({ id: "b1", nextMove: "try kerberoast", quickNotes: "box notes" }),
        labBox({ id: "b2", nextMove: "   " }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.notes).toEqual([
      { ownerId: "custom-lab-1", engagementId: "custom-lab-1", hostId: null, private: false, body: "lab notes\n\n? pivot via\n\\? web01\n  later" },
      { ownerId: "b1", engagementId: "custom-lab-1", hostId: "b1", private: false, body: "box notes\n\n? try kerberoast" },
    ]);
  });

  it("portTriage notes are appended to the host's notes under Port triage", () => {
    const p = plan(
      bk([
        standalone({
          id: "custom-solo",
          quickNotes: "n",
          portTriage: { "445": { status: "dead_end", note: "null session denied" }, "80": { status: "key_vector" }, x: 5 } as never,
        }),
      ]),
      ["custom-solo"],
    );
    expect(p.notes[0].body).toBe("n\n\n## Port triage\n- 80: key_vector\n- 445: dead_end — null session denied");
    expect(p.skipped.badPortTriage).toBe(1);
  });
});

describe("buildImportPlan: robustness", () => {
  it("never throws on malformed machines and fields", () => {
    const weird = {
      ...standalone({ id: "custom-w" }),
      name: 5, ip: null, os: null, status: null, scope: "10.0.0.0/8", domain: 3, services: "x", openPorts: { a: 1 },
      logEntries: "x", screenshots: 4, quickNotes: 9, nextMove: [], portTriage: [], commandOutputs: "x", rawScanOutput: 3,
      userFlag: 1, rootFlag: "", accessReviewedAt: 1, dualHomed: "yes",
    };
    const b = bk([null, 3, weird] as never, { indexedDb: { images: "nope" } });
    const p = buildImportPlan(b, ["custom-w"], NOW);
    expect(p.engagements).toEqual([expect.objectContaining({ id: "custom-w#e", name: "custom-w", scopeCidrs: [], domain: null })]);
    expect(p.hosts).toEqual([expect.objectContaining({ id: "custom-w", name: "custom-w", ip: null, os: null, dualHomed: false, accessReviewedAt: 1 })]);
    expect(p.services).toEqual([]);
    expect(p.logEntries).toEqual([]);
    expect(p.notes).toEqual([]);
    expect(() => buildImportPlan({ version: "3.0.0" } as never, ["x"], NOW)).not.toThrow();
  });
});

describe("listImportable counts folded legacy logs", () => {
  it("logCount and dates include commandOutputs, rawScanOutput and stray box entries", () => {
    const machines: OldMachine[] = [
      lab({ logEntries: [logEntry(2000)] as never, commandOutputs: [commandOutput("co", { createdAt: 500 })] }),
      labBox({ id: "b1", rawScanOutput: "scan", updatedAt: "1970-01-01T00:00:05.000Z", logEntries: [logEntry(9000, { id: "stray" })] as never }),
      standalone({ id: "custom-solo", commandOutputs: [commandOutput("a"), commandOutput("b")], deletedLogEntryIds: ["b"] }),
    ];
    const list = listImportable(bk(machines));
    expect(list[0]).toMatchObject({ id: "custom-lab-1", logCount: 4, firstAt: 500, lastAt: 9000 });
    expect(list[1]).toMatchObject({ id: "custom-solo", logCount: 1 });
  });
});

describe("fix round 1: nothing user-entered is silently dropped", () => {
  it("a box's differing domain, vhosts and extraIps go into host note sections", () => {
    const p = plan(
      bk([
        lab({ domain: "corp.local", os: "" }),
        labBox({ id: "b1", domain: "dev.corp.local", vhosts: ["app.corp.local", 3 as never], extraIps: ["172.16.1.5", ""] }),
        labBox({ id: "b2", domain: "corp.local" }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.notes).toEqual([
      {
        ownerId: "b1", engagementId: "custom-lab-1", hostId: "b1", private: false,
        body: "## Domain / vhosts\n- domain: dev.corp.local\n- vhost: app.corp.local\n\n## Extra IPs\n- 172.16.1.5",
      },
    ]);
  });

  it("a lab container's own ip, os, services, open ports and port triage go into the engagement note", () => {
    const p = plan(
      bk([
        lab({
          ip: "10.0.0.254",
          os: "Linux",
          services: [{ port: 443, protocol: "tcp", state: "open", service: "https", version: "nginx", cveNotes: "CVE-2021-1" }],
          openPorts: [443, 8080],
          portTriage: { "8080": { status: "checking", note: "admin panel" } } as never,
        }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.services).toEqual([]);
    expect(p.notes).toEqual([
      {
        ownerId: "custom-lab-1", engagementId: "custom-lab-1", hostId: null, private: false,
        body:
          "## Lab container\n- ip: 10.0.0.254\n- os: Linux\n\n## Services\n- 443/tcp open https nginx\n- 8080/tcp open\n\n" +
          "## Port triage\n- 443: CVE: CVE-2021-1\n- 8080: checking — admin panel",
      },
    ]);
  });

  it("a service's cveNotes join its port's triage line", () => {
    const p = plan(
      bk([
        standalone({
          id: "custom-solo",
          services: [{ port: 445, protocol: "TCP" as never, state: "open", service: "microsoft-ds", cveNotes: "MS17-010\nlikely" }],
          portTriage: { "445": { status: "key_vector", note: "smb v1" } } as never,
        }),
      ]),
      ["custom-solo"],
    );
    expect(p.services.map((s) => s.id)).toEqual(["custom-solo:tcp/445"]);
    expect(p.notes[0].body).toBe("## Port triage\n- 445: key_vector — smb v1 — CVE: MS17-010 likely");
  });

  it("msfHostId is mapped when it names an imported host; dangling is null and counted", () => {
    const ok = plan(bk([lab({ msfHostId: "b1" }), labBox({ id: "b1" })]), ["custom-lab-1"]);
    expect(ok.engagements[0].msfHostId).toBe("b1");
    const solo = plan(bk([standalone({ id: "custom-solo", msfHostId: "custom-solo" })]), ["custom-solo"]);
    expect(solo.engagements[0].msfHostId).toBe("custom-solo");
    const bad = plan(bk([lab({ msfHostId: "gone", dcHostId: "b1" }), labBox({ id: "b1" })]), ["custom-lab-1"]);
    expect(bad.engagements[0].msfHostId).toBeNull();
    expect(bad.skipped.msfHostMissing).toBe(1);
  });

  it("redacted flags are skipped and counted, so a later real import can add them", () => {
    const one = plan(bk([standalone({ id: "custom-solo", userFlag: "[REDACTED]", rootFlag: "real" })]), ["custom-solo"]);
    expect(one.logEntries.map((e) => e.id)).toEqual(["custom-solo:flag:proof"]);
    expect(one.skipped.redactedFlag).toBe(1);
    const all = plan(bk([standalone({ id: "custom-solo", userFlag: "u", rootFlag: "r" })], { isRedacted: true }), ["custom-solo"]);
    expect(all.logEntries).toEqual([]);
    expect(all.skipped.redactedFlag).toBe(2);
  });

  it("image base64 with embedded whitespace is stripped clean", () => {
    const wrapped = PNG_B64.slice(0, 20) + "\n" + PNG_B64.slice(20, 40) + "\r\n \t" + PNG_B64.slice(40);
    const p = plan(
      bk([standalone({ id: "custom-solo", screenshots: [screenshot("s1", "img-1")] })], { indexedDb: { images: [image("img-1", { data: ` ${wrapped}\n` })] } }),
      ["custom-solo"],
    );
    expect(p.logEntries[0].attachment).toEqual({ mime: "image/png", dataBase64: PNG_B64 });
  });

  it("a title past 300 characters keeps its full text in observations", () => {
    const long = "x".repeat(350);
    const p = plan(
      bk([standalone({ id: "custom-solo", logEntries: [logEntry(1, { title: long, observations: "obs" })] as never })]),
      ["custom-solo"],
    );
    expect(p.logEntries[0].title).toBe("x".repeat(300));
    expect(p.logEntries[0].observations).toBe(`Full title: ${long}\n\nobs`);
  });

  it("credIds on log entries are counted as dropped links", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", logEntries: [logEntry(1, { id: "a", credIds: ["cred_1"] }), logEntry(2, { id: "b" })] as never })]),
      ["custom-solo"],
    );
    expect(p.logEntries).toHaveLength(2);
    expect(p.skipped.credLinkDropped).toBe(1);
  });
});

// ---------------------------------------------------------------- Task 5: checklist, network, findings, loot

const ISO = "2024-02-01T10:00:00.000Z";
const ISO_MS = Date.parse(ISO);
const cred = (over: Record<string, unknown> = {}) => ({
  id: "cred_1", type: "password", username: "alice", secret: "Summer2024!", createdAt: ISO, engagementId: "custom-lab-1", ...over,
});
const attempt = (over: Record<string, unknown> = {}) => ({
  id: "att_1", credId: "cred_1", machineId: "b1", service: "smb", result: "valid", at: ISO, authMode: "domain", ...over,
});
/** A lab with two boxes (b1, b2) plus a standalone (custom-solo), all selected. */
const lootBackup = (over: Record<string, unknown> = {}, labOver: Partial<OldMachine> = {}) =>
  bk(
    [lab(labOver), labBox({ id: "b1", name: "DC01" }), labBox({ id: "b2", name: "WS01" }), standalone({ id: "custom-solo" }), standalone({ id: "custom-unpicked" })],
    over,
  );
const lootPlan = (over: Record<string, unknown> = {}, labOver: Partial<OldMachine> = {}) =>
  plan(lootBackup(over, labOver), ["custom-lab-1", "custom-solo"]);

describe("buildImportPlan: checklist", () => {
  it("lab container goals go to the engagement, box goals to the box", () => {
    const p = plan(
      bk([
        lab({ checklist: { openPorts: [], activeItemId: null, itemsState: {
          "e-setup-scope": { status: "done", completedAt: ISO, notes: "scope set" },
          "cred-routine-smb": { status: "in_progress" },
        } } }),
        labBox({ id: "b1", checklist: { openPorts: [], activeItemId: null, itemsState: {
          "h-enum-full-tcp": { status: "done", auto: true, autoFrom: "in_progress" },
        } } }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.checklist).toEqual([
      { engagementId: "custom-lab-1", ownerId: "custom-lab-1", goalId: "e-setup-scope", status: "done", notes: "scope set", completedAt: ISO_MS, auto: false, autoFrom: null, evidence: [] },
      { engagementId: "custom-lab-1", ownerId: "custom-lab-1", goalId: "cred-routine-smb", status: "in_progress", notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [] },
      { engagementId: "custom-lab-1", ownerId: "b1", goalId: "h-enum-full-tcp", status: "done", notes: null, completedAt: null, auto: true, autoFrom: "in_progress", evidence: [] },
    ]);
  });

  it("a standalone's mixed itemsState routes e-* and cred-routine-* to the engagement, the rest to the host", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", checklist: { openPorts: [], activeItemId: null, itemsState: {
        "h-enum-udp": { status: "na" },
        "e-ad-nocreds-rid": { status: "done" },
        "cred-routine-winrm": { status: "todo" },
      } } })]),
      ["custom-solo"],
    );
    expect(p.checklist.map((c) => [c.ownerId, c.goalId, c.engagementId])).toEqual([
      ["custom-solo", "h-enum-udp", "custom-solo#e"],
      ["custom-solo#e", "e-ad-nocreds-rid", "custom-solo#e"],
      ["custom-solo#e", "cred-routine-winrm", "custom-solo#e"],
    ]);
  });

  it("unknown goal ids are skipped and counted", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", checklist: { openPorts: [], activeItemId: null, itemsState: {
        "p01-nmap-full": { status: "done" },
        "h-not-a-goal": { status: "done" },
        "h-enum-udp": { status: "bogus" },
        "h-enum-versions": "junk",
        "h-enum-full-tcp": { status: "done", autoFrom: "weird" },
      } } })]),
      ["custom-solo"],
    );
    expect(p.checklist.map((c) => [c.goalId, c.autoFrom])).toEqual([["h-enum-full-tcp", null]]);
    expect(p.skipped.unknownGoal).toBe(2);
    expect(p.skipped.badChecklistItem).toBe(2);
  });

  it("evidence keeps only imported entries", () => {
    const p = plan(
      bk([standalone({
        id: "custom-solo",
        logEntries: [logEntry(1, { id: "log-a" })] as never,
        checklist: { openPorts: [], activeItemId: null, itemsState: {
          "h-enum-full-tcp": { status: "done", evidence: [
            { containerId: "custom-solo", entryId: "log-a", commandId: "nmap-full" },
            { containerId: "custom-solo", entryId: "log-gone" },
            "junk",
          ] },
        } },
      })]),
      ["custom-solo"],
    );
    expect(p.checklist[0].evidence).toEqual([{ entryId: "log-a", commandId: "nmap-full" }]);
    expect(p.skipped.droppedEvidence).toBe(2);
  });

  it("a lab container's host goals have no host owner and are counted", () => {
    const p = plan(bk([lab({ checklist: { openPorts: [], activeItemId: null, itemsState: { "h-enum-udp": { status: "done" } } } })]), ["custom-lab-1"]);
    expect(p.checklist).toEqual([]);
    expect(p.skipped.checklistNoOwner).toBe(1);
  });
});

describe("buildImportPlan: hops and tunnels", () => {
  it("hops and tunnels map from the container, skipping deleted ids", () => {
    const p = plan(
      bk([
        lab({
          hops: [
            { id: "hop-1", toHostId: "b1", via: "evil-winrm", logEntryId: "log-1", at: ISO, updatedAt: ISO },
            { id: "hop-2", fromHostId: "b1", toHostId: "b2", via: "psexec", credId: "cred_1", at: ISO, updatedAt: ISO },
            { id: "hop-del", toHostId: "b1", via: "x", at: ISO, updatedAt: ISO },
          ],
          deletedHopIds: ["hop-del"],
          tunnels: [
            { id: "tun-1", kind: "ligolo", viaHostId: "b1", subnets: ["172.16.1.0/24"], callbackIp: "10.10.14.2", status: "up", notes: "n", createdAt: ISO, updatedAt: ISO },
            { id: "tun-del", kind: "ssh", viaHostId: "b1", subnets: [], callbackIp: "", status: "down", createdAt: ISO, updatedAt: ISO },
          ],
          deletedTunnelIds: ["tun-del"],
          logEntries: [logEntry(1, { id: "log-1" })] as never,
        }),
        labBox({ id: "b1" }),
        labBox({ id: "b2" }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.hops).toEqual([
      { id: "hop-1", engagementId: "custom-lab-1", fromHostId: null, toHostId: "b1", via: "evil-winrm", logEntryId: "log-1", at: ISO_MS, updatedAt: ISO_MS },
      { id: "hop-2", engagementId: "custom-lab-1", fromHostId: "b1", toHostId: "b2", via: "psexec", logEntryId: null, at: ISO_MS, updatedAt: ISO_MS },
    ]);
    expect(p.skipped.hopCredLinkDropped).toBe(1);
    expect(p.tunnels).toEqual([
      { id: "tun-1", engagementId: "custom-lab-1", kind: "ligolo", viaHostId: "b1", subnets: ["172.16.1.0/24"], callbackIp: "10.10.14.2", status: "up", notes: "n", createdAt: ISO_MS, updatedAt: ISO_MS },
    ]);
  });

  it("a hop to a non-imported host is skipped", () => {
    const p = plan(
      bk([
        lab({ hops: [
          { id: "hop-1", toHostId: "elsewhere", via: "ssh", at: ISO, updatedAt: ISO },
          { id: "hop-2", fromHostId: "elsewhere", toHostId: "b1", via: "ssh", at: ISO, updatedAt: ISO },
          { id: "hop-3", fromHostId: "b1", toHostId: "b1", via: "ssh", at: ISO, updatedAt: ISO },
          "junk",
        ], tunnels: [{ id: "tun-1", kind: "chisel", viaHostId: "nope", subnets: [], callbackIp: "", status: "up", createdAt: ISO, updatedAt: ISO }] }),
        labBox({ id: "b1" }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.hops).toEqual([]);
    expect(p.tunnels).toEqual([]);
    expect(p.skipped.hopHostMissing).toBe(2);
    expect(p.skipped.badHop).toBe(2);
    expect(p.skipped.tunnelHostMissing).toBe(1);
  });

  it("invalid tunnel subnets and callback ip are kept in the notes, not lost", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", tunnels: [
        { id: "t", kind: "weird", viaHostId: "custom-solo", subnets: ["10.0.0.0/8", "corp net"], callbackIp: "tun0", status: "up", createdAt: ISO, updatedAt: ISO },
      ] })]),
      ["custom-solo"],
    );
    expect(p.tunnels[0]).toMatchObject({ kind: "other", subnets: ["10.0.0.0/8"], callbackIp: "", notes: "Subnets as entered: corp net\nCallback as entered: tun0" });
  });
});

describe("buildImportPlan: findings", () => {
  it("a LabFinding maps to a draft finding", () => {
    const p = plan(
      bk([
        lab({ findings: [{ id: "f-lab", title: "Weak policy", severity: "low", createdAt: 5, updatedAt: 6 }] as never }),
        labBox({ id: "b1", findings: [{
          id: "f-1", title: "SQLi in login", severity: "critical", cvssScore: 9.8, cweCve: "CWE-89, CVE-2024-0001",
          affectedService: "http/80", repro: "1. ' or 1=1--", remediation: "Use prepared statements", createdAt: 1000, updatedAt: 2000,
        }] as never }),
      ]),
      ["custom-lab-1"],
    );
    expect(p.findings).toEqual([
      {
        id: "f-lab", engagementId: "custom-lab-1", title: "Weak policy", severity: "low", cvssVector: null, cvssScore: null, status: "draft",
        description: "", impact: "", remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [],
        createdAt: 5, updatedAt: 6,
      },
      {
        id: "f-1", engagementId: "custom-lab-1", title: "SQLi in login", severity: "critical", cvssVector: null, cvssScore: 9.8, status: "draft",
        description: "Affected: http/80\n\n1. ' or 1=1--", impact: "", remediation: "Use prepared statements", exploitNotes: "", lessons: "",
        refs: ["CWE-89", "CVE-2024-0001"], hostIds: ["b1"], serviceIds: [], stepEntryIds: [], createdAt: 1000, updatedAt: 2000,
      },
    ]);
  });

  it("bad severity and score become null; a blank title gets a fallback; junk is counted", () => {
    const p = plan(
      bk([standalone({ id: "custom-solo", findings: [{ id: "f", title: " ", severity: "urgent", cvssScore: 42, createdAt: "x", updatedAt: null }, "junk"] as never })]),
      ["custom-solo"],
    );
    expect(p.findings[0]).toMatchObject({ title: "Imported finding", severity: null, cvssScore: null, hostIds: ["custom-solo"], createdAt: NOW, updatedAt: NOW });
    expect(p.skipped.badFinding).toBe(1);
  });
});

describe("buildImportPlan: credentials", () => {
  it("credentials map to the selected engagement by engagementId or source host; others are not selected", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c-lab", domain: "corp.local", sourceMachineId: "b1", notes: "from SAM", source: "secretsdump" }),
        cred({ id: "c-solo", engagementId: "custom-solo", secret: "s2" }),
        cred({ id: "c-src", engagementId: undefined, sourceMachineId: "b2", secret: "s3" }),
        cred({ id: "c-other", engagementId: "custom-unpicked", secret: "s4" }),
      ],
    });
    expect(p.credentials.map((c) => [c.id, c.engagementId])).toEqual([
      ["c-lab", "custom-lab-1"], ["c-solo", "custom-solo#e"], ["c-src", "custom-lab-1"],
    ]);
    expect(p.credentials[0]).toEqual({
      id: "c-lab", engagementId: "custom-lab-1", type: "password", username: "alice", domain: "corp.local", secret: "Summer2024!",
      hashType: null, scope: "domain", localHostId: null, sourceHostId: "b1", source: "secretsdump", notes: "from SAM",
      crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: ISO_MS, updatedAt: ISO_MS,
    });
  });

  it("a redacted credential is skipped and counted", () => {
    const p = lootPlan({
      credentials: [cred({ id: "c1", redacted: true }), cred({ id: "c2", secret: " [REDACTED] " }), cred({ id: "c3", username: "zed", secret: "real" })],
      credAttempts: [attempt({ id: "a1", credId: "c1" })],
    });
    expect(p.credentials.map((c) => c.id)).toEqual(["c3"]);
    expect(p.skipped.redactedCredential).toBe(2);
    expect(p.credAttempts).toEqual([]);
    expect(p.skipped.attemptCredMissing).toBe(1);
  });

  it("password secrets keep spaces and lose only edge line breaks; hashes are trimmed and typed", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c1", secret: "\n  pass word  \r\n" }),
        cred({ id: "c2", type: "hash", username: "bob", secret: "  aad3b435b51404eeaad3b435b51404ee \n" }),
        cred({ id: "c3", type: "hash", username: "carol", secret: "x", hashType: "Custom", crackStatus: "cracked" }),
        cred({ id: "c4", type: "wat", username: "drew", secret: "k" }),
      ],
    });
    expect(p.credentials.map((c) => [c.secret, c.hashType, c.crackStatus, c.type])).toEqual([
      ["  pass word  ", null, null, "password"],
      ["aad3b435b51404eeaad3b435b51404ee", "NTLM", "uncracked", "hash"],
      ["x", "Custom", "cracked", "hash"],
      ["k", null, null, "other"],
    ]);
  });

  it("a local credential keeps its imported host; a missing one is skipped and counted", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c1", scope: "local", localHostId: "b1" }),
        cred({ id: "c2", scope: "local", localHostId: "custom-unpicked", secret: "x" }),
        cred({ id: "c3", scope: "local", secret: "y" }),
        cred({ id: "c4", scope: "domain", localHostId: "b1", secret: "z" }),
      ],
    });
    expect(p.credentials.map((c) => [c.id, c.scope, c.localHostId])).toEqual([["c1", "local", "b1"], ["c4", "domain", null]]);
    expect(p.skipped.credLocalHostMissing).toBe(2);
  });

  it("duplicates by credKey keep the first and move their attempts onto it", () => {
    const p = lootPlan({
      credentials: [cred({ id: "c1" }), cred({ id: "c2", username: "ALICE" }), cred({ id: "c3", engagementId: "custom-solo" })],
      credAttempts: [attempt({ id: "a1", credId: "c2", machineId: "b1", result: "admin" })],
    });
    expect(p.credentials.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(p.skipped.credDuplicate).toBe(1);
    expect(p.credAttempts.map((a) => [a.id, a.credId, a.result])).toEqual([["a1", "c1", "admin"]]);
  });

  it("crackedFrom and fromSecretId follow imported credentials only; links come before their users", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c-plain", secret: "Pass1", crackedFrom: "c-hash", fromSecretId: "c-gone" }),
        cred({ id: "c-hash", type: "hash", secret: "31d6cfe0d16ae931b73c59d7e0c089c0" }),
      ],
    });
    expect(p.credentials.map((c) => [c.id, c.crackedFrom, c.fromSecretId])).toEqual([["c-hash", null, null], ["c-plain", "c-hash", null]]);
    expect(p.skipped.droppedCredLink).toBe(1);
  });
  it("a link cycle is broken rather than stored", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c1", secret: "a", crackedFrom: "c2" }),
        cred({ id: "c2", secret: "b", fromSecretId: "c1", verifications: "junk" }),
        cred({ id: "c3", secret: "c", crackedFrom: "c3" }),
      ],
    });
    expect(p.credentials.map((c) => [c.id, c.crackedFrom, c.fromSecretId])).toEqual([["c2", null, null], ["c1", "c2", null], ["c3", null, null]]);
    expect(p.skipped.droppedCredLink).toBe(2);
  });
});

describe("buildImportPlan: attempts", () => {
  it("attempts map machineId to hostId and keep their fields", () => {
    const p = lootPlan({
      credentials: [cred()],
      credAttempts: [attempt({ port: 445, detail: " Pwn3d! ", logEntryId: "log-1", logContainerId: "custom-lab-1" })],
    }, { logEntries: [logEntry(1, { id: "log-1" })] as never });
    expect(p.credAttempts).toEqual([{
      id: "att_1", engagementId: "custom-lab-1", credId: "cred_1", usernameId: null, hostId: "b1", service: "smb", port: 445,
      result: "valid", authMode: "domain", detail: "Pwn3d!", logEntryId: "log-1", at: ISO_MS,
    }]);
  });

  it("tried/invalid results are migrated", () => {
    const p = lootPlan({
      credentials: [cred()],
      credAttempts: [
        attempt({ id: "a1", result: "tried", service: "winrm" }),
        attempt({ id: "a2", result: "invalid", service: "ssh" }),
        attempt({ id: "a3", result: "nonsense", service: "rdp" }),
      ],
    });
    expect(p.credAttempts.map((a) => [a.id, a.result])).toEqual([["a1", "errored"], ["a2", "failed"]]);
    expect(p.skipped.badAttempt).toBe(1);
  });

  it("a missing authMode follows the scope", () => {
    const p = lootPlan({
      credentials: [cred({ id: "c-loc", scope: "local", localHostId: "b1" }), cred({ id: "c-dom", secret: "other" })],
      credAttempts: [attempt({ id: "a1", credId: "c-loc", authMode: undefined }), attempt({ id: "a2", credId: "c-dom", authMode: "junk" })],
    });
    expect(p.credAttempts.map((a) => [a.id, a.authMode])).toEqual([["a1", "local"], ["a2", "domain"]]);
  });

  it("legacy verifications become attempts", () => {
    const p = lootPlan({
      credentials: [cred({ verifications: {
        b1: { status: "admin", protocol: "winrm", updatedAt: "2024-03-01T00:00:00.000Z" },
        b2: { status: "user" },
        "custom-unpicked": { status: "failed" },
        "custom-solo": { status: "untested" },
      } })],
    });
    expect(p.credAttempts).toEqual([
      { id: "cred_1:verification:b1", engagementId: "custom-lab-1", credId: "cred_1", usernameId: null, hostId: "b1", service: "winrm", port: null,
        result: "admin", authMode: "domain", detail: null, logEntryId: null, at: Date.parse("2024-03-01T00:00:00.000Z") },
      { id: "cred_1:verification:b2", engagementId: "custom-lab-1", credId: "cred_1", usernameId: null, hostId: "b2", service: "smb", port: null,
        result: "valid", authMode: "domain", detail: null, logEntryId: null, at: ISO_MS },
    ]);
    expect(p.skipped.attemptHostMissing).toBe(1);
  });

  it("attempts on a non-imported host or another engagement's host are skipped; same key keeps the stronger result", () => {
    const p = lootPlan({
      credentials: [cred()],
      credAttempts: [
        attempt({ id: "a1", machineId: "custom-unpicked" }),
        attempt({ id: "a2", machineId: "custom-solo" }),
        attempt({ id: "a3", result: "errored", at: "2024-05-01T00:00:00.000Z" }),
        attempt({ id: "a4", result: "admin", at: "2024-04-01T00:00:00.000Z", port: 0 }),
      ],
    });
    expect(p.credAttempts.map((a) => [a.id, a.result, a.port])).toEqual([["a3", "admin", null]]);
    expect(p.skipped.attemptHostMissing).toBe(2);
  });
});

describe("buildImportPlan: usernames and access", () => {
  it("usernames come with their access grants, respecting deletedAccessIds", () => {
    const p = lootPlan({
      usernames: [{
        id: "user_1", username: " svc_sql ", domain: "corp.local", createdAt: ISO, engagementId: "custom-lab-1", sourceMachineId: "b1", source: "kerbrute",
        access: [
          { id: "g1", hostId: "b2", level: "admin", via: "winrm", at: ISO, logEntryId: "gone" },
          { id: "g2", hostId: "b1", level: "user", via: "ssh", at: ISO },
          { id: "g3", hostId: "custom-unpicked", level: "user", via: "ssh", at: ISO },
          { id: "g4", hostId: "b1", level: "god", via: "x", at: ISO },
        ],
        deletedAccessIds: ["g2"],
      }],
    });
    expect(p.usernames).toEqual([
      { id: "user_1", engagementId: "custom-lab-1", username: "svc_sql", domain: "corp.local", sourceHostId: "b1", source: "kerbrute", createdAt: ISO_MS },
    ]);
    expect(p.accessGrants).toEqual([
      { id: "g1", engagementId: "custom-lab-1", usernameId: "user_1", hostId: "b2", level: "admin", via: "winrm", logEntryId: null, at: ISO_MS },
    ]);
    expect(p.skipped.grantHostMissing).toBe(1);
    expect(p.skipped.badGrant).toBe(1);
  });

  it("a duplicate username merges into the first, grants and attempts included", () => {
    const p = lootPlan({
      credentials: [cred()],
      usernames: [
        { id: "u1", username: "bob", createdAt: ISO, engagementId: "custom-lab-1" },
        { id: "u2", username: "BOB", createdAt: ISO, engagementId: "custom-lab-1", access: [{ id: "g1", hostId: "b1", level: "user", via: "rdp", at: ISO }] },
        { id: "u3", username: "  ", createdAt: ISO, engagementId: "custom-lab-1" },
      ],
      credAttempts: [attempt({ usernameId: "u2" }), attempt({ id: "a2", usernameId: "u-gone", service: "ssh" })],
    });
    expect(p.usernames.map((u) => u.id)).toEqual(["u1"]);
    expect(p.accessGrants.map((g) => [g.id, g.usernameId])).toEqual([["g1", "u1"]]);
    expect(p.credAttempts.map((a) => [a.id, a.usernameId])).toEqual([["att_1", "u1"]]);
    expect(p.skipped.usernameDuplicate).toBe(1);
    expect(p.skipped.badUsername).toBe(1);
    expect(p.skipped.attemptUsernameMissing).toBe(1);
  });

  it("never throws on malformed loot", () => {
    const junk = [null, 7, "x", [], {}, { id: 5 }, { username: 3, secret: {} }];
    expect(() => lootPlan({ credentials: junk, credAttempts: junk, usernames: [...junk, { id: "u", username: "a", access: "nope" }] })).not.toThrow();
    expect(() => lootPlan({ credentials: "nope", credAttempts: {}, usernames: 4 })).not.toThrow();
  });
});

describe("Task 5 fix round 1: rulings", () => {
  it("T5-R1: a blank hop or grant via imports as (not recorded)", () => {
    const p = lootPlan(
      { usernames: [{ id: "u1", username: "bob", createdAt: ISO, engagementId: "custom-lab-1", access: [{ id: "g1", hostId: "b1", level: "user", via: "  ", at: ISO }] }] },
      { hops: [{ id: "hop-1", toHostId: "b1", via: "", at: ISO, updatedAt: ISO }] },
    );
    expect(p.hops[0].via).toBe("(not recorded)");
    expect(p.accessGrants[0].via).toBe("(not recorded)");
  });

  it("T5-R2: loot with no engagementId and no sourceMachineId is counted as unassigned", () => {
    const p = lootPlan({
      credentials: [cred({ engagementId: undefined }), cred({ id: "c2", engagementId: " ", secret: "x" })],
      usernames: [{ id: "u1", username: "bob", createdAt: ISO }],
    });
    expect(p.credentials).toEqual([]);
    expect(p.usernames).toEqual([]);
    expect(p.skipped.credUnassigned).toBe(2);
    expect(p.skipped.usernameUnassigned).toBe(1);
  });

  it("T5-R3: invalid scope entries are dropped and counted", () => {
    const p = plan(bk([standalone({ id: "custom-solo", scope: ["10.10.10.0/24", "10.1.2.3", "corp.local", "10.0.0.0/33", 7 as never, " "] })]), ["custom-solo"]);
    expect(p.engagements[0].scopeCidrs).toEqual(["10.10.10.0/24", "10.1.2.3"]);
    expect(p.skipped.scopeInvalid).toBe(3);
  });

  it("T5-R4: loot items on an imported host go into its note under ## Loot", () => {
    const machines = [lab(), labBox({ id: "b1", userFlag: " flag-user-123 " }), standalone({ id: "custom-unpicked" })];
    const p = plan(bk(machines, {
      lootItems: [
        { id: "l1", category: "file", title: "web.config", value: "connStr=abc", notes: "from IIS", createdAt: ISO, machineId: "b1" },
        { id: "l2", category: "flag", title: "user", value: "flag-user-123", createdAt: ISO, machineId: "b1" },
        { id: "l3", category: "flag", title: "other", value: "flag-other", createdAt: ISO, machineId: "b1" },
        { id: "l4", category: "note", title: "secret", value: "[REDACTED]", createdAt: ISO, machineId: "b1" },
        { id: "l5", category: "weird", title: "multi", value: "line one\n? not a thread", createdAt: ISO, machineId: "b1" },
        { id: "l6", category: "note", title: "lab level", value: "v", createdAt: ISO, machineId: "custom-lab-1" },
        { id: "l7", category: "note", title: "nowhere", value: "v", createdAt: ISO },
        { id: "l8", category: "note", title: "unpicked", value: "v", createdAt: ISO, machineId: "custom-unpicked" },
      ],
    }), ["custom-lab-1"]);
    const note = p.notes.find((n) => n.ownerId === "b1")!;
    expect(note.body).toBe([
      "## Loot",
      "- file · web.config: connStr=abc (from IIS)",
      "- flag · other: flag-other",
      "- note · multi: line one",
      "  \\? not a thread",
    ].join("\n"));
    expect(p.skipped.redactedLoot).toBe(1);
    expect(p.skipped.lootUnassigned).toBe(3);
  });
});

describe("Task 5 fix round 1: no lost attempts", () => {
  it("attempts on a redacted credential follow a kept credential for the same principal", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c-red", redacted: true, secret: "[REDACTED]", domain: "CORP", verifications: { b2: { status: "admin" } } }),
        cred({ id: "c-real", username: "Alice", domain: "corp" }),
        cred({ id: "c-red2", username: "nobody", redacted: true }),
      ],
      credAttempts: [attempt({ id: "a1", credId: "c-red" }), attempt({ id: "a2", credId: "c-red2" })],
    });
    expect(p.credentials.map((c) => c.id)).toEqual(["c-real"]);
    expect(p.credAttempts.map((a) => [a.id, a.credId, a.hostId])).toEqual([["a1", "c-real", "b1"], ["c-red:verification:b2", "c-real", "b2"]]);
    expect(p.skipped.redactedCredential).toBe(2);
    expect(p.skipped.attemptCredMissing).toBe(1);
  });

  it("an attempt id taken by a different attempt gets a stable derived id", () => {
    const p = lootPlan({ credentials: [cred()], credAttempts: [attempt({ id: "a1" }), attempt({ id: "a1", service: "ssh" })] });
    expect(p.credAttempts.map((a) => a.id)).toEqual(["a1", "a1:cred_1||b1|ssh|domain"]);
  });

  it("sourceMachineId decides only when engagementId is absent or names no lab or standalone", () => {
    const p = lootPlan({
      credentials: [
        cred({ id: "c1", engagementId: "custom-unpicked", sourceMachineId: "b1" }),
        cred({ id: "c2", engagementId: "htb-gone", sourceMachineId: "b1", secret: "x" }),
      ],
      usernames: [{ id: "u1", username: "bob", createdAt: ISO, engagementId: "custom-unpicked", sourceMachineId: "b1" }],
    });
    expect(p.credentials.map((c) => [c.id, c.engagementId])).toEqual([["c2", "custom-lab-1"]]);
    expect(p.usernames).toEqual([]);
  });

  it("a whitespace-only secret with a blank username is skipped", () => {
    const p = lootPlan({ credentials: [cred({ username: "", secret: "   " })] });
    expect(p.credentials).toEqual([]);
    expect(p.skipped.badCredential).toBe(1);
  });

  it("droppedHostLink counts only kept records", () => {
    const p = lootPlan({
      credentials: [cred({ id: "c1" }), cred({ id: "c2", sourceMachineId: "custom-unpicked" })],
      usernames: [
        { id: "u1", username: "bob", createdAt: ISO, engagementId: "custom-lab-1" },
        { id: "u2", username: "bob", createdAt: ISO, engagementId: "custom-lab-1", sourceMachineId: "custom-unpicked" },
        { id: "u3", username: "eve", createdAt: ISO, engagementId: "custom-lab-1", sourceMachineId: "custom-unpicked" },
      ],
    });
    expect(p.skipped.credDuplicate).toBe(1);
    expect(p.skipped.droppedHostLink).toBe(1);
  });

  it("at the same instant the stronger result wins, whichever comes first", () => {
    const p = lootPlan({
      credentials: [cred()],
      credAttempts: [
        attempt({ id: "a1", result: "admin" }), attempt({ id: "a2", result: "failed" }),
        attempt({ id: "a3", service: "ssh", result: "failed" }), attempt({ id: "a4", service: "ssh", result: "valid", detail: "ok" }),
      ],
    });
    expect(p.credAttempts.map((a) => [a.id, a.result, a.detail])).toEqual([["a1", "admin", null], ["a3", "valid", "ok"]]);
  });

  it("a later errored attempt keeps the real result but refreshes detail and log link", () => {
    const p = lootPlan(
      {
        credentials: [cred()],
        credAttempts: [
          attempt({ id: "a1", result: "valid", port: 445 }),
          attempt({ id: "a2", result: "errored", at: "2024-06-01T00:00:00.000Z", detail: "timeout", logEntryId: "log-1" }),
        ],
      },
      { logEntries: [logEntry(1, { id: "log-1" })] as never },
    );
    expect(p.credAttempts).toEqual([expect.objectContaining({ id: "a1", result: "valid", at: ISO_MS, port: 445, detail: "timeout", logEntryId: "log-1" })]);
  });

  it("an explicit attempt and a legacy verification on one key merge into one", () => {
    const later = "2024-07-01T00:00:00.000Z";
    const p = lootPlan({
      credentials: [cred({ verifications: { b1: { status: "admin", protocol: "smb", updatedAt: later } } })],
      credAttempts: [attempt({ id: "a1", result: "failed", detail: "STATUS_LOGON_FAILURE" })],
    });
    expect(p.credAttempts).toEqual([expect.objectContaining({ id: "a1", result: "admin", at: Date.parse(later), detail: "STATUS_LOGON_FAILURE" })]);
  });
});
