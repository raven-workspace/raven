import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { AccessGrant, Credential, CredentialInput, Username } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "enumerate", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};

const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});

// A tiny in-memory store behind the mocked api.
let creds: Credential[];
let users: Username[];
let grants: AccessGrant[];
let seq: number;

function toCred(input: CredentialInput): Credential {
  return cred({
    id: `c${++seq}`, type: input.type, username: input.username ?? "", domain: input.domain ?? null, secret: input.secret ?? "",
    hashType: input.hashType ?? null, scope: input.scope ?? "domain", localHostId: input.localHostId ?? null,
    crackStatus: input.type === "hash" ? "uncracked" : null,
  });
}

function mount(seed: { creds?: Credential[]; users?: Username[] } = {}) {
  creds = seed.creds ?? [];
  users = seed.users ?? [];
  grants = [];
  seq = 100;
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.credentialsList.mockImplementation(async () => [...creds]);
  m.usernamesList.mockImplementation(async () => [...users]);
  m.accessGrantsList.mockImplementation(async () => [...grants]);
  m.credAttemptsList.mockResolvedValue([]);
  m.credentialCreate.mockImplementation(async (_e, input) => {
    const c = toCred(input);
    creds.push(c);
    return c;
  });
  m.credentialDelete.mockImplementation(async (id) => {
    creds = creds.filter((c) => c.id !== id);
    return null;
  });
  m.credentialCrack.mockImplementation(async (hashId, plaintext) => {
    const p = cred({ id: `c${++seq}`, username: creds.find((c) => c.id === hashId)!.username, domain: creds.find((c) => c.id === hashId)!.domain, secret: plaintext, crackedFrom: hashId });
    creds.push(p);
    return p;
  });
  m.credentialConvertToAccess.mockImplementation(async (credId, grant) => {
    const c = creds.find((x) => x.id === credId)!;
    creds = creds.filter((x) => x.id !== credId);
    const u: Username = { id: "u9", engagementId: "e1", username: c.username, domain: c.domain, sourceHostId: null, source: null, createdAt: 1 };
    users.push(u);
    grants.push({ id: "g1", engagementId: "e1", usernameId: u.id, hostId: grant.hostId, level: grant.level, via: grant.via, logEntryId: null, at: 1 });
    return u;
  });
  m.usernameCreate.mockImplementation(async (_e, input) => {
    const u: Username = { id: `u${++seq}`, engagementId: "e1", username: input.username, domain: input.domain ?? null, sourceHostId: null, source: null, createdAt: 1 };
    users.push(u);
    return u;
  });
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/s/credentials"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
});

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Add credential" }));
  return await screen.findByRole("dialog");
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(within(screen.getByRole("dialog")).getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("credentials section", () => {
  it("adding a password credential lists it masked; Reveal shows it; Copy copies without revealing", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openForm(user);
    await user.type(within(dlg).getByLabelText("Username"), "jsmith");
    await user.type(within(dlg).getByLabelText("Domain"), "CORP");
    await user.type(within(dlg).getByLabelText("Secret"), "Winter2024!");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));

    // The test grid and routine picker also name the credential; the list row is the one in a <tr> with a Delete button.
    const row = (await screen.findAllByText("CORP\\jsmith")).map((e) => e.closest("tr")).find((r) => r?.querySelector("[aria-label^=Delete]"))!;
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ username: "jsmith", domain: "CORP", secret: "Winter2024!", type: "password" }));
    expect(within(row).getByText("••••••••")).toBeInTheDocument();
    expect(screen.queryByText("Winter2024!")).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /^Copy secret/ }));
    expect(await navigator.clipboard.readText()).toBe("Winter2024!");
    expect(screen.queryByText("Winter2024!")).not.toBeInTheDocument();

    const reveal = within(row).getByRole("button", { name: /^Reveal secret/ });
    expect(reveal).toHaveAttribute("aria-pressed", "false");
    await user.click(reveal);
    expect(reveal).toHaveAttribute("aria-pressed", "true");
    expect(within(row).getByText("Winter2024!")).toBeInTheDocument();
  });

  it("an ownerless secret shows owner unknown", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openForm(user);
    await user.click(within(dlg).getByRole("button", { name: "A secret, owner unknown" }));
    expect(within(dlg).queryByLabelText("Username")).not.toBeInTheDocument();
    await user.type(within(dlg).getByLabelText("Secret"), "Spring2024!");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    expect(await screen.findByText("owner unknown")).toBeInTheDocument();
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ username: "", secret: "Spring2024!" }));
    expect(screen.getByText("no user matched yet")).toBeInTheDocument();
  });

  it("shows matched users for an owner-unknown secret", async () => {
    mount({ creds: [cred({ id: "s1", secret: "x1" }), cred({ id: "c1", username: "bob", domain: "CORP", secret: "x1", fromSecretId: "s1" })] });
    expect(await screen.findByText("matched: CORP\\bob")).toBeInTheDocument();
  });

  it("local scope requires a host", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openForm(user);
    await user.type(within(dlg).getByLabelText("Username"), "administrator");
    await user.type(within(dlg).getByLabelText("Secret"), "Passw0rd!");
    await pick(user, "Scope", "Local");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    expect(await within(dlg).findByText("Pick the host this local account belongs to")).toBeInTheDocument();
    expect(m.credentialCreate).not.toHaveBeenCalled();

    await pick(user, "Local host", "dc01");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ scope: "local", localHostId: "h1" })));
  });

  it("offers the existing credential instead of creating a duplicate", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!" })] });
    const dlg = await openForm(user);
    await user.type(within(dlg).getByLabelText("Username"), "jsmith");
    await user.type(within(dlg).getByLabelText("Domain"), "CORP");
    await user.type(within(dlg).getByLabelText("Secret"), "Winter2024!");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    expect(await within(dlg).findByText("Already recorded: CORP\\jsmith")).toBeInTheDocument();
    expect(m.credentialCreate).not.toHaveBeenCalled();
    await user.click(within(dlg).getByRole("button", { name: "Use existing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a username with access creates both", async () => {
    const user = userEvent.setup();
    m.accessGrantCreate.mockResolvedValue({} as AccessGrant);
    mount();
    const dlg = await openForm(user);
    await user.click(within(dlg).getByRole("button", { name: "A username with access" }));
    await user.type(within(dlg).getByLabelText("Username"), "CORP\\svc");
    await pick(user, "Access on host", "dc01");
    await user.type(within(dlg).getByLabelText("Access via"), "webshell");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(m.accessGrantCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ hostId: "h1", level: "user", via: "webshell" })));
    expect(m.usernameCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ username: "svc", domain: "CORP" }));
  });

  it("cracking a hash adds the linked password and folds the hash", async () => {
    const user = userEvent.setup();
    const hash = "8846f7eaee8fb117ad06bdd830b7586c";
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", domain: "CORP", secret: hash, hashType: "NTLM", crackStatus: "uncracked" })] });
    const list = await screen.findByRole("region", { name: "Hashes" });
    expect(within(list).getByText(/hashcat -m 1000/)).toBeInTheDocument();
    expect(within(list).queryByText(new RegExp(hash))).not.toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Crack CORP\\jsmith (hash)" }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("Plaintext"), "password");
    await user.click(within(dlg).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(m.credentialCrack).toHaveBeenCalledWith("h", "password"));
    await waitFor(() => expect(screen.queryByText(/\(hash\)/)).not.toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("CORP\\jsmith")).toBeInTheDocument();
  });

  it("marks a hash uncrackable", async () => {
    const user = userEvent.setup();
    m.credentialSetCrackStatus.mockResolvedValue(cred({ id: "h" }));
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret: "8846f7eaee8fb117ad06bdd830b7586c", crackStatus: "uncracked" })] });
    const list = await screen.findByRole("region", { name: "Hashes" });
    await user.click(within(list).getByRole("button", { name: "Mark jsmith (hash) uncrackable" }));
    expect(m.credentialSetCrackStatus).toHaveBeenCalledWith("h", "uncrackable");
  });

  it("convert a placeholder credential to access-only", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "guest", domain: "CORP", secret: "none" }), cred({ id: "c2", username: "real", secret: "pw" })] });
    expect((await screen.findAllByText("CORP\\guest")).length).toBeGreaterThan(0);
    // Only the placeholder offers conversion.
    expect(screen.getAllByRole("button", { name: /to access-only$/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Convert CORP\\guest to access-only" }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Convert" }));
    expect(await within(dlg).findByText("Choose a host")).toBeInTheDocument();
    expect(m.credentialConvertToAccess).not.toHaveBeenCalled();
    await pick(user, "Access on host", "dc01");
    await pick(user, "Access level", "admin");
    await user.type(within(dlg).getByLabelText("Access via"), "null session");
    await user.click(within(dlg).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(m.credentialConvertToAccess).toHaveBeenCalledWith("c1", { hostId: "h1", level: "admin", via: "null session" }));
    // The credential leaves the table; the username carries the access.
    const usersRegion = await screen.findByRole("region", { name: "Usernames" });
    expect(await within(usersRegion).findByText(/admin on dc01/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to access-only$/ })).not.toBeInTheDocument();
  });

  it("usernames accept DOMAIN\\user and reject duplicates", async () => {
    const user = userEvent.setup();
    mount();
    const region = await screen.findByRole("region", { name: "Usernames" });
    await user.type(within(region).getByLabelText("New username"), "CORP\\alice");
    await user.click(within(region).getByRole("button", { name: "Add username" }));
    expect(m.usernameCreate).toHaveBeenCalledWith("e1", { username: "alice", domain: "CORP" });
    expect(await within(region).findByText("CORP\\alice")).toBeInTheDocument();

    await user.type(within(region).getByLabelText("New username"), "corp\\ALICE");
    await user.click(within(region).getByRole("button", { name: "Add username" }));
    expect(await within(region).findByText("corp\\ALICE is already listed")).toBeInTheDocument();
    expect(m.usernameCreate).toHaveBeenCalledTimes(1);

    await user.click(within(region).getByRole("button", { name: "Copy all" }));
    expect(await navigator.clipboard.readText()).toBe("alice");
  });

  it("delete asks first and removes the credential", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "pw" })] });
    await user.click(await screen.findByRole("button", { name: "Delete CORP\\jsmith" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveAccessibleDescription("Its test results in the matrix go with it.");
    expect(m.credentialDelete).not.toHaveBeenCalled();
    await user.click(within(dlg).getByRole("button", { name: "Delete credential" }));
    await waitFor(() => expect(m.credentialDelete).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByText("CORP\\jsmith")).not.toBeInTheDocument());
  });

  it("username delete confirm says its results and grants go with it", async () => {
    const user = userEvent.setup();
    mount({ users: [{ id: "u1", engagementId: "e1", username: "alice", domain: "CORP", sourceHostId: null, source: null, createdAt: 1 }] });
    await user.click(await screen.findByRole("button", { name: "Delete username CORP\\alice" }));
    const dlg = await screen.findByRole("dialog", { name: "Delete username CORP\\alice?" });
    expect(dlg).toHaveAccessibleDescription("Its test results in the matrix and its access grants go with it.");
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(m.usernameDelete).not.toHaveBeenCalled();
  });

  it("editing only the notes keeps every field the form does not show", async () => {
    const user = userEvent.setup();
    // Same merge as Rust `update`: sourceHostId, crackedFrom and fromSecretId keep their value when absent.
    m.credentialUpdate.mockImplementation(async (id, input) => {
      const old = creds.find((c) => c.id === id)!;
      const next: Credential = {
        ...old, type: input.type, username: input.username ?? "", domain: input.domain ?? null, secret: input.secret ?? "",
        hashType: input.hashType ?? null, scope: input.scope ?? "domain", localHostId: input.localHostId ?? null,
        source: input.source ?? null, notes: input.notes ?? null,
        sourceHostId: input.sourceHostId ?? old.sourceHostId,
        crackedFrom: input.crackedFrom ?? old.crackedFrom, fromSecretId: input.fromSecretId ?? old.fromSecretId,
      };
      creds = creds.map((c) => (c.id === id ? next : c));
      return next;
    });
    const hash = cred({
      id: "c1", type: "hash", username: "svc", domain: "CORP", secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "MD5",
      scope: "local", localHostId: "h1", sourceHostId: "h1", source: "sam dump", crackStatus: "uncracked",
    });
    const pw = cred({
      id: "c2", username: "bob", domain: "CORP", secret: "Winter2024!", sourceHostId: "h1", source: "lsass",
      crackedFrom: "c3", fromSecretId: "c4",
    });
    // c3 is the hash bob's password was cracked from (folded away); c4 the ownerless secret it matched.
    const parent = cred({ id: "c3", type: "hash", username: "bob", domain: "CORP", secret: "aa".repeat(16), crackStatus: "cracked" });
    const secret = cred({ id: "c4", secret: "Winter2024!" });
    mount({ creds: [hash, pw, parent, secret] });
    for (const [label, before] of [["Edit CORP\\svc (hash)", hash], ["Edit CORP\\bob", pw]] as const) {
      await user.click(await screen.findByRole("button", { name: label }));
      const dlg = await screen.findByRole("dialog");
      await user.type(within(dlg).getByLabelText("Notes"), "checked");
      await user.click(within(dlg).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      const after = creds.find((c) => c.id === before.id)!;
      expect(after).toEqual({ ...before, notes: "checked" });
    }
    expect(m.credentialUpdate).toHaveBeenCalledWith("c2", expect.objectContaining({ sourceHostId: "h1", source: "lsass" }));
    expect(m.credentialUpdate.mock.calls[1][1]).not.toHaveProperty("crackedFrom");
  });

  it("crack commands follow the stored hash type", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "MD5", crackStatus: "uncracked" })] });
    const list = await screen.findByRole("region", { name: "Hashes" });
    expect(within(list).getByText(/hashcat -m 0 /)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Copy hashcat command" }));
    expect(await navigator.clipboard.readText()).toBe("hashcat -m 0 '8846f7eaee8fb117ad06bdd830b7586c' /usr/share/wordlists/rockyou.txt");
  });

  it("a hash containing a quote is never in the DOM unrevealed", async () => {
    const secret = "$6$sa'lt$abcdefgh";
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret, crackStatus: "uncracked" })] });
    const list = await screen.findByRole("region", { name: "Hashes" });
    expect(within(list).getByText(/hashcat -m 1800/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sa'lt");
    expect(document.body.textContent).not.toContain("abcdefgh");
  });

  it("mark uncrackable updates the chip and Reset restores it", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret: "8846f7eaee8fb117ad06bdd830b7586c", crackStatus: "uncracked" })] });
    m.credentialSetCrackStatus.mockImplementation(async (id, status) => {
      creds = creds.map((c) => (c.id === id ? { ...c, crackStatus: status } : c));
      return creds.find((c) => c.id === id)!;
    });
    const list = await screen.findByRole("region", { name: "Hashes" });
    await user.click(within(list).getByRole("button", { name: "Mark jsmith (hash) uncrackable" }));
    expect(await within(list).findByText("uncrackable")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Reset jsmith (hash)" }));
    expect(await within(list).findByText("uncracked")).toBeInTheDocument();
    expect(m.credentialSetCrackStatus).toHaveBeenLastCalledWith("h", "uncracked");
  });

  it("shows an error when marking uncrackable fails", async () => {
    const user = userEvent.setup();
    m.credentialSetCrackStatus.mockRejectedValue(new Error("write failed"));
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret: "8846f7eaee8fb117ad06bdd830b7586c", crackStatus: "uncracked" })] });
    const list = await screen.findByRole("region", { name: "Hashes" });
    await user.click(within(list).getByRole("button", { name: "Mark jsmith (hash) uncrackable" }));
    expect(await within(list).findByRole("alert")).toHaveTextContent("write failed");
  });

  it("Edit opens the form pre-filled with the secret hidden", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!" })] });
    await user.click(await screen.findByRole("button", { name: "Edit CORP\\jsmith" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByLabelText("Username")).toHaveValue("jsmith");
    const secret = within(dlg).getByLabelText("Secret");
    expect(secret).toHaveValue("Winter2024!");
    expect(secret).toHaveAttribute("type", "password");
    expect(dlg.textContent).not.toContain("Winter2024!");
  });

  it("editing into another credential shows the collision instead of saving", async () => {
    const user = userEvent.setup();
    m.credentialUpdate.mockResolvedValue(cred({ id: "c2" }));
    mount({ creds: [
      cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!" }),
      cred({ id: "c2", username: "jsmith", domain: "CORP", secret: "Other2024!" }),
    ] });
    const rows = await screen.findAllByRole("button", { name: "Edit CORP\\jsmith" });
    await user.click(rows[1]);
    const dlg = await screen.findByRole("dialog");
    const secret = within(dlg).getByLabelText("Secret");
    await user.clear(secret);
    await user.type(secret, "Winter2024!");
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("Already recorded: CORP\\jsmith")).toBeInTheDocument();
    expect(m.credentialUpdate).not.toHaveBeenCalled();
  });
});
