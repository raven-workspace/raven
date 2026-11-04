import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDraft } from "../engines/capture";
import { saveCapture, type CaptureEdits } from "../features/capture/saveCapture";
import { api } from "../lib/api";
import type { Host } from "../types/host";
import type { LogEntry, LogEntryInput } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

function host(over: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    engagementId: "e1",
    ip: null,
    os: null,
    boardColumn: "enumerate",
    boardManual: false,
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
});
