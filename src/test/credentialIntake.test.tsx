import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { credKey } from "../engines/credentials";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { AccessGrant, CredAttempt, CredAttemptInput, Credential, CredentialInput, Username } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry, LogEntryInput } from "../types/log";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: "Kali (VM)", msfHostId: null,
};
const host = (over: Partial<Host> & Pick<Host, "id" | "name">): Host => ({
  engagementId: "e1", ip: null, os: "windows", boardColumn: "vulnerability-detection", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const H1 = host({ id: "h1", name: "dc01", ip: "10.10.10.5" });
const H2 = host({ id: "h2", name: "web02", ip: "10.10.10.6" });
const smb = (id: string, hostId: string): Service => ({
  id, hostId, port: 445, protocol: "tcp", state: "open", nmapService: "microsoft-ds", nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1,
});
const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const uname = (o: Partial<Username> & { id: string; username: string }): Username => ({
  engagementId: "e1", domain: null, sourceHostId: null, source: null, createdAt: 1, ...o,
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
    ...structuredClone(seed),
  };
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
      sourceHostId: input.sourceHostId ?? null, source: input.source ?? null, createdAt: seq,
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
    // Rust's safety net: the plain key returns the existing row.
    const found = db.credentials.find((x) => x.secret && credKey(x) === credKey(c) && x.localHostId === c.localHostId);
    if (found) return found;
    db.credentials.push(c);
    return c;
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
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1, H2]);
  m.servicesList.mockResolvedValue([smb("s1", "h1")]);
  m.servicesListEngagement.mockResolvedValue([smb("s1", "h1"), smb("s2", "h2")]);
  m.servicesUpsertScan.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistApplyFacts.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
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

async function openCapture(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("region", { name: "Vulnerability detection" });
  await user.keyboard("l");
  return screen.findByRole("dialog", { name: "Add to log" });
}

async function pasteAndWait(user: ReturnType<typeof userEvent.setup>, text: string) {
  const dialog = await openCapture(user);
  await user.paste(text);
  const intake = await within(dialog).findByRole("region", { name: "Credentials from this output" });
  return { dialog, intake };
}

async function save(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: /^Save/ }));
}

const SPRAY = [
  "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.6 -u bob -p 'Pass1' --continue-on-success",
  "SMB  10.10.10.5  445  DC01   [+] corp.local\\bob:Pass1 (Pwn3d!)",
  "SMB  10.10.10.6  445  WEB02  [-] corp.local\\bob:Pass1 STATUS_LOGON_FAILURE",
  "SMB  10.10.10.5  445  DC01   [+] corp.local\\drew:Fresh1",
  "SMB  10.10.10.6  445  WEB02  [-] corp.local\\eve:Nope1 STATUS_LOGON_FAILURE",
  "SMB  10.10.10.99 445  GHOST  [+] corp.local\\bob:Pass1",
].join("\n");

describe("nxc intake in Add to log", () => {
  it("pasting nxc output shows the intake summary and pending credentials", async () => {
    const user = userEvent.setup();
    mount();
    const { intake } = await pasteAndWait(user, SPRAY);
    expect(
      await within(intake).findByText("nxc: 1 admin · 1 valid · 1 failed · 0 errored · 1 unknown hosts · 1 unrecorded"),
    ).toBeInTheDocument();
    // a success is offered and on; a failed-only pair is named but off
    expect(within(intake).getByRole("button", { name: "Add corp.local\\drew" })).toHaveAttribute("aria-pressed", "true");
    expect(within(intake).getByRole("button", { name: "Add corp.local\\eve with a password on web02" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(intake).getByText(/10\.10\.10\.99/)).toBeInTheDocument();
    // no secret from the paste shows in the preview (T8-R2)
    for (const secret of ["Pass1", "Fresh1", "Nope1"]) expect(intake.textContent).not.toContain(secret);
    // nothing is written before Save
    expect(m.credentialCreate).not.toHaveBeenCalled();
    expect(m.credAttemptsUpsert).not.toHaveBeenCalled();
  });

  it("a failed-only hash pair is named without any fragment of the hash", async () => {
    const nt = "0123456789abcdef0123456789abcdef";
    const user = userEvent.setup();
    mount();
    const { intake } = await pasteAndWait(
      user,
      [`kali@kali:~$ nxc smb 10.10.10.6 -u eve -H ${nt}`, `SMB  10.10.10.6  445  WEB02  [-] corp.local\\eve:${nt} STATUS_LOGON_FAILURE`].join("\n"),
    );
    expect(await within(intake).findByRole("button", { name: "Add corp.local\\eve with a hash on web02" })).toHaveAttribute("aria-pressed", "false");
    for (let i = 0; i + 6 <= nt.length; i++) expect(intake.textContent).not.toContain(nt.slice(i, i + 6));
  });

  it("a [+] pair on an IP ticked as a new host is offered, and on accept lands on the new host (F-R2)", async () => {
    const H9 = host({ id: "h9", name: "10.10.10.9", ip: "10.10.10.9" });
    m.hostCreate.mockResolvedValue(H9);
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(
      user,
      [
        "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.9 -u bob -p 'Pass'",
        "SMB  10.10.10.5  445  DC01   [-] corp\\bob:Pass STATUS_LOGON_FAILURE",
        "SMB  10.10.10.9  445  NEWBOX [+] corp\\bob:Pass",
      ].join("\n"),
    );
    // Before the IP is ticked the [+] line has no host: only the failed-only pair is named.
    await within(intake).findByText(/10\.10\.10\.9/);
    expect(within(intake).getByRole("button", { name: /^Add corp\\bob/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(dialog).getByRole("button", { name: "+ 10.10.10.9" }));
    // Ticked: the pair is offered (on by default) and the IP is no longer "not recorded".
    const add = await within(dialog).findByRole("button", { name: "Add corp\\bob" });
    expect(add).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).queryByText(/Not recorded/)).not.toBeInTheDocument();
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(m.hostCreate).toHaveBeenCalledWith("e1", { name: "10.10.10.9", ip: "10.10.10.9" });
    const bob = db.credentials.find((c) => c.username === "bob" && c.secret === "Pass")!;
    expect(bob).toMatchObject({ domain: "corp", scope: "domain", sourceHostId: "h9" });
    const entry = db.log[0]!;
    expect(db.attempts.filter((a) => a.credId === bob.id).map((a) => [a.hostId, a.result, a.logEntryId]).sort()).toEqual([
      ["h1", "failed", entry.id],
      ["h9", "valid", entry.id],
    ]);
  });

  it("a local pair on a ticked new host keeps its accept toggle through the save (F-R2)", async () => {
    const H9 = host({ id: "h9", name: "10.10.10.9", ip: "10.10.10.9" });
    m.hostCreate.mockResolvedValue(H9);
    const user = userEvent.setup();
    mount();
    const { dialog } = await pasteAndWait(
      user,
      [
        "kali@kali:~$ nxc smb 10.10.10.9 -u administrator -p 'Local1' --local-auth",
        "SMB  10.10.10.9  445  NEWBOX [+] NEWBOX\\administrator:Local1 (Pwn3d!)",
        "SMB  10.10.10.9  445  NEWBOX [-] NEWBOX\\guest:Local1 STATUS_LOGON_FAILURE",
      ].join("\n"),
    );
    await user.click(within(dialog).getByRole("button", { name: "+ 10.10.10.9" }));
    // The failed-only guest pair is opted in; both keys name the provisional host until the save maps them.
    const guest = await within(dialog).findByRole("button", { name: /^Add guest/ });
    await user.click(guest);
    expect(guest).toHaveAttribute("aria-pressed", "true");
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const made = db.credentials.filter((c) => c.secret === "Local1");
    expect(made.map((c) => [c.username, c.scope, c.localHostId]).sort()).toEqual([
      ["administrator", "local", "h9"],
      ["guest", "local", "h9"],
    ]);
  });

  it("toggles reset when the paste changes", async () => {
    const user = userEvent.setup();
    mount();
    const { intake, dialog } = await pasteAndWait(user, SPRAY);
    const drew = await within(intake).findByRole("button", { name: "Add corp.local\\drew" });
    await user.click(drew);
    expect(drew).toHaveAttribute("aria-pressed", "false");
    await user.type(within(dialog).getByLabelText("Paste"), " ");
    expect(await within(dialog).findByRole("button", { name: "Add corp.local\\drew" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saving applies attempts with the entry as proof and adds accepted credentials", async () => {
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(user, SPRAY);
    await within(intake).findByRole("button", { name: "Add corp.local\\drew" });
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const entry = db.log[0]!;
    // bob's results, with the entry as proof and its time
    const bob = db.attempts.filter((a) => a.credId === "cBob");
    expect(bob.map((a) => [a.hostId, a.result, a.logEntryId, a.at, a.usernameId]).sort()).toEqual([
      ["h1", "admin", entry.id, entry.at, null],
      ["h2", "failed", entry.id, entry.at, null],
    ]);
    // drew accepted: a new credential with its own result; eve (failed only, not accepted) is not added
    const drew = db.credentials.find((c) => c.username === "drew")!;
    expect(drew).toMatchObject({ type: "password", secret: "Fresh1", domain: "corp.local", scope: "domain", sourceHostId: "h1" });
    expect(db.attempts.filter((a) => a.credId === drew.id).map((a) => [a.hostId, a.result, a.logEntryId])).toEqual([
      ["h1", "valid", entry.id],
    ]);
    expect(db.credentials.some((c) => c.username === "eve")).toBe(false);
    // usernames seen in the output are listed
    expect(db.usernames.map((u) => u.username).sort()).toEqual(["alice", "bob", "drew", "eve"]);
    // the unknown host's line is not recorded anywhere
    expect(db.attempts).toHaveLength(3);
  });

  it("a declined pending credential records its username attempts instead", async () => {
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(
      user,
      [
        "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.6 -u users.txt -p 'Pass1' --continue-on-success",
        "SMB  10.10.10.5  445  DC01   [+] corp.local\\alice:Pass1",
        "SMB  10.10.10.6  445  WEB02  [-] corp.local\\alice:Pass1 STATUS_LOGON_FAILURE",
      ].join("\n"),
    );
    await user.click(await within(intake).findByRole("button", { name: "Add corp.local\\alice" }));
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(m.credentialCreate).not.toHaveBeenCalled();
    expect(m.credAttemptsRekey).not.toHaveBeenCalled();
    const entry = db.log[0]!;
    expect(db.attempts.map((a) => [a.credId, a.usernameId, a.hostId, a.result, a.logEntryId]).sort()).toEqual([
      ["cBob", "uAlice", "h1", "valid", entry.id],
      ["cBob", "uAlice", "h2", "failed", entry.id],
    ]);
  });

  it("an accepted username spray re-keys earlier username attempts onto the new credential", async () => {
    setupBackend({
      attempts: [
        {
          id: "aOld", engagementId: "e1", credId: "cBob", usernameId: "uAlice", hostId: "h2", service: "winrm", port: 5985,
          result: "valid", authMode: "domain", detail: null, logEntryId: null, at: 5,
        },
      ],
    });
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(
      user,
      ["kali@kali:~$ nxc smb 10.10.10.5 -u users.txt -p 'Pass1'", "SMB  10.10.10.5  445  DC01   [+] corp.local\\alice:Pass1"].join("\n"),
    );
    await within(intake).findByRole("button", { name: "Add corp.local\\alice" });
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const alice = db.credentials.find((c) => c.username === "alice")!;
    expect(m.credAttemptsRekey).toHaveBeenCalledWith("uAlice", ["cBob"], alice.id, undefined);
    expect(db.attempts.map((a) => [a.credId, a.usernameId, a.hostId, a.service, a.result]).sort()).toEqual([
      [alice.id, null, "h1", "smb", "valid"],
      [alice.id, null, "h2", "winrm", "valid"],
    ]);
  });

  it("a spray hit links the new credential to the owner-less secret via fromSecretId", async () => {
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(
      user,
      ["kali@kali:~$ nxc smb 10.10.10.5 -u users.txt -p 'Spray1'", "SMB  10.10.10.5  445  DC01   [+] corp.local\\frank:Spray1"].join("\n"),
    );
    await within(intake).findByRole("button", { name: "Add corp.local\\frank" });
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const frank = db.credentials.find((c) => c.username === "frank")!;
    expect(frank).toMatchObject({ secret: "Spray1", fromSecretId: "cS" });
    expect(db.attempts.filter((a) => a.credId === frank.id).map((a) => [a.hostId, a.result])).toEqual([["h1", "valid"]]);
  });

  it("an accepted credential that duplicates a stored one reuses it and fills fromSecretId", async () => {
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(
      user,
      ["kali@kali:~$ nxc smb 10.10.10.5 -u users.txt -p 'Spray1'", "SMB  10.10.10.5  445  DC01   [+] corp.local\\alice:Spray1"].join("\n"),
    );
    await within(intake).findByRole("button", { name: "Add corp.local\\alice" });
    // Stored meanwhile (another window, a retry): the panel's list doesn't have it yet.
    db.credentials.push(cred({ id: "cAlice", username: "alice", domain: "corp.local", secret: "Spray1" }));
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(m.credentialCreate).not.toHaveBeenCalled();
    expect(db.credentials.filter((c) => c.username === "alice")).toHaveLength(1);
    expect(db.credentials.find((c) => c.id === "cAlice")!.fromSecretId).toBe("cS");
    expect(db.attempts.map((a) => [a.credId, a.usernameId, a.hostId, a.result])).toEqual([["cAlice", null, "h1", "valid"]]);
  });

  it("saving the same output twice adds nothing new", async () => {
    const TGS = "$krb5tgs$23$*svc$CORP.LOCAL$MSSQL/db*$aabbccdd$eeff0011";
    const output = [
      "kali@kali:~$ nxc smb 10.10.10.5 10.10.10.6 -u users.txt -p 'Pass1' --continue-on-success",
      "SMB  10.10.10.5  445  DC01   [+] corp.local\\alice:Pass1 (Pwn3d!)",
      "SMB  10.10.10.6  445  WEB02  [-] corp.local\\alice:Pass1 STATUS_LOGON_FAILURE",
      "SMB  10.10.10.5  445  DC01   [+] corp.local\\frank:Spray1",
      "SMB  10.10.10.5  445  DC01   [-] corp.local\\carol:Pass1 STATUS_LOGON_FAILURE",
      "SMB  10.10.10.5  445  DC01   [+] corp.local\\drew:Fresh1",
      "SMB  10.10.10.6  445  WEB02  [-] corp.local\\drew:Fresh1 STATUS_LOGON_FAILURE",
      "SMB  10.10.10.6  445  WEB02  [-] corp.local\\eve:Nope1 STATUS_LOGON_FAILURE",
      "SMB  10.10.10.6  445  WEB02  [-] corp.local\\bob:Pass1 STATUS_ACCOUNT_LOCKED_OUT",
      `LDAP  10.10.10.5  389  DC01   ${TGS}`,
    ].join("\n");
    const user = userEvent.setup();
    mount();

    let { dialog, intake } = await pasteAndWait(user, output);
    await within(intake).findByRole("button", { name: "Add corp.local\\frank" });
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // sanity: the first save really added credentials, usernames, a hash and attempts
    expect(db.credentials.map((c) => c.username).sort()).toEqual(["", "alice", "bob", "drew", "frank", "svc"]);
    expect(db.credentials.find((c) => c.username === "svc")).toMatchObject({ type: "hash", crackStatus: "uncracked" });
    expect(db.credentials.find((c) => c.username === "svc")!.hashType).toBeTruthy();
    expect(db.usernames.length).toBeGreaterThan(1);
    expect(db.attempts.length).toBeGreaterThan(0);
    const before = structuredClone({ credentials: db.credentials, usernames: db.usernames, attempts: db.attempts });
    vi.mocked(m.credentialCreate).mockClear();
    vi.mocked(m.usernameCreate).mockClear();

    ({ dialog, intake } = await pasteAndWait(user, output));
    // only the failed-only pair is still offered, and it is off
    const offered = await within(intake).findAllByRole("button", { name: /^Add / });
    expect(offered.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["Add corp.local\\eve with a password on web02", "false"],
    ]);
    await save(user, dialog);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(db.log).toHaveLength(2);
    expect(m.credentialCreate).not.toHaveBeenCalled();
    expect(db.credentials).toEqual(before.credentials);
    expect(db.usernames).toEqual(before.usernames);
    // No attempt is added and no result changes. (By the store's merge rule a same-result upsert from the later
    // entry moves the proof link to it; that is the only difference.)
    const shape = (a: CredAttempt) => ({ ...a, logEntryId: undefined, at: undefined });
    expect(db.attempts.map(shape)).toEqual(before.attempts.map(shape));
  });

  it("intake failure shows the partial-save message and the entry stays", async () => {
    m.credAttemptsUpsert.mockRejectedValue(new Error("disk full"));
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(user, SPRAY);
    await within(intake).findByRole("button", { name: "Add corp.local\\drew" });
    await save(user, dialog);
    expect(await within(dialog).findByText("Saved the entry, but the credentials didn't update. Paste the output again to retry.")).toBeInTheDocument();
    expect(m.logCreate).toHaveBeenCalledTimes(1);
    expect(m.logDelete).not.toHaveBeenCalled();
    expect(db.log).toHaveLength(1);
    // the draft is gone, so Save can't create the entry twice
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("");
  });

  it("an intake failure and a checklist failure read as one message", async () => {
    m.credAttemptsUpsert.mockRejectedValue(new Error("disk full"));
    m.checklistPut.mockRejectedValue(new Error("nope"));
    m.checklistList.mockRejectedValue(new Error("nope"));
    const user = userEvent.setup();
    mount();
    const { dialog, intake } = await pasteAndWait(user, SPRAY);
    await within(intake).findByRole("button", { name: "Add corp.local\\drew" });
    await save(user, dialog);
    expect(
      await within(dialog).findByText(
        "Saved the entry, but the credentials didn't update. Paste the output again to retry. The checklist didn't update either: use Tick from log on the Engagement checklist.",
      ),
    ).toBeInTheDocument();
  });
});

describe("host Credentials tab", () => {
  it("host Credentials tab lists grants and results with proof links", async () => {
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
    await user.click(await screen.findByRole("tab", { name: "Credentials" }));
    const panel = screen.getByRole("tabpanel");

    // the matrix shows only this host's column
    expect(await within(panel).findByRole("button", { name: "corp.local\\bob on dc01 SMB: admin" })).toBeInTheDocument();
    expect(within(panel).queryByText(/web02/)).not.toBeInTheDocument();
    // the secret stays masked
    expect(within(panel).queryByText("Pass1")).not.toBeInTheDocument();

    // grants on this host only, removable
    const access = within(panel).getByRole("region", { name: "Access without a secret" });
    expect(within(access).getByText(/corp\.local\\alice/)).toBeInTheDocument();
    expect(within(access).getByText(/admin · via webshell/)).toBeInTheDocument();
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
    const rows = within(results).getAllByRole("row").slice(1);
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
    expect(errored).toHaveClass("border-warn", "text-warn");
    expect(errored).not.toHaveClass("text-fg-2");
    await user.click(within(rows[0]!).getByRole("button", { name: /nxc smb spray/ }));
    expect(screen.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: /nxc smb spray/, expanded: true })).toBeInTheDocument();
  });
});
