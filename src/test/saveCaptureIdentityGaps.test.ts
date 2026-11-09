import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDraft } from "../engines/capture";
import { saveCapture, type CaptureEdits } from "../features/capture/saveCapture";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { HostIdentity } from "../types/hostFacts";
import type { LogEntry, LogEntryInput } from "../types/log";

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
});

function capture(command: string, output: string, ranOn = "dc01", hostIds = ["h1"]) {
  const content = { kind: "command" as const, blocks: [{ command, output }] };
  const draft: CaptureDraft = { kind: "command", title: "t", hostIds, ranOn, content, unknownScopeIps: [], scan: null };
  const edits: CaptureEdits = {
    kind: "command", title: "t", titleEdited: false, hostIds, ranOn, observations: "", returnedNothing: false, private: false, content,
  };
  return saveCapture({ engagementId: "e1", draft, edits, image: null, hosts: [DC] });
}

describe("identity capture gaps", () => {
  it("error output from whoami records nothing", async () => {
    m.hostIdentityGet.mockResolvedValue(null);
    await capture("whoami", "'whoam' is not recognized as an internal or external command");
    await capture("id", "bash: id: command not found");
    expect(m.hostIdentitySet).not.toHaveBeenCalled();
    expect(m.vectorUpsert).not.toHaveBeenCalled();
  });

  it("empty identity output is a no-op", async () => {
    m.hostIdentityGet.mockResolvedValue(null);
    await capture("whoami", "   \n");
    await capture("whoami /priv", "");
    expect(m.hostIdentitySet).not.toHaveBeenCalled();
  });

  it("a block that ran on another box (Ran on mismatch) does not speak for this host", async () => {
    m.hostIdentityGet.mockResolvedValue(null);
    await capture("id", "uid=1000(kali) gid=1000(kali) groups=1000(kali),27(sudo)", "Kali (VM)");
    await capture("id", "uid=1000(other) gid=1000(other) groups=1000(other)", "web01");
    expect(m.hostIdentitySet).not.toHaveBeenCalled();
  });

  it("an unchanged identity is not written again", async () => {
    const same: HostIdentity = { hostId: "h1", username: "corp\\svc", privileges: [], groups: [], entryId: "l0", updatedAt: 1 };
    m.hostIdentityGet.mockResolvedValue(same);
    await capture("whoami", "corp\\svc\r\n");
    expect(m.hostIdentitySet).not.toHaveBeenCalled();
  });

  it("with no username known, the placeholder is the literal 'unknown' and a later whoami replaces it", async () => {
    let stored: HostIdentity | null = null;
    m.hostIdentityGet.mockImplementation(async () => stored);
    m.hostIdentitySet.mockImplementation(async (input) => (stored = { ...input, updatedAt: 2 }));
    await capture("whoami /priv", "Privilege Name  Description  State\n=== === ===\nSeDebugPrivilege  Debug programs  Enabled");
    expect(stored).toMatchObject({ username: "unknown", privileges: ["SeDebugPrivilege"] });
    await capture("whoami", "corp\\svc");
    expect(stored).toMatchObject({ username: "corp\\svc", privileges: ["SeDebugPrivilege"] });
  });
});
