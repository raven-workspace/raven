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
