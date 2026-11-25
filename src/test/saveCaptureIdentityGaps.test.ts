import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDraft } from "../engines/capture";
import { saveCapture, type CaptureEdits } from "../features/capture/saveCapture";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { HostIdentity } from "../types/hostFacts";
import type { LogEntry, LogEntryInput } from "../types/log";
import { filed } from "./features/capture/filed";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const DC: Host = {
  id: "h1", name: "dc01", engagementId: "e1", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "user", createdAt: 1, updatedAt: 1,
};

const entryOf = (input: LogEntryInput): LogEntry => ({
  id: "l1", engagementId: "e1", kind: input.content.kind, title: input.title, titleEdited: false, ranOn: input.ranOn,
  hostIds: input.hostIds, observations: input.observations, returnedNothing: input.returnedNothing, private: input.private,
  content: input.content, at: 1, createdAt: 1, updatedAt: 1,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.logCreate.mockImplementation(async (_e, input) => entryOf(input));
  m.engagementGet.mockResolvedValue({ id: "e1", kind: "lab", domain: null, msfHostId: null } as Engagement);
  m.hostsList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.checklistApplyEntryTicks.mockResolvedValue([]);
  m.extractionFile.mockResolvedValue(filed());
});

/** What each save gave the store to file: the identity, and the vectors. */
const identities = () => m.extractionFile.mock.calls.map(([, , p]) => p.identity);
const vectors = () => m.extractionFile.mock.calls.flatMap(([, , p]) => p.vectors);

function capture(command: string, output: string, ranOn = "dc01", hostIds = ["h1"]) {
  const content = { kind: "command" as const, blocks: [{ command, output }] };
  const draft: CaptureDraft = { kind: "command", title: "t", hostIds, ranOn, content, unknownScopeIps: [], scan: null };
  const edits: CaptureEdits = {
    kind: "command", title: "t", titleEdited: false, hostIds, ranOn, observations: "", returnedNothing: false, private: false, content,
  };
  return saveCapture(new QueryClient(), { engagementId: "e1", draft, edits, image: null, hosts: [DC] });
}

describe("identity capture gaps", () => {
  it("error output from whoami records nothing", async () => {
    m.hostIdentityGet.mockResolvedValue(null);
    await capture("whoami", "'whoam' is not recognized as an internal or external command");
    await capture("id", "bash: id: command not found");
    expect(identities().filter(Boolean)).toEqual([]);
    expect(vectors()).toEqual([]);
  });

  it("empty identity output is a no-op", async () => {
    m.hostIdentityGet.mockResolvedValue(null);
    await capture("whoami", "   \n");
    await capture("whoami /priv", "");
    expect(identities().filter(Boolean)).toEqual([]);
  });

  it("a block that ran on another box (Ran on mismatch) does not speak for this host", async () => {
    m.hostIdentityGet.mockResolvedValue(null);
    await capture("id", "uid=1000(kali) gid=1000(kali) groups=1000(kali),27(sudo)", "Kali (VM)");
    await capture("id", "uid=1000(other) gid=1000(other) groups=1000(other)", "web01");
    expect(identities().filter(Boolean)).toEqual([]);
  });

  it("an identity the output only repeats is proved as stored (the store writes it only when it differs)", async () => {
    const same: HostIdentity = { hostId: "h1", username: "corp\\svc", privileges: [], groups: [], entryId: "l0", updatedAt: 1 };
    m.hostIdentityGet.mockResolvedValue(same);
    await capture("whoami", "corp\\svc\r\n");
    expect(identities()).toEqual([{ hostId: "h1", username: "corp\\svc", privileges: [], groups: [] }]);
  });

  it("with no username known, the placeholder is the literal 'unknown' and a later whoami replaces it", async () => {
    let stored: HostIdentity | null = null;
    m.hostIdentityGet.mockImplementation(async () => stored);
    m.extractionFile.mockImplementation(async (_e, entryId, p) => {
      if (p.identity) stored = { ...p.identity, entryId, updatedAt: 2 };
      return filed();
    });
    await capture("whoami /priv", "Privilege Name  Description  State\n=== === ===\nSeDebugPrivilege  Debug programs  Enabled");
    expect(stored).toMatchObject({ username: "unknown", privileges: ["SeDebugPrivilege"] });
    await capture("whoami", "corp\\svc");
    expect(stored).toMatchObject({ username: "corp\\svc", privileges: ["SeDebugPrivilege"] });
  });
});
