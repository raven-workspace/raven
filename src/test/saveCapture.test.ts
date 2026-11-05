import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDraft } from "../engines/capture";
import { PartialSaveError, saveCapture, type CaptureEdits } from "../features/capture/saveCapture";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry, LogEntryInput } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

function host(over: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    engagementId: "e1",
    ip: null,
    os: null,
    boardColumn: "information-gathering",
    boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
    access: "none",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const DC = host({ id: "h1", name: "dc01", ip: "10.10.10.5", access: "user" });
const PORTS = [
  { port: 22, protocol: "tcp" as const, state: "open", service: "ssh", version: "OpenSSH 8.9" },
  { port: 80, protocol: "tcp" as const, state: "open", service: "http", version: "Apache" },
];
const content = { kind: "command" as const, blocks: [{ command: "nmap -sV 10.10.10.5", output: "..." }] };

function draft(over: Partial<CaptureDraft> = {}): CaptureDraft {
  return {
    kind: "command",
    title: "Scan · 10.10.10.5",
    hostIds: ["h1"],
    ranOn: "Kali (VM)",
    content,
    unknownScopeIps: [],
    scan: null,
    ...over,
  };
}

function edits(over: Partial<CaptureEdits> = {}): CaptureEdits {
  return {
    kind: "command",
    title: "Scan · 10.10.10.5",
    titleEdited: false,
    hostIds: ["h1"],
    ranOn: "Kali (VM)",
    observations: "",
    returnedNothing: false,
    private: false,
    content,
    ...over,
  };
}

function entry(input: LogEntryInput): LogEntry {
  return {
    id: "l1",
    engagementId: "e1",
    kind: input.content.kind,
    title: input.title,
    titleEdited: input.titleEdited ?? false,
    ranOn: input.ranOn,
    hostIds: input.hostIds,
    observations: input.observations,
    returnedNothing: input.returnedNothing,
    private: input.private,
    content: input.content,
    at: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.logCreate.mockImplementation(async (_e, input) => entry(input));
  // The checklist follow-up reads the store after the entry saves.
  m.engagementGet.mockResolvedValue({ id: "e1", kind: "lab", domain: null, msfHostId: null } as Engagement);
  m.hostsList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
});

describe("saveCapture", () => {
  it("saveCapture creates new hosts before the entry", async () => {
    const order: string[] = [];
    m.hostCreate.mockImplementation(async (_e, input) => {
      order.push(`host ${input.ip}`);
      return host({ id: `new-${input.ip}`, name: input.name, ip: input.ip ?? null });
    });
    m.logCreate.mockImplementation(async (_e, input) => {
      order.push("log");
      return entry(input);
    });
    const saved = await saveCapture({
      engagementId: "e1",
      draft: draft(),
      edits: edits({ observations: "  smb signing off  ", ranOn: "" }),
      addIps: ["10.10.10.7", "10.10.10.8"],
      image: null,
      hosts: [DC],
    });
    expect(order).toEqual(["host 10.10.10.7", "host 10.10.10.8", "log"]);
    expect(m.hostCreate).toHaveBeenCalledWith("e1", { name: "10.10.10.7", ip: "10.10.10.7" });
    expect(m.logCreate).toHaveBeenCalledWith("e1", {
      title: "Scan · 10.10.10.5",
      titleEdited: false,
      ranOn: null,
      hostIds: ["h1", "new-10.10.10.7", "new-10.10.10.8"],
      observations: "smb signing off",
      returnedNothing: false,
      private: false,
      content,
      attachment: null,
    });
    expect(saved.id).toBe("l1");
    expect(m.servicesUpsertScan).not.toHaveBeenCalled();
  });

  it("saveCapture upserts services and fills os", async () => {
    const order: string[] = [];
    m.logCreate.mockImplementation(async (_e, input) => {
      order.push("log");
      return entry(input);
    });
    m.servicesUpsertScan.mockImplementation(async () => {
      order.push("services");
      return [];
    });
    m.hostUpdate.mockImplementation(async (id, input) => {
      order.push("host");
      return host({ id, name: input.name });
    });
    await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: "linux" } }),
      edits: edits(),
      addIps: [],
      image: null,
      hosts: [DC],
    });
    expect(order).toEqual(["log", "services", "host"]);
    expect(m.servicesUpsertScan).toHaveBeenCalledWith("h1", PORTS);
    expect(m.hostUpdate).toHaveBeenCalledWith("h1", { name: "dc01", ip: "10.10.10.5", os: "linux", access: "user" });

    // A host with an OS keeps it; an unlinked scan host gets nothing.
    m.hostUpdate.mockClear();
    m.servicesUpsertScan.mockClear();
    const linux = { ...DC, os: "windows" as const };
    await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: "linux" } }),
      edits: edits(),
      addIps: [],
      image: null,
      hosts: [linux],
    });
    expect(m.servicesUpsertScan).toHaveBeenCalledTimes(1);
    expect(m.hostUpdate).not.toHaveBeenCalled();
    m.servicesUpsertScan.mockClear();
    await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: "linux" } }),
      edits: edits({ hostIds: [] }),
      addIps: [],
      image: null,
      hosts: [DC],
    });
    expect(m.servicesUpsertScan).not.toHaveBeenCalled();
  });

  it("first scan of a new box re-runs the draft with the created host", async () => {
    const order: string[] = [];
    m.hostCreate.mockImplementation(async (_e, input) => {
      order.push("host");
      return host({ id: "h9", name: input.name, ip: input.ip ?? null });
    });
    m.logCreate.mockImplementation(async (_e, input) => {
      order.push("log");
      return entry(input);
    });
    m.servicesUpsertScan.mockImplementation(async () => {
      order.push("services");
      return [];
    });
    m.hostUpdate.mockImplementation(async (id, input) => host({ id, name: input.name }));
    const text = [
      "kali@kali:~$ nmap -sCV -p 22,80 10.10.10.9",
      "Nmap scan report for 10.10.10.9",
      "PORT   STATE SERVICE VERSION",
      "22/tcp open  ssh     OpenSSH 8.9",
      "80/tcp open  http    Apache httpd 2.4.52",
      "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
    ].join("\n");
    const draftInput = {
      text,
      image: null,
      kind: "command" as const,
      hosts: [{ id: "h1", name: "dc01", ip: "10.10.10.5", column: "information-gathering" as const }],
      scope: ["10.10.10.0/24"],
      domain: "",
      machines: ["Kali (VM)"],
      lastRanOn: null,
    };
    const created: string[] = [];
    await saveCapture({
      engagementId: "e1",
      draft: draft({ hostIds: [], scan: null, unknownScopeIps: ["10.10.10.9"] }),
      draftInput,
      edits: edits({ hostIds: [] }),
      addIps: ["10.10.10.9"],
      image: null,
      hosts: [DC],
      onHostCreated: (h) => created.push(h.id),
    });
    expect(order).toEqual(["host", "log", "services"]);
    expect(created).toEqual(["h9"]);
    expect(m.servicesUpsertScan).toHaveBeenCalledWith("h9", [
      expect.objectContaining({ port: 22, service: "ssh" }),
      expect.objectContaining({ port: 80, service: "http" }),
    ]);
    expect(m.hostUpdate).toHaveBeenCalledWith("h9", { name: "10.10.10.9", ip: "10.10.10.9", os: "linux", access: "none" });
  });

  it("re-run after creating a host writes only that host's section of a multi-host scan", async () => {
    m.hostCreate.mockImplementation(async (_e, input) => host({ id: "h9", name: input.name, ip: input.ip ?? null }));
    m.logCreate.mockImplementation(async (_e, input) => entry(input));
    m.servicesUpsertScan.mockResolvedValue([]);
    m.hostUpdate.mockImplementation(async (id, input) => host({ id, name: input.name }));
    const text = [
      "kali@kali:~$ nmap -sV 10.10.10.9 10.10.10.8",
      "Nmap scan report for 10.10.10.9",
      "PORT   STATE SERVICE VERSION",
      "22/tcp open  ssh     OpenSSH 8.9",
      "",
      "Nmap scan report for 10.10.10.8",
      "PORT    STATE SERVICE       VERSION",
      "135/tcp open  msrpc         Microsoft Windows RPC",
      "Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows",
    ].join("\n");
    await saveCapture({
      engagementId: "e1",
      draft: draft({ hostIds: [], scan: null, unknownScopeIps: ["10.10.10.9", "10.10.10.8"] }),
      draftInput: {
        text,
        image: null,
        kind: "command",
        hosts: [{ id: "h1", name: "dc01", ip: "10.10.10.5", column: "information-gathering" }],
        scope: ["10.10.10.0/24"],
        domain: "",
        machines: ["Kali (VM)"],
        lastRanOn: null,
      },
      edits: edits({ hostIds: [] }),
      addIps: ["10.10.10.9"],
      image: null,
      hosts: [DC],
    });
    expect(m.servicesUpsertScan).toHaveBeenCalledWith("h9", [expect.objectContaining({ port: 22 })]);
    expect(m.hostUpdate).not.toHaveBeenCalled();
  });

  it("only open ports are upserted (M1)", async () => {
    m.logCreate.mockImplementation(async (_e, input) => entry(input));
    m.servicesUpsertScan.mockResolvedValue([]);
    const ports = [
      ...PORTS,
      { port: 25, protocol: "tcp" as const, state: "closed", service: "smtp", version: "" },
      { port: 161, protocol: "udp" as const, state: "open|filtered", service: "snmp", version: "" },
      { port: 445, protocol: "tcp" as const, state: "filtered", service: "microsoft-ds", version: "" },
    ];
    await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports, os: null } }),
      edits: edits(),
      addIps: [],
      image: null,
      hosts: [{ ...DC, os: "linux" }],
    });
    expect(m.servicesUpsertScan.mock.calls[0]![1].map((p) => p.port)).toEqual([22, 80, 161]);
  });

  it("services failure still keeps the entry", async () => {
    m.servicesUpsertScan.mockRejectedValue(new Error("db busy"));
    const err = await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits(),
      addIps: [],
      image: { mime: "image/png", dataBase64: "AAAA" },
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: "Saved, but services didn't update: db busy",
      entry: { id: "l1" },
    });
    expect(m.logCreate).toHaveBeenCalledTimes(1);
    expect(m.logCreate.mock.calls[0]![1].attachment).toEqual({ mime: "image/png", dataBase64: "AAAA" });
  });

  it("services and checklist both failing says both", async () => {
    m.servicesUpsertScan.mockRejectedValue(new Error("db busy"));
    m.checklistList.mockRejectedValue(new Error("db busy"));
    const err = await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits(),
      addIps: [],
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: "Saved, but services didn't update: db busy. The checklist didn't update either: use Tick from log on the Engagement checklist.",
      entry: { id: "l1" },
    });
  });

  it("services and credential intake both failing says both and carries every cause", async () => {
    const busy = new Error("db busy");
    const locked = new Error("locked");
    m.servicesUpsertScan.mockRejectedValue(busy);
    m.credentialsList.mockRejectedValue(locked);
    const nxc = { kind: "command" as const, blocks: [{ command: "nxc smb 10.10.10.5 -u bob -p 'Fake1'", output: "SMB  10.10.10.5  445  DC01  [+] corp\\bob:Fake1" }] };
    const err = await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits({ content: nxc }),
      addIps: [],
      image: null,
      hosts: [DC],
      intake: { credentials: [], usernames: [], toggles: {}, previewKeys: [] },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PartialSaveError);
    expect(err).toMatchObject({
      message: "Saved, but services didn't update: db busy. The credentials didn't update either: paste the output again to retry.",
      reason: busy,
      reasons: [busy, locked],
    });
  });

  it("services failure with a lock-only follow-up failure uses the lock's message", async () => {
    m.servicesUpsertScan.mockRejectedValue(new Error("db busy"));
    m.engagementGet.mockResolvedValue({ id: "e1", kind: "exam-sim", domain: null, msfHostId: null } as Engagement);
    m.hostsList.mockResolvedValue([DC]);
    m.engagementSetMsfHost.mockRejectedValue(new Error("db busy"));
    const err = await saveCapture({
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits({ content: { kind: "command", blocks: [{ command: "msfconsole -q -x 'use exploit/windows/smb/psexec; set RHOSTS 10.10.10.5'", output: "" }] } }),
      addIps: [],
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: "Saved, but services didn't update: db busy. Saved the entry, but the Metasploit lock didn't update.",
    });
  });

  it("checklist failure after the entry saved is a partial save carrying its cause", async () => {
    const cause = new Error("locked");
    m.checklistPut.mockRejectedValue(cause);
    m.hostsList.mockResolvedValue([DC]);
    const err = await saveCapture({
      engagementId: "e1",
      draft: draft(),
      edits: edits({ content: { kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef" }, kind: "flag" }),
      addIps: [],
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PartialSaveError);
    expect(err).toMatchObject({
      message: "Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist.",
      entry: { id: "l1" },
      reason: cause,
    });
  });
});
