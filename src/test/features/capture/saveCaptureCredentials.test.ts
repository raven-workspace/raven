import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCapture } from "../../../features/capture/resolve";
import { saveCapture } from "../../../features/capture/saveCapture";
import { EMPTY_DRAFT } from "../../../features/capture/useCaptureStore";
import { api } from "../../../lib/api";
import type { Credential, CredentialInput } from "../../../types/credentials";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry, LogEntryInput } from "../../../types/log";

vi.mock("../../../lib/api");
const m = vi.mocked(api, true);

const NT = "0123456789ABCDEF0123456789ABCDEF";
const WEB: Host = {
  id: "h1", engagementId: "e1", name: "web01", ip: "192.0.2.10", os: null, boardColumn: "initial-foothold",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "none", createdAt: 1, updatedAt: 1,
};

let stored: Credential[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  stored = [];
  m.logCreate.mockImplementation(async (_e, input: LogEntryInput): Promise<LogEntry> => ({
    id: "l1", engagementId: "e1", kind: input.content.kind, title: input.title, titleEdited: input.titleEdited ?? false,
    ranOn: input.ranOn, hostIds: input.hostIds, observations: input.observations, returnedNothing: input.returnedNothing,
    private: input.private, content: input.content, at: 1, createdAt: 1, updatedAt: 1,
  }));
  m.engagementGet.mockResolvedValue({ id: "e1", kind: "lab", domain: null, msfHostId: null } as Engagement);
  m.hostsList.mockResolvedValue([WEB]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockImplementation(async () => [...stored]);
  m.credentialCreate.mockImplementation(async (eid, input: CredentialInput) => {
    const c: Credential = {
      id: `c${stored.length + 1}`, engagementId: eid, type: input.type, username: input.username ?? "", domain: input.domain ?? null,
      secret: input.secret ?? "", hashType: input.hashType ?? null, scope: input.scope ?? "domain", localHostId: input.localHostId ?? null,
      sourceHostId: input.sourceHostId ?? null, source: input.source ?? null, notes: null, crackStatus: null, crackedFrom: null,
      fromSecretId: null, createdAt: 1, updatedAt: 1,
    };
    stored.push(c);
    return c;
  });
  m.extractionSave.mockImplementation(async (logEntryId, engagementId, summary, record) => ({
    logEntryId, engagementId, summary, record, createdAt: 2, undoneAt: null,
  }));
});

/** Pastes `text` into capture opened from web01's view, then saves it as the panel would. */
function save(text: string, asNote = false) {
  const r = resolveCapture({ ...EMPTY_DRAFT, text, asNote }, {
    hosts: [WEB], scope: [], domain: "", machines: [], lastRanOn: null, presetHostId: "h1",
  });
  return saveCapture({ engagementId: "e1", draft: r.draft, draftInput: r.draftInput, edits: r.edits, image: null, hosts: [WEB] });
}

describe("saveCapture with pasted credentials", () => {
  it("admin:Summer2026! becomes a credential found on the host, scoped as the Credentials form does, and the note is kept", async () => {
    const saved = await save("admin:Summer2026!");
    expect(m.logCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ hostIds: ["h1"], content: { kind: "note", text: "admin:Summer2026!" } }));
    expect(m.credentialCreate).toHaveBeenCalledTimes(1);
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", {
      type: "password", username: "admin", domain: null, secret: "Summer2026!", hashType: null, scope: "domain",
      localHostId: null, sourceHostId: "h1", source: "paste",
    });
    // Filed like any extraction: summarised, and Undo removes it.
    expect(saved.summary?.counts).toContain("1 password added");
    expect(m.extractionSave).toHaveBeenCalledWith("l1", "e1", saved.summary, expect.objectContaining({ createdCredentialIds: ["c1"] }));
  });

  it("CORP\\svc_sql:P@ss becomes a domain credential of CORP, found on the host", async () => {
    await save("CORP\\svc_sql:P@ss");
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      username: "svc_sql", domain: "CORP", secret: "P@ss", scope: "domain", localHostId: null, sourceHostId: "h1",
    }));
  });

  it(".\\Administrator:Passw0rd! becomes a local credential of the host, with no domain", async () => {
    await save(".\\Administrator:Passw0rd!");
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      username: "Administrator", domain: null, secret: "Passw0rd!", scope: "local", localHostId: "h1", sourceHostId: "h1",
    }));
  });

  it("a credential added on the Credentials page, then pasted on web01, is nothing new", async () => {
    // As CredentialForm adds it: domain scope, no source host.
    stored.push({
      id: "c0", engagementId: "e1", type: "password", username: "admin", domain: null, secret: "Summer2026!", hashType: null,
      scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
      fromSecretId: null, createdAt: 1, updatedAt: 1,
    });
    const saved = await save("admin:Summer2026!");
    expect(m.credentialCreate).not.toHaveBeenCalled();
    expect(saved.summary?.counts).toEqual(["Nothing new: already recorded"]);
  });

  it("admin:1234 is a credential; web01:8080 is host:port", async () => {
    await save("admin:1234");
    await save("web01:8080");
    expect(m.credentialCreate.mock.calls.map(([, i]) => `${i.username}:${i.secret}`)).toEqual(["admin:1234"]);
  });

  it("user:<32 hex> becomes an NTLM hash", async () => {
    const saved = await save(`jdoe:${NT}`);
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      type: "hash", username: "jdoe", secret: NT.toLowerCase(), hashType: "NTLM",
    }));
    expect(saved.summary?.counts).toContain("1 hash added");
  });

  it("multiple lines become multiple credentials", async () => {
    await save("admin:Summer2026!\nCORP\\svc_sql:P@ss");
    expect(m.credentialCreate.mock.calls.map(([, i]) => i.username)).toEqual(["admin", "svc_sql"]);
  });

  it("a credential already stored is not added twice", async () => {
    await save("admin:Summer2026!");
    const again = await save("admin:Summer2026!");
    expect(m.credentialCreate).toHaveBeenCalledTimes(1);
    expect(again.summary?.counts).toEqual(["Nothing new: already recorded"]);
  });

  it("save as note keeps today's behaviour: the note only, no credential, no summary", async () => {
    const saved = await save("admin:Summer2026!", true);
    expect(m.logCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ title: "admin:Summer2026!", content: { kind: "note", text: "admin:Summer2026!" } }));
    expect(m.credentialCreate).not.toHaveBeenCalled();
    expect(saved.summary).toBeNull();
    expect(m.extractionSave).not.toHaveBeenCalled();
  });

  it.each(["curl http://192.0.2.10:8080", "198.51.100.20:445"])("%s adds no credential", async (text) => {
    await save(text);
    expect(m.credentialCreate).not.toHaveBeenCalled();
  });
});
