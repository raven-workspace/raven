import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useLogEntryStore } from "../features/capture/useLogEntryStore";
import { credKey } from "../engines/credentials";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { AccessGrant, CredAttempt, CredAttemptInput, Credential, CredentialInput, TriedPair, Username } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { ExtractionProofs, LogEntry, LogEntryInput } from "../types/log";
import type { Service } from "../types/service";
import { filed } from "./features/capture/filed";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: "Kali (VM)", msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const host = (over: Partial<Host> & Pick<Host, "id" | "name">): Host => ({
  engagementId: "e1", ip: null, os: "windows", boardColumn: "vulnerability-detection", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const H1 = host({ id: "h1", name: "dc01", ip: "10.10.10.5" });
const H2 = host({ id: "h2", name: "web07", ip: "10.10.10.6" });
const smb = (id: string, hostId: string): Service => ({
  id, hostId, port: 445, protocol: "tcp", state: "open", nmapService: "microsoft-ds", nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});
const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const uname = (o: Partial<Username> & { id: string; username: string }): Username => ({
  engagementId: "e1", domain: null, sourceHostId: null, source: null, createdAt: 1, scope: "unknown", localHostId: null, ...o,
});

const BOB = cred({ id: "cBob", username: "bob", domain: "corp.local", secret: "Pass1" });
const OWNERLESS = cred({ id: "cS", username: "", secret: "Spray1" });
const ALICE = uname({ id: "uAlice", username: "alice", domain: "corp.local" });

/**
 * A stateful backend that applies the Rust rules: username_create and credential_create return the existing row on
 * a duplicate; cred_attempts_upsert never downgrades (attempts.rs `merge`); cred_attempts_rekey moves rows through
 * the same merge.
 */
interface Db {
  credentials: Credential[];
  usernames: Username[];
  attempts: CredAttempt[];
  grants: AccessGrant[];
  log: LogEntry[];
  tried: TriedPair[];
}
let db: Db;
let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;
const RANK: Record<string, number> = { admin: 3, valid: 2, failed: 1, errored: 0 };
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function mergeAttempt(old: CredAttempt, n: CredAttempt): CredAttempt | null {
  const supersedesError = old.result === "errored" && n.result !== "errored";
  if (n.result === "errored" && old.result !== "errored") return null;
  if (!supersedesError) {
    if (n.at < old.at) return null;
    if (n.at === old.at && RANK[n.result] < RANK[old.result]) return null;
  }
  const out: CredAttempt = {
    ...old, result: n.result, at: n.at, port: n.port ?? old.port, logEntryId: n.logEntryId,
    detail: n.detail ?? (supersedesError ? old.detail : null),
  };
  return JSON.stringify(out) === JSON.stringify(old) ? null : out;
}

function upsertRow(a: CredAttempt): CredAttempt {
  if (!db.credentials.some((c) => c.id === a.credId)) throw new Error(`not_found: credential ${a.credId}`);
  if (a.usernameId && !db.usernames.some((u) => u.id === a.usernameId)) throw new Error(`not_found: username ${a.usernameId}`);
  const i = db.attempts.findIndex(
    (o) => o.credId === a.credId && (o.usernameId ?? "") === (a.usernameId ?? "") && o.hostId === a.hostId &&
      o.service === a.service && o.authMode === a.authMode,
  );
  if (i < 0) {
    db.attempts.push(a);
    return a;
  }
  const merged = mergeAttempt(db.attempts[i]!, a);
  if (merged) db.attempts[i] = merged;
  return db.attempts[i]!;
}

function setupBackend(seed: Partial<Db> = {}) {
  seq = 0;
  db = {
    credentials: [BOB, OWNERLESS],
    usernames: [ALICE],
    attempts: [],
    grants: [],
    log: [],
    tried: [],
    ...structuredClone(seed),
  };
  m.triedPairsList.mockImplementation(async () => structuredClone(db.tried));
  m.triedPairsUpsert.mockImplementation(async (eid, inputs) =>
    inputs.map((i) => {
      const t: TriedPair = {
        id: nextId("t"), engagementId: eid, username: i.username, domain: i.domain ?? null, secret: i.secret, secretKind: i.secretKind,
        hostId: i.hostId, service: i.service, authMode: i.authMode ?? "domain", logEntryId: i.logEntryId ?? null, at: i.at ?? 1,
      };
      const found = db.tried.find((x) => x.username === t.username && x.secret === t.secret && x.hostId === t.hostId && x.service === t.service);
      if (found) return found;
      db.tried.push(t);
      return t;
    }),
  );
  m.credentialsList.mockImplementation(async () => structuredClone(db.credentials));
  m.usernamesList.mockImplementation(async () => structuredClone(db.usernames));
  m.credAttemptsList.mockImplementation(async () => structuredClone(db.attempts));
  m.accessGrantsList.mockImplementation(async () => structuredClone(db.grants));
  m.logList.mockImplementation(async () => structuredClone(db.log));
  m.usernameCreate.mockImplementation(async (eid, input) => {
    const found = db.usernames.find((u) => lc(u.username) === lc(input.username) && lc(u.domain) === lc(input.domain));
    if (found) return found;
    const u: Username = {
      id: nextId("u"), engagementId: eid, username: input.username.trim(), domain: input.domain ?? null,
      sourceHostId: input.sourceHostId ?? null, source: input.source ?? null, createdAt: seq, scope: input.scope ?? "unknown", localHostId: input.localHostId ?? null,
    };
    db.usernames.push(u);
    return u;
  });
  m.credentialCreate.mockImplementation(async (eid, input: CredentialInput) => {
    const c = cred({
      id: nextId("c"), engagementId: eid, type: input.type, username: input.username ?? "", domain: input.domain ?? null,
      secret: input.secret ?? "", hashType: input.hashType ?? null, scope: input.scope ?? "domain",
      localHostId: input.localHostId ?? null, sourceHostId: input.sourceHostId ?? null, source: input.source ?? null,
      notes: input.notes ?? null, crackStatus: input.type === "hash" ? (input.crackStatus ?? "uncracked") : null,
      crackedFrom: input.crackedFrom ?? null, fromSecretId: input.fromSecretId ?? null,
    });
    // The store's identity, with equal domain spellings only (the same-domain rule itself is tested in Rust).
    const found = db.credentials.find((x) => x.secret && credKey(x) === credKey(c) && x.localHostId === c.localHostId);
    if (found) return { credential: found, existed: true };
    db.credentials.push(c);
    return { credential: c, existed: false };
  });
  m.credentialUpdate.mockImplementation(async (id, input: CredentialInput) => {
    const i = db.credentials.findIndex((c) => c.id === id);
    const cur = db.credentials[i]!;
    const next: Credential = {
      ...cur, type: input.type, username: input.username ?? "", domain: input.domain ?? null, secret: input.secret ?? "",
      hashType: input.hashType ?? null, scope: input.scope ?? "domain", localHostId: input.localHostId ?? null,
      sourceHostId: input.sourceHostId ?? null, source: input.source ?? null, notes: input.notes ?? null,
      crackStatus: input.crackStatus === undefined ? cur.crackStatus : input.crackStatus,
      crackedFrom: input.crackedFrom === undefined ? cur.crackedFrom : input.crackedFrom,
      fromSecretId: input.fromSecretId === undefined ? cur.fromSecretId : input.fromSecretId,
    };
    db.credentials[i] = next;
    return next;
  });
  m.credAttemptsUpsert.mockImplementation(async (eid, inputs: CredAttemptInput[]) =>
    inputs.map((i) =>
      upsertRow({
        id: nextId("a"), engagementId: eid, credId: i.credId, usernameId: i.usernameId ?? null, hostId: i.hostId,
        service: i.service, port: i.port ?? null, result: i.result, authMode: i.authMode ?? "domain",
        detail: i.detail ?? null, logEntryId: i.logEntryId ?? null, at: i.at ?? 999_999,
      }),
    ),
  );
  m.credAttemptsRekey.mockImplementation(async (usernameId, secretCredIds, credId, hostId) => {
    const moving = db.attempts.filter(
      (a) => a.usernameId === usernameId && secretCredIds.includes(a.credId) && (!hostId || (a.hostId === hostId && a.authMode === "local")),
    );
    db.attempts = db.attempts.filter((a) => !moving.includes(a));
    return moving.map((a) => upsertRow({ ...a, credId, usernameId: null }));
  });
  m.accessGrantCreate.mockImplementation(async (eid, input) => {
    const g: AccessGrant = {
      id: nextId("g"), engagementId: eid, usernameId: input.usernameId!, hostId: input.hostId, level: input.level,
      via: input.via, logEntryId: input.logEntryId ?? null, at: input.at ?? 1,
    };
    db.grants.push(g);
    return g;
  });
  m.accessGrantDelete.mockImplementation(async (id) => {
    db.grants = db.grants.filter((g) => g.id !== id);
    return null;
  });
  m.logCreate.mockImplementation(async (eid, input: LogEntryInput) => {
    const id = nextId("l");
    const e: LogEntry = {
      id, engagementId: eid, kind: input.content.kind, title: input.title, titleEdited: input.titleEdited ?? false,
      ranOn: input.ranOn, hostIds: input.hostIds, observations: input.observations, returnedNothing: input.returnedNothing,
      private: input.private, content: input.content, at: 1000 * seq, createdAt: 1000 * seq, updatedAt: 1000 * seq,
    };
    db.log.push(e);
    return e;
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useLogEntryStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [] });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1, H2]);
  m.servicesList.mockResolvedValue([smb("s1", "h1")]);
  m.servicesListEngagement.mockResolvedValue([smb("s1", "h1"), smb("s2", "h2")]);
  m.extractionFile.mockResolvedValue(filed());
  m.checklistList.mockResolvedValue([]);
  m.checklistApplyFacts.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.checklistApplyEntryTicks.mockResolvedValue([]);
  setupBackend();
});

function mount(path = "/e/e1") {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openLogEntry(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("region", { name: "Vulnerability detection" });
  await user.keyboard("l");
  return screen.findByRole("dialog", { name: "Add to log" });
}

/** Pastes into Add to log and saves; nothing is asked before Save. */
async function pasteAndSave(user: ReturnType<typeof userEvent.setup>, text: string) {
  const dialog = await openLogEntry(user);
  await user.paste(text);
  // No pre-save toggles: the preview is gone.
  expect(within(dialog).queryByRole("region", { name: "Credentials from this output" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
  return dialog;
}

async function saved() {
  await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

const SPRAY = [
  "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.6 -u bob -p 'Pass1' --continue-on-success",
  "SMB  10.10.10.5  445  DC01   [+] corp.local\\bob:Pass1 (Pwn3d!)",
  "SMB  10.10.10.6  445  WEB07  [-] corp.local\\bob:Pass1 STATUS_LOGON_FAILURE",
  "SMB  10.10.10.5  445  DC01   [+] corp.local\\omar:Fresh1",
  "SMB  10.10.10.6  445  WEB07  [-] corp.local\\eve:Nope1 STATUS_LOGON_FAILURE",
  "SMB  10.10.10.99 445  GHOST  [+] corp.local\\bob:Pass1",
].join("\n");

/** What the saves gave the store to file; the filing itself is the store's (extractions/filing.rs). */
const proofs = (): ExtractionProofs => m.extractionFile.mock.calls.at(-1)![2];
const pending = (username: string) => proofs().intake!.credentials.find((c) => c.input.username === username)!;
const NEW_9 = "new-host:10.10.10.9";

describe("nxc results on save", () => {
  it("a [+] pair on an unknown IP proves the host, and its credential lands there", async () => {
    const user = userEvent.setup();
    mount();
    await pasteAndSave(
      user,
      [
        "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.9 -u bob -p 'Pass'",
        "SMB  10.10.10.5  445  DC01   [-] corp\\bob:Pass STATUS_LOGON_FAILURE",
        "SMB  10.10.10.9  445  NEWBOX [+] corp\\bob:Pass",
      ].join("\n"),
    );
    await saved();
    expect(m.extractionFile).toHaveBeenCalledWith("e1", db.log[0]!.id, expect.anything());
    expect(proofs().newHosts).toEqual([{ key: NEW_9, ip: "10.10.10.9" }]);
    const bob = pending("bob");
    expect(bob).toMatchObject({ accepted: true, input: { domain: "corp", scope: "domain", sourceHostId: NEW_9 } });
    expect(bob.attempts.map((a) => [a.hostId, a.result]).sort()).toEqual([["h1", "failed"], [NEW_9, "valid"]]);
  });

  it("a local pair on a proven new host is local to it; its failed-only neighbour is a tried pair", async () => {
    const user = userEvent.setup();
    mount();
    await pasteAndSave(
      user,
      [
        "kali@kali:~$ nxc smb 10.10.10.9 -u administrator guest -p 'Local1' --local-auth",
        "SMB  10.10.10.9  445  NEWBOX [+] NEWBOX\\administrator:Local1 (Pwn3d!)",
        "SMB  10.10.10.9  445  NEWBOX [-] NEWBOX\\guest:Local1 STATUS_LOGON_FAILURE",
      ].join("\n"),
    );
    await saved();
    const accepted = proofs().intake!.credentials.filter((c) => c.accepted);
    expect(accepted.map((c) => [c.input.username, c.input.scope, c.input.localHostId])).toEqual([["administrator", "local", NEW_9]]);
    expect(proofs().triedPairs.map((t) => [t.username, t.secret, t.hostId, t.authMode])).toEqual([["guest", "Local1", NEW_9, "local"]]);
  });

  it("a failed hash pair is a tried pair, never a credential", async () => {
    const nt = "0123456789abcdef0123456789abcdef";
    const user = userEvent.setup();
    mount();
    await pasteAndSave(
      user,
      [`kali@kali:~$ nxc smb 10.10.10.6 -u eve -H ${nt}`, `SMB  10.10.10.6  445  WEB07  [-] corp.local\\eve:${nt} STATUS_LOGON_FAILURE`].join("\n"),
    );
    await saved();
    expect(proofs().intake!.credentials.filter((c) => c.accepted)).toEqual([]);
    expect(proofs().triedPairs).toEqual([expect.objectContaining({ username: "eve", secret: nt, secretKind: "hash", hostId: "h2", service: "smb" })]);
  });

  it("saving proves every result and every working pair", async () => {
    const user = userEvent.setup();
    mount();
    await pasteAndSave(user, SPRAY);
    await saved();
    const p = proofs();
    // bob's results, on his stored credential
    expect(p.intake!.attempts.filter((a) => a.credId === "cBob").map((a) => [a.hostId, a.result]).sort()).toEqual([
      ["h1", "admin"],
      ["h2", "failed"],
      ["new-host:10.10.10.99", "valid"],
    ]);
    // omar worked: a new credential with its own result; eve only failed: a tried pair, never a credential
    expect(pending("omar")).toMatchObject({ accepted: true, input: { type: "password", secret: "Fresh1", domain: "corp.local", scope: "domain", sourceHostId: "h1" } });
    expect(pending("omar").attempts.map((a) => [a.hostId, a.result])).toEqual([["h1", "valid"]]);
    expect(pending("eve").accepted).toBe(false);
    expect(p.triedPairs.map((t) => [t.username, t.secret, t.hostId])).toEqual([["eve", "Nope1", "h2"]]);
    // usernames seen in the output are listed
    expect(p.intake!.usernames.map((u) => u.input.username).sort()).toEqual(["bob", "eve", "omar"]);
    // the unknown host's [+] line proves 10.10.10.99
    expect(p.newHosts).toEqual([{ key: "new-host:10.10.10.99", ip: "10.10.10.99" }]);
  });

  it("a username spray hit carries the username whose earlier results move onto the new credential", async () => {
    const user = userEvent.setup();
    mount();
    await pasteAndSave(user, ["kali@kali:~$ nxc smb 10.10.10.5 -u users.txt -p 'Pass1'", "SMB  10.10.10.5  445  DC01   [+] corp.local\\alice:Pass1"].join("\n"));
    await saved();
    expect(pending("alice")).toMatchObject({ accepted: true, fromUsername: { usernameId: "uAlice", secretCredIds: ["cBob"] } });
  });

  it("a spray hit names the owner-less secret it came from", async () => {
    const user = userEvent.setup();
    mount();
    await pasteAndSave(user, ["kali@kali:~$ nxc smb 10.10.10.5 -u users.txt -p 'Spray1'", "SMB  10.10.10.5  445  DC01   [+] corp.local\\frank:Spray1"].join("\n"));
    await saved();
    expect(pending("frank")).toMatchObject({ accepted: true, input: { secret: "Spray1", fromSecretId: "cS" } });
    expect(pending("frank").attempts.map((a) => [a.hostId, a.result])).toEqual([["h1", "valid"]]);
  });

  it("saving the same output twice proves the same again", async () => {
    const TGS = "$krb5tgs$23$*svc$CORP.LOCAL$MSSQL/db*$aabbccdd$eeff0011";
    const output = [
      "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.6 -u users.txt -p 'Pass1' --continue-on-success",
      "SMB  10.10.10.5  445  DC01   [+] corp.local\\alice:Pass1 (Pwn3d!)",
      "SMB  10.10.10.6  445  WEB07  [-] corp.local\\eve:Nope1 STATUS_LOGON_FAILURE",
      `LDAP  10.10.10.5  389  DC01   ${TGS}`,
    ].join("\n");
    const user = userEvent.setup();
    mount();
    await pasteAndSave(user, output);
    await saved();
    const first = proofs();
    // The roast hash is offered with a type; the store returns the one it holds the second time.
    expect(first.intake!.hashes).toEqual([expect.objectContaining({ username: "svc", type: "hash", hashType: expect.any(String) })]);
    await pasteAndSave(user, output);
    await saved();
    expect(db.log).toHaveLength(2);
    expect(proofs()).toEqual(first);
  });

  it("a filing failure shows the partial-save message and the entry stays", async () => {
    m.extractionFile.mockRejectedValue(new Error("disk full"));
    const user = userEvent.setup();
    mount();
    const dialog = await pasteAndSave(user, SPRAY);
    expect(await within(dialog).findByText("Saved the entry, but Raven couldn't file what it found. Paste the output again to retry.")).toBeInTheDocument();
    expect(m.logCreate).toHaveBeenCalledTimes(1);
    expect(m.logDelete).not.toHaveBeenCalled();
    expect(db.log).toHaveLength(1);
    // the draft is gone, so Save can't create the entry twice
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("");
  });

  it("a filing failure and a checklist failure read as one message", async () => {
    m.extractionFile.mockRejectedValue(new Error("disk full"));
    m.checklistApplyEntryTicks.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    mount();
    const dialog = await pasteAndSave(user, SPRAY);
    expect(
      await within(dialog).findByText(
        "Saved the entry, but Raven couldn't file what it found. Paste the output again to retry. The checklist didn't update either: use Tick from log on the Engagement checklist.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Host Credentials fact group", () => {
  it("Host Credentials lists grants and results with proof links", async () => {
    const proof: LogEntry = {
      id: "l9", engagementId: "e1", kind: "command", title: "nxc smb spray", titleEdited: false, ranOn: null, hostIds: ["h1"],
      observations: null, returnedNothing: false, private: false,
      content: { kind: "command", blocks: [{ command: "nxc smb 10.10.10.5", output: "SMB 10.10.10.5 445 DC01 [+] corp.local\\bob:Pass1 (Pwn3d!)" }] },
      at: 5000, createdAt: 5000, updatedAt: 5000,
    };
    setupBackend({
      log: [proof],
      attempts: [
        {
          id: "a1", engagementId: "e1", credId: "cBob", usernameId: null, hostId: "h1", service: "smb", port: 445,
          result: "admin", authMode: "domain", detail: null, logEntryId: "l9", at: 5000,
        },
        {
          id: "a2", engagementId: "e1", credId: "cBob", usernameId: "uAlice", hostId: "h1", service: "winrm", port: 5985,
          result: "failed", authMode: "domain", detail: "STATUS_LOGON_FAILURE", logEntryId: null, at: 4000,
        },
        {
          id: "a4", engagementId: "e1", credId: "cBob", usernameId: null, hostId: "h1", service: "rdp", port: 3389,
          result: "errored", authMode: "domain", detail: "connection reset", logEntryId: null, at: 3000,
        },
        {
          id: "a3", engagementId: "e1", credId: "cBob", usernameId: null, hostId: "h2", service: "smb", port: 445,
          result: "valid", authMode: "domain", detail: null, logEntryId: "l9", at: 5000,
        },
      ],
      grants: [
        { id: "g1", engagementId: "e1", usernameId: "uAlice", hostId: "h1", level: "admin", via: "webshell", logEntryId: null, at: 1 },
        { id: "g2", engagementId: "e1", usernameId: "uAlice", hostId: "h2", level: "user", via: "rdp", logEntryId: null, at: 1 },
      ],
    });
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    const panel = await screen.findByRole("region", { name: "Host Credentials" });
    // Before a foothold the group is open, and its folded summary would read the same counts.
    expect(screen.queryByRole("tab", { name: "Credentials" })).not.toBeInTheDocument();

    // the matrix shows only this host's column
    expect(await within(panel).findByRole("button", { name: "corp.local\\bob on dc01 SMB: admin" })).toBeInTheDocument();
    expect(within(panel).queryByText(/web07/)).not.toBeInTheDocument();
    // the secret stays masked
    expect(within(panel).queryByText("Pass1")).not.toBeInTheDocument();

    // grants on this host only, removable
    const access = within(panel).getByRole("region", { name: "Access without a secret" });
    expect(within(access).getByText(/corp\.local\\alice/)).toBeInTheDocument();
    expect(within(access).getByText("admin")).toBeInTheDocument();
    expect(within(access).getByText("via webshell")).toBeInTheDocument();
    expect(within(access).queryByText(/via rdp/)).not.toBeInTheDocument();
    await user.click(within(access).getByRole("button", { name: "Remove access as corp.local\\alice on dc01" }));
    await user.click(await screen.findByRole("button", { name: "Remove access" }));
    await vi.waitFor(() => expect(m.accessGrantDelete).toHaveBeenCalledWith("g1"));

    // add access on this host
    await user.click(within(access).getByRole("button", { name: "Add access" }));
    const dialog = await screen.findByRole("dialog", { name: "Add access on dc01" });
    await user.click(within(dialog).getByRole("combobox", { name: "Username" }));
    await user.click(await screen.findByRole("option", { name: "corp.local\\alice" }));
    await user.type(within(dialog).getByLabelText("Access via"), "psexec");
    await user.click(within(dialog).getByRole("button", { name: "Add access" }));
    await vi.waitFor(() =>
      expect(m.accessGrantCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ usernameId: "uAlice", hostId: "h1", level: "user", via: "psexec" })),
    );

    // results against this host, with proof
    const results = within(panel).getByRole("region", { name: "Results against this host" });
    const rows = within(results).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("corp.local\\bob")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("admin")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/corp\.local\\alice/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText("STATUS_LOGON_FAILURE")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("no proof")).toBeInTheDocument();
    // result chips: accent for access that works, warn for errored
    expect(within(rows[0]!).getByText("admin")).toHaveAttribute("data-variant", "accent");
    const errored = within(rows[2]!).getByText("errored");
    expect(errored).toHaveAttribute("data-variant", "warn");
    expect(errored).toHaveClass("chip--warn");
    await user.click(within(rows[0]!).getByRole("button", { name: /nxc smb spray/ }));
    expect(screen.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: /nxc smb spray/, expanded: true })).toBeInTheDocument();
  });

  it("a password reuse result reads as reuse, with no OTHER service", async () => {
    setupBackend({
      attempts: [
        {
          id: "r1", engagementId: "e1", credId: "cBob", usernameId: null, hostId: "h1", service: "other", port: null,
          result: "valid", authMode: "local", detail: "password reuse", logEntryId: null, at: 5000,
        },
      ],
    });
    mount("/e/e1/h/h1");
    const panel = await screen.findByRole("region", { name: "Host Credentials" });
    const results = await within(panel).findByRole("region", { name: "Results against this host" });
    const [row] = within(results).getAllByRole("listitem");
    expect(within(row!).getByText("password reuse")).toBeInTheDocument();
    expect(row!.textContent).toBe("corp.local\\bobvalidpassword reuseno proof");
  });
});
