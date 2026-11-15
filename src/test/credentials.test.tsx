import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { AccessGrant, Credential, CredentialInput, Username } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
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

const svc = (id: string, port: number, nmapService: string): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});
const SMB = [svc("s1", 445, "microsoft-ds")];

/** The router's search string, so tests can read what the section wrote to the URL. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}
const search = () => new URLSearchParams(screen.getByTestId("location").textContent ?? "");

function mount(seed: { creds?: Credential[]; users?: Username[]; services?: Service[]; url?: string } = {}) {
  creds = seed.creds ?? [];
  users = seed.users ?? [];
  grants = [];
  seq = 100;
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue(seed.services ?? []);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.credentialsList.mockImplementation(async () => [...creds]);
  m.usernamesList.mockImplementation(async () => [...users]);
  m.accessGrantsList.mockImplementation(async () => [...grants]);
  m.credAttemptsList.mockResolvedValue([]);
  m.triedPairsList.mockResolvedValue([]);
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
      <MemoryRouter initialEntries={[seed.url ?? "/e/e1/s/credentials"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [] });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
});

/** The text button; the Plus icon button only shows under 560px of section (both are in jsdom's DOM). */
const addButton = async () => (await screen.findAllByRole("button", { name: "Add credential" }))[0];

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await addButton());
  return await screen.findByRole("dialog");
}

/** The docked credential. */
const findDock = () => screen.findByRole("region", { name: "Credential" });
/** The dock's header row: name, secret and the icon actions. */
const findDockHeader = async () => within(await findDock()).getByTestId("dock-header");

async function openInventory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: /^Inventory/ }));
}

/** Selects a credential by its inventory row (the nth row whose name is `title`) and returns the dock. */
async function selectInInventory(user: ReturnType<typeof userEvent.setup>, title: string, nth = 0) {
  await openInventory(user);
  const rows = (await screen.findAllByTitle(title)).map((e) => e.closest("tr")).filter((r) => r?.hasAttribute("data-cred-row"));
  await user.click(rows[nth]!);
  return await findDock();
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(within(screen.getByRole("dialog")).getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** A command's tokens are separate spans, so match the <code> element by its whole text. */
const codeMatching = (re: RegExp) => (_: string, el: Element | null) => el?.tagName === "CODE" && re.test(el.textContent ?? "");

describe("credentials section", () => {
  it("credentials section shows a retry on load failure", async () => {
    const user = userEvent.setup();
    mount();
    // The first load fails (the query runs after the vault check, so this lands before it); Retry loads.
    m.credentialsList.mockRejectedValueOnce(new Error("disk said no"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load credentials");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await addButton()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adding a password credential lists it masked; Reveal shows it; Copy copies without revealing", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openForm(user);
    await user.type(within(dlg).getByLabelText("Username"), "jsmith");
    await user.type(within(dlg).getByLabelText("Domain"), "CORP");
    await user.type(within(dlg).getByLabelText("Secret"), "Winter2024!");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));

    // The new credential is the only one, so it is docked; its secret sits in the dock header.
    await within(await findDock()).findByTitle("CORP\\jsmith");
    const row = await findDockHeader();
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ username: "jsmith", domain: "CORP", secret: "Winter2024!", type: "password" }));
    expect(within(row).getByText("••••••••")).toBeInTheDocument();
    expect(screen.queryByText("Winter2024!")).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /^Copy secret/ }));
    expect(await navigator.clipboard.readText()).toBe("Winter2024!");
    expect(screen.queryByText("Winter2024!")).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /^Reveal secret/ }));
    expect(within(row).getByRole("button", { name: /^Hide secret/ })).toBeInTheDocument();
    expect(within(row).getByText("Winter2024!")).toBeInTheDocument();
  });

  it("a credential just added is docked and written to ?cred=", async () => {
    const user = userEvent.setup();
    mount({ creds: [pw(1), pw(2)], services: SMB });
    await findDock();
    const dlg = await openForm(user);
    await user.type(within(dlg).getByLabelText("Username"), "newbie");
    await user.type(within(dlg).getByLabelText("Secret"), "Fresh2024!");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(search().get("cred")).toBe("c101"));
    expect(await within(dock()).findByRole("button", { name: "Edit newbie" })).toBeInTheDocument();
  });

  it("secret mask never wraps and reveal is an eye icon button", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!" })] });
    const row = await findDockHeader();
    const mask = within(row).getByTestId("secret-text");
    expect(mask.textContent).toBe("••••••••");
    expect(mask.className).toMatch(/whitespace-nowrap/);
    expect(mask.className).not.toMatch(/break-all/);
    const reveal = within(row).getByRole("button", { name: /^Reveal secret/ });
    expect(within(row).queryByText("Reveal")).not.toBeInTheDocument();
    await user.click(reveal);
    expect(within(row).getByRole("button", { name: /^Hide secret/ })).toBeInTheDocument();
    expect(mask.textContent).toBe("Winter2024!");
  });

  it("delete is muted at rest", async () => {
    mount({ creds: [cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!" })] });
    const del = await within(await findDock()).findByRole("button", { name: "Delete CORP\\jsmith" });
    expect(del.className).toMatch(/text-muted/);
    expect(del.className).not.toMatch(/(^|\s)text-warn/);
  });

  it("a 60-character credential name truncates and the actions stay visible", async () => {
    const long = "a".repeat(60);
    mount({ creds: [cred({ id: "c1", username: long, secret: "Winter2024!" })] });
    const dock = await findDock();
    const name = within(dock).getByTitle(long);
    expect(name).toHaveTextContent(long);
    expect(name.className).toMatch(/truncate/);
    expect(within(dock).getByRole("button", { name: `Delete ${long}` })).toBeVisible();
  });

  it("credentials list shows a Machine accounts group", async () => {
    const user = userEvent.setup();
    mount({
      creds: [
        cred({ id: "c1", username: "DC01$", domain: "CORP", secret: "x9f3kq2m" }),
        cred({ id: "c2", username: "jay", domain: "CORP", secret: "Winter2024!" }),
      ],
    });
    await openInventory(user);
    const people = await screen.findByRole("region", { name: "Passwords" });
    const machines = screen.getByRole("region", { name: "Machine accounts" });
    expect(within(people).getByTitle("CORP\\jay")).toBeInTheDocument();
    expect(within(people).queryByTitle("CORP\\DC01$")).not.toBeInTheDocument();
    expect(within(machines).getByTitle("CORP\\DC01$")).toBeInTheDocument();
    expect(people.compareDocumentPosition(machines) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("an ownerless secret shows owner unknown", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openForm(user);
    await user.click(within(dlg).getByRole("button", { name: "A secret, owner unknown" }));
    expect(within(dlg).queryByLabelText("Username")).not.toBeInTheDocument();
    await user.type(within(dlg).getByLabelText("Secret"), "Spring2024!");
    await user.click(within(dlg).getByRole("button", { name: "Add" }));
    await findDock();
    expect(m.credentialCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ username: "", secret: "Spring2024!" }));
    await openInventory(user);
    const list = await screen.findByRole("region", { name: "Passwords" });
    expect(within(list).getByText("owner unknown")).toBeInTheDocument();
    expect(within(list).getByText("no user matched yet")).toBeInTheDocument();
  });

  it("shows matched users for an owner-unknown secret", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "s1", secret: "x1" }), cred({ id: "c1", username: "bob", domain: "CORP", secret: "x1", fromSecretId: "s1" })] });
    await openInventory(user);
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
    // The hash is the only credential, so it is docked on its Crack tab.
    const list = await findDock();
    expect(within(list).getByText(codeMatching(/hashcat -m 1000/))).toBeInTheDocument();
    expect(within(list).queryByText(new RegExp(hash))).not.toBeInTheDocument();
    // Commands wrap at whitespace only; a long hash scrolls instead of breaking mid-token.
    for (const re of [/hashcat -m 1000/, /^john /]) {
      const code = within(list).getByText(codeMatching(re));
      const block = code.closest("pre")!;
      expect(block.className).not.toMatch(/break-all/);
      expect(block.className).toMatch(/whitespace-pre-wrap/);
    }
    await user.click(within(list).getByRole("button", { name: "Record plaintext" }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("Plaintext"), "password");
    await user.click(within(dlg).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(m.credentialCrack).toHaveBeenCalledWith("h", "password"));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Credential" })).getByRole("button", { name: "Edit CORP\\jsmith" })).toBeInTheDocument());
    expect(document.querySelector("[aria-label*='(hash)']")).toBeNull();
    await openInventory(user);
    const passwords = await screen.findByRole("region", { name: "Passwords" });
    expect(within(passwords).getAllByRole("row")).toHaveLength(2);
    expect(within(passwords).getByTitle("CORP\\jsmith")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hashes" })).not.toBeInTheDocument();
  });

  it("marks a hash uncrackable", async () => {
    const user = userEvent.setup();
    m.credentialSetCrackStatus.mockResolvedValue(cred({ id: "h" }));
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret: "8846f7eaee8fb117ad06bdd830b7586c", crackStatus: "uncracked" })] });
    const list = await findDock();
    await user.click(within(list).getByRole("button", { name: "Mark uncrackable" }));
    expect(m.credentialSetCrackStatus).toHaveBeenCalledWith("h", "uncrackable");
  });

  it("convert a placeholder credential to access-only", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "guest", domain: "CORP", secret: "none" }), cred({ id: "c2", username: "real", secret: "pw" })] });
    // Only the placeholder offers conversion, and only in its dock.
    await selectInInventory(user, "real");
    expect(screen.queryByRole("button", { name: /to access-only$/ })).not.toBeInTheDocument();
    const dock = await selectInInventory(user, "CORP\\guest");
    expect(screen.getAllByRole("button", { name: /to access-only$/ })).toHaveLength(1);
    await user.click(within(dock).getByRole("button", { name: "Convert to access-only" }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Convert" }));
    expect(await within(dlg).findByText("Choose a host")).toBeInTheDocument();
    expect(m.credentialConvertToAccess).not.toHaveBeenCalled();
    await pick(user, "Access on host", "dc01");
    await pick(user, "Access level", "admin");
    await user.type(within(dlg).getByLabelText("Access via"), "null session");
    await user.click(within(dlg).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(m.credentialConvertToAccess).toHaveBeenCalledWith("c1", { hostId: "h1", level: "admin", via: "null session" }));
    // The credential leaves the inventory; the username carries the access.
    const usersRegion = await screen.findByRole("region", { name: "Usernames" });
    expect(await within(usersRegion).findByText(/admin on dc01/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to access-only$/ })).not.toBeInTheDocument();
  });

  it("usernames accept DOMAIN\\user and reject duplicates", async () => {
    const user = userEvent.setup();
    mount();
    await openInventory(user);
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
    await user.click(await within(await findDock()).findByRole("button", { name: "Delete CORP\\jsmith" }));
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
    await openInventory(user);
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
    for (const [name, label, before] of [["CORP\\svc", "Edit CORP\\svc (hash)", hash], ["CORP\\bob", "Edit CORP\\bob", pw]] as const) {
      const dock = await selectInInventory(user, name);
      await user.click(within(dock).getByRole("button", { name: label }));
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
    const list = await findDock();
    expect(within(list).getByText(codeMatching(/hashcat -m 0 /))).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Copy hashcat command" }));
    expect(await navigator.clipboard.readText()).toBe("hashcat -m 0 '8846f7eaee8fb117ad06bdd830b7586c' /usr/share/wordlists/rockyou.txt");
  });

  it("a hash containing a quote is never in the DOM unrevealed", async () => {
    const secret = "$6$sa'lt$abcdefgh";
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret, crackStatus: "uncracked" })] });
    const list = await findDock();
    expect(within(list).getByText(codeMatching(/hashcat -m 1800/))).toBeInTheDocument();
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
    const dock = await findDock();
    await user.click(within(dock).getByRole("button", { name: "Mark uncrackable" }));
    await openInventory(user);
    const list = await screen.findByRole("region", { name: "Hashes" });
    expect(await within(list).findByText("uncrackable")).toBeInTheDocument();
    await user.click(await within(dock).findByRole("button", { name: "Reset" }));
    expect(await within(list).findByText("uncracked")).toBeInTheDocument();
    expect(m.credentialSetCrackStatus).toHaveBeenLastCalledWith("h", "uncracked");
  });

  it("shows an error when marking uncrackable fails", async () => {
    const user = userEvent.setup();
    m.credentialSetCrackStatus.mockRejectedValue(new Error("write failed"));
    mount({ creds: [cred({ id: "h", type: "hash", username: "jsmith", secret: "8846f7eaee8fb117ad06bdd830b7586c", crackStatus: "uncracked" })] });
    const list = await findDock();
    await user.click(within(list).getByRole("button", { name: "Mark uncrackable" }));
    expect(await within(list).findByRole("alert")).toHaveTextContent("write failed");
  });

  it("Edit opens the form pre-filled with the secret hidden", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!" })] });
    await user.click(await within(await findDock()).findByRole("button", { name: "Edit CORP\\jsmith" }));
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
    const dock = await selectInInventory(user, "CORP\\jsmith", 1);
    await user.click(within(dock).getByRole("button", { name: "Edit CORP\\jsmith" }));
    const dlg = await screen.findByRole("dialog");
    const secret = within(dlg).getByLabelText("Secret");
    await user.clear(secret);
    await user.type(secret, "Winter2024!");
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("Already recorded: CORP\\jsmith")).toBeInTheDocument();
    expect(m.credentialUpdate).not.toHaveBeenCalled();
  });
});

const pw = (i: number) => cred({ id: `c${i}`, username: `u${i}`, secret: `Pass${i}!`, createdAt: i });
const TEN = Array.from({ length: 10 }, (_, i) => pw(i + 1));
const TWO_USERS: Username[] = ["alice", "bob"].map((u, i) => ({ id: `u-${u}`, engagementId: "e1", username: u, domain: null, sourceHostId: null, source: null, createdAt: i }));
const dock = () => screen.getByRole("region", { name: "Credential" });
const NT_HASH = cred({ id: "h", type: "hash", username: "jsmith", domain: "CORP", secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "NTLM", crackStatus: "uncracked", createdAt: 20 });

describe("credentials dock page", () => {
  it("opens on the Matrix tab with the newest testable credential selected and docked", async () => {
    mount({ creds: TEN, users: TWO_USERS, services: SMB });
    expect(await screen.findByRole("tab", { name: "Matrix" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Inventory" })).toHaveAttribute("aria-selected", "false");
    expect(within(await screen.findByRole("region", { name: "Credential" })).getByTitle("u10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select u10" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(search().get("cred")).toBe("c10"));
  });

  it("selecting a matrix row swaps the dock and writes ?cred=", async () => {
    const user = userEvent.setup();
    mount({ creds: TEN, services: SMB });
    await user.click(await screen.findByRole("button", { name: "Select u3" }));
    expect(within(dock()).getByTitle("u3")).toBeInTheDocument();
    expect(within(dock()).queryByTitle("u10")).not.toBeInTheDocument();
    expect(search().get("cred")).toBe("c3");
    expect(search().get("tab")).toBeNull();
  });

  it("the selection survives switching to Inventory, and ?tab=inventory is written", async () => {
    const user = userEvent.setup();
    mount({ creds: TEN, services: SMB });
    await user.click(await screen.findByRole("button", { name: "Select u3" }));
    await user.click(screen.getByRole("tab", { name: /^Inventory/ }));
    expect(screen.getByRole("tab", { name: /^Inventory/ })).toHaveAttribute("aria-selected", "true");
    expect(search().get("tab")).toBe("inventory");
    expect(search().get("cred")).toBe("c3");
    expect(within(dock()).getByTitle("u3")).toBeInTheDocument();
    const row = within(screen.getByRole("region", { name: "Passwords" })).getByTitle("u3").closest("tr")!;
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("picking a kind in the Inventory filter keeps tab and cred, and adds kind", async () => {
    const user = userEvent.setup();
    mount({ creds: [pw(1), NT_HASH], services: SMB, url: "/e/e1/s/credentials?tab=inventory&cred=c1" });
    await user.click(await screen.findByRole("radio", { name: /^Hashes/ }));
    await waitFor(() => expect(search().get("kind")).toBe("hashes"));
    expect(search().get("tab")).toBe("inventory");
    expect(search().get("cred")).toBe("c1");
    expect(within(dock()).getByTitle("u1")).toBeInTheDocument();
  });

  it("a stale ?cred= falls back to the default", async () => {
    mount({ creds: TEN, services: SMB, url: "/e/e1/s/credentials?cred=nope" });
    expect(within(await screen.findByRole("region", { name: "Credential" })).getByTitle("u10")).toBeInTheDocument();
    await waitFor(() => expect(search().get("cred")).toBe("c10"));
  });

  it("deleting the selected credential moves the dock to the default", async () => {
    const user = userEvent.setup();
    mount({ creds: TEN, services: SMB, url: "/e/e1/s/credentials?cred=c3" });
    await user.click(await within(await screen.findByRole("region", { name: "Credential" })).findByRole("button", { name: "Delete u3" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete credential" }));
    await waitFor(() => expect(m.credentialDelete).toHaveBeenCalledWith("c3"));
    await waitFor(() => expect(within(dock()).getByTitle("u10")).toBeInTheDocument());
    await waitFor(() => expect(search().get("cred")).toBe("c10"));
  });

  it("cracking the selected hash selects the new password", async () => {
    const user = userEvent.setup();
    mount({ creds: [pw(1), NT_HASH], services: SMB, url: "/e/e1/s/credentials?cred=h" });
    const d = await screen.findByRole("region", { name: "Credential" });
    await user.click(within(d).getByRole("button", { name: "Record plaintext" }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("Plaintext"), "password");
    await user.click(within(dlg).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(m.credentialCrack).toHaveBeenCalledWith("h", "password"));
    await waitFor(() => expect(search().get("cred")).toBe("c101"));
    expect(within(dock()).getByRole("button", { name: "Edit CORP\\jsmith" })).toBeInTheDocument();
    expect(within(dock()).queryByRole("tab", { name: "Crack" })).not.toBeInTheDocument();
  });

  it("a cracked password that never appears in the list lets the selection fall back", async () => {
    const user = userEvent.setup();
    mount({ creds: [pw(1), NT_HASH], services: SMB, url: "/e/e1/s/credentials?cred=h" });
    // The server answers with a password the list never shows.
    m.credentialCrack.mockImplementation(async (hashId, plaintext) => cred({ id: "ghost", username: "jsmith", domain: "CORP", secret: plaintext, crackedFrom: hashId }));
    const d = await screen.findByRole("region", { name: "Credential" });
    await user.click(within(d).getByRole("button", { name: "Record plaintext" }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("Plaintext"), "password");
    await user.click(within(dlg).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(m.credentialCrack).toHaveBeenCalledWith("h", "password"));
    // Not stuck on the unknown id: the default (the hash, still listed) is selected and docked again.
    await waitFor(() => expect(search().get("cred")).toBe("h"));
    expect(within(dock()).getByRole("button", { name: "Edit CORP\\jsmith (hash)" })).toBeInTheDocument();
    // And selection still works afterwards.
    await user.click(screen.getByRole("button", { name: "Select u1" }));
    expect(search().get("cred")).toBe("c1");
  }, 15_000); // Load-sensitive: fast alone, can take over 5s under the full suite (no behaviour change).

  it("with only non-sprayable credentials, the newest is docked and the matrix shows the can't-be-sprayed note", async () => {
    const user = userEvent.setup();
    mount({
      creds: [
        cred({ id: "t1", type: "ticket", username: "bob", secret: "doIF", createdAt: 1 }),
        cred({ id: "m1", username: "DC01$", domain: "CORP", secret: "x9f3kq2m", createdAt: 2 }),
      ],
      services: SMB,
    });
    expect(within(await screen.findByRole("region", { name: "Credential" })).getByTitle("CORP\\DC01$")).toBeInTheDocument();
    expect(screen.getByText(/2 not sprayable/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "see Inventory" }));
    expect(screen.getByRole("tab", { name: /^Inventory/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Machine accounts" })).toBeInTheDocument();
  });

  it("Crack appears once on the page", async () => {
    mount({ creds: [pw(1), NT_HASH], services: SMB, url: "/e/e1/s/credentials?cred=h" });
    await screen.findByRole("region", { name: "Credential" });
    expect(screen.getAllByRole("button", { name: /^Crack|Record plaintext/ })).toHaveLength(1);
  });

  it("the fold persists per engagement", async () => {
    const user = userEvent.setup();
    const first = mount({ creds: TEN, services: SMB });
    await user.click(await within(await screen.findByRole("region", { name: "Credential" })).findByRole("button", { name: "Fold credential" }));
    expect(await within(dock()).findByRole("button", { name: "Open credential" })).toBeInTheDocument();
    first.unmount();
    mount({ creds: TEN, services: SMB });
    expect(await within(await screen.findByRole("region", { name: "Credential" })).findByRole("button", { name: "Open credential" })).toBeInTheDocument();
    await user.click(within(dock()).getByRole("button", { name: "Open credential" }));
    expect(await within(dock()).findByRole("button", { name: "Fold credential" })).toBeInTheDocument();
  });

  it("scrolls the selected row into view in its own scroller, in the matrix and in the inventory", async () => {
    const user = userEvent.setup();
    const into = vi.spyOn(Element.prototype, "scrollIntoView");
    const stubs: { mockRestore: () => void }[] = [];
    const stubLayout = () => {
      stubs.push(
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
          const r = this.tagName === "TR" ? { top: 500, bottom: 550 } : { top: 0, bottom: 0 };
          return { ...r, left: 0, right: 0, width: 0, height: r.bottom - r.top, x: 0, y: r.top, toJSON: () => ({}) };
        }),
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200),
      );
    };
    const ancestorsStill = (el: HTMLElement) => {
      for (let e = el.parentElement; e; e = e.parentElement) expect(e.scrollTop).toBe(0);
    };
    try {
      stubLayout();
      mount({ creds: TEN, services: SMB });
      await screen.findByRole("button", { name: "Select u10" });
      const scroller = document.querySelector("table[aria-label='Test grid']")!.parentElement!;
      await waitFor(() => expect(scroller.scrollTop).toBe(350));
      ancestorsStill(scroller);
      stubs.splice(0).forEach((s) => s.mockRestore());
      await user.click(screen.getByRole("tab", { name: /^Inventory/ }));
      const rows = await waitFor(() => {
        const r = document.querySelectorAll("tr[data-cred-row]");
        expect(r.length).toBeGreaterThan(2);
        return r;
      });
      stubLayout();
      await user.click(rows[0]);
      const viewport = document.querySelector("tr[data-cred-row][aria-selected='true']")!.closest<HTMLElement>("[data-slot=scroll-area-viewport]")!;
      await waitFor(() => expect(viewport.scrollTop).toBe(350));
      ancestorsStill(viewport);
      // The selection bar is on the row box, so it spans a row whose other cells wrap to two lines.
      const selectedRow = document.querySelector("tr[data-cred-row][aria-selected='true']")!;
      expect(selectedRow.className).toContain("shadow-[inset_2px_0_0_var(--accent)]");
      expect(selectedRow.firstElementChild!.className).not.toContain("inset_2px");
      expect(into).not.toHaveBeenCalled();
    } finally {
      into.mockRestore();
      stubs.forEach((s) => s.mockRestore());
    }
  });
});
