import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { AccessGrant, CredAttempt, Credential, Username } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { HostIdentity, PrivescVector } from "../types/hostFacts";
import type { LogEntry } from "../types/log";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (over: Partial<Host> = {}): Host => ({
  id: "h1", engagementId: "e1", name: "ms01", ip: "10.10.10.5", os: "windows", boardColumn: "vulnerability-detection",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none",
  createdAt: 1, updatedAt: 1, ...over,
});
const svc = (id: string, port: number, over: Partial<Service> = {}): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1, ...over,
});
const entry = (id: string, title: string): LogEntry => ({
  id, engagementId: "e1", kind: "note", title, titleEdited: false, ranOn: null, hostIds: ["h1"], observations: null,
  returnedNothing: false, private: false, content: { kind: "note", text: "body" }, at: 1000, createdAt: 1000, updatedAt: 1000,
});
const vector = (id: string, title: string, status: PrivescVector["status"], over: Partial<PrivescVector> = {}): PrivescVector => ({
  id, hostId: "h1", title, status, source: "auto", createdAt: 1, updatedAt: 1, ...over,
});
const cred = (id: string, username: string, over: Partial<Credential> = {}): Credential => ({
  id, engagementId: "e1", type: "password", username, domain: "CORP", secret: "Winter2024!", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null,
  createdAt: 1, updatedAt: 1, ...over,
});

const NGINX = svc("s1", 80, { nmapService: "http", nmapVersion: "Apache 2.4", confirmedProduct: "nginx", confirmedVersion: "1.18", verdict: "candidate" });
const SMB = svc("s2", 445, { nmapService: "microsoft-ds?" });
const SSH = svc("s3", 22, { nmapService: "ssh", nmapVersion: "OpenSSH 8.2" });
const IDENTITY: HostIdentity = {
  hostId: "h1", username: "ms01\\iis_apppool", privileges: ["SeChangeNotifyPrivilege", "SeImpersonatePrivilege"], groups: [],
  entryId: "l1", updatedAt: 1,
};

function mount(opts: {
  host?: Host;
  services?: Service[];
  identity?: HostIdentity | null;
  vectors?: PrivescVector[];
  creds?: Credential[];
  usernames?: Username[];
  grants?: AccessGrant[];
  attempts?: CredAttempt[];
} = {}) {
  const h = opts.host ?? host();
  const services = opts.services ?? [NGINX, SMB, SSH];
  m.hostsList.mockResolvedValue([h]);
  m.servicesList.mockResolvedValue(services);
  m.servicesListEngagement.mockResolvedValue(services);
  m.hostIdentityGet.mockResolvedValue(opts.identity ?? null);
  m.vectorsList.mockResolvedValue(opts.vectors ?? []);
  m.credentialsList.mockResolvedValue(opts.creds ?? []);
  m.usernamesList.mockResolvedValue(opts.usernames ?? []);
  m.accessGrantsList.mockResolvedValue(opts.grants ?? []);
  m.credAttemptsList.mockResolvedValue(opts.attempts ?? []);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const group = async (name: string) => within(await screen.findByRole("region", { name }));
/** A folded group is one summary button; an open one has a header that folds it. */
const toggleOf = async (name: string) =>
  (await (await group(name)).findAllByRole("button")).find((b) => /^(Open|Fold) /.test(b.title))!;
const isOpen = async (name: string) => (await (await group(name)).findAllByRole("button")).some((b) => b.getAttribute("aria-expanded") === "true" && b.title.startsWith("Fold"));
const summaryOf = async (name: string) => {
  const g = await group(name);
  const b = await g.findByRole("button", { expanded: false });
  return b.textContent;
};

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.logList.mockResolvedValue([entry("l1", "whoami /all"), entry("l2", "nmap sweep")]);
  m.checklistList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.serviceSetVerdict.mockImplementation(async (id, verdict) => ({ ...SMB, id, verdict }));
});

describe("facts by phase", () => {
  it("before a foothold: Coverage, Services and Host Credentials are open; the after-foothold groups are folded summaries", async () => {
    mount();
    for (const name of ["Coverage", "Services", "Host Credentials"]) expect(await isOpen(name)).toBe(true);
    expect(await summaryOf("Who am I")).toMatch(/^Who am I · not known yet/);
    expect(await summaryOf("Privesc vectors")).toMatch(/^Privesc vectors · none yet/);
    expect(await summaryOf("Other accounts")).toMatch(/^Other accounts · 0/);
    const order = [...screen.getByRole("region", { name: "Facts" }).children].map((r) => r.getAttribute("aria-label"));
    expect(order).toEqual(["Coverage", "Services", "Host Credentials", "Who am I", "Privesc vectors", "Other accounts"]);
  });

  it("after a foothold: Who am I with SeImpersonatePrivilege in accent, the vector, and Services folded to a summary", async () => {
    mount({ host: host({ access: "user", boardColumn: "initial-foothold" }), identity: IDENTITY, vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try")] });
    const who = await group("Who am I");
    expect(await who.findByText("ms01\\iis_apppool")).toBeInTheDocument();
    expect(who.getByText("SeImpersonatePrivilege")).toHaveClass("text-accent");
    expect(who.getByText("SeChangeNotifyPrivilege")).not.toHaveClass("text-accent");
    expect(who.getByRole("button", { name: /whoami \/all/ })).toBeInTheDocument();
    const vectors = await group("Privesc vectors");
    expect(await vectors.findByText("SeImpersonatePrivilege abuse")).toBeInTheDocument();
    expect(vectors.getByRole("button", { name: "SeImpersonatePrivilege abuse: try" })).toBeInTheDocument();
    expect(await summaryOf("Services")).toMatch(/^Services · /);
    const order = [...screen.getByRole("region", { name: "Facts" }).children].map((r) => r.getAttribute("aria-label"));
    expect(order.slice(0, 3)).toEqual(["Who am I", "Privesc vectors", "Other accounts"]);
  });

  it("phase follows access, not the board column", async () => {
    mount({ host: host({ access: "none", boardColumn: "privilege-escalation" }) });
    expect(await isOpen("Services")).toBe(true);
    expect(await summaryOf("Who am I")).toMatch(/^Who am I · /);
  });

  it("the summaries: Services, Coverage and Host Credentials", async () => {
    mount({ host: host({ access: "root" }) });
    expect(await summaryOf("Services")).toBe("Services · 1 ✓ · entry nginx 80 · 1 ?");
    expect(await summaryOf("Coverage")).toMatch(/^Coverage · Information gathering 0\/\d+$/);
    await waitFor(async () => expect(await summaryOf("Host Credentials")).toBe("Host Credentials · 0 work · 0 untested"));
  });

  it("an opened group stays open for that host (stored per host, folds only)", async () => {
    const user = userEvent.setup();
    const first = mount({ host: host({ access: "user" }) });
    await user.click(await toggleOf("Services"));
    expect(await isOpen("Services")).toBe(true);
    expect(JSON.parse(localStorage.getItem("raven.facts.h1")!)).toEqual({ services: true });
    first.unmount();
    mount({ host: host({ access: "user" }) });
    expect(await isOpen("Services")).toBe(true);
  });
});

describe("S toggles Services", () => {
  it("pressing S folds Services and pressing it again opens it", async () => {
    const user = userEvent.setup();
    mount();
    expect(await isOpen("Services")).toBe(true);
    await user.keyboard("s");
    expect(await summaryOf("Services")).toMatch(/^Services · /);
    await user.keyboard("S");
    expect(await isOpen("Services")).toBe(true);
  });
});

describe("services grid", () => {
  it("is a port / identity / verdict grid, sorted candidate, identify, untested, dead end", async () => {
    mount({ services: [SSH, svc("s4", 21, { nmapService: "ftp", verdict: "dead_end" }), SMB, NGINX] });
    const g = await group("Services");
    const list = (await g.findAllByRole("list"))[0];
    expect(list.className).toContain("grid-cols-[6ch_minmax(0,1fr)_auto]");
    const rows = within(list).getAllByRole("button", { name: /\/tcp/ }).filter((b) => b.hasAttribute("data-service-row"));
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "80/tcp nginx 1.18, candidate",
      "445/tcp microsoft-ds?, identify",
      "22/tcp ssh OpenSSH 8.2, untested",
      "21/tcp ftp, dead end",
    ]);
  });

  it("a confirmed identity shows ✓ with nmap's guess on hover; unconfirmed ones are dimmed, unidentified marked ?", async () => {
    mount();
    const g = await group("Services");
    const nginx = (await g.findByText(/nginx 1\.18/)).closest("span")!;
    expect(nginx).toHaveClass("text-fg");
    expect(nginx).toHaveAttribute("title", "nmap: http Apache 2.4");
    expect(within(nginx).getByText("✓")).toHaveClass("text-accent");
    expect(g.getByText("ssh OpenSSH 8.2")).toHaveClass("text-muted");
    expect(g.getByText("?", { exact: false, selector: ".text-warn" })).toBeInTheDocument();
  });

  it("a service that is not open shows its state", async () => {
    mount({ services: [svc("s1", 80, { nmapService: "http" }), svc("s4", 8080, { state: "filtered", nmapService: "http-proxy" })] });
    const g = await group("Services");
    expect(await g.findByText("filtered")).toBeInTheDocument();
  });

  it("D on a focused row asks for one line; Enter sets dead end with that reason", async () => {
    const user = userEvent.setup();
    mount();
    const row = await (await group("Services")).findByRole("button", { name: /^445\/tcp/ });
    row.focus();
    await user.keyboard("d");
    const reason = await screen.findByRole("textbox", { name: "Why is 445/tcp a dead end?" });
    expect(reason).toHaveFocus();
    await user.keyboard("patched{Enter}");
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s2", "dead_end", "patched");
  });

  it("C and U on a focused row set candidate and untested without asking", async () => {
    const user = userEvent.setup();
    mount();
    const row = await (await group("Services")).findByRole("button", { name: /^22\/tcp/ });
    row.focus();
    await user.keyboard("c");
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s3", "candidate", undefined);
    await user.keyboard("u");
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s3", "untested", undefined);
  });

  it("the verdict tag opens a menu with the same choices", async () => {
    const user = userEvent.setup();
    mount();
    const g = await group("Services");
    await user.click(await g.findByRole("button", { name: "Verdict for 22/tcp: untested" }));
    await user.click(within(g.getByRole("group", { name: "Verdict for 22/tcp" })).getByRole("button", { name: "Candidate" }));
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s3", "candidate", undefined);
  });

  it("7 dynamic RPC ports fold into one msrpc ×7 row that opens in place; UDP folds too", async () => {
    const user = userEvent.setup();
    const rpc = Array.from({ length: 7 }, (_, i) => svc(`r${i}`, 49664 + i, { nmapService: "msrpc" }));
    const udp = [svc("u1", 161, { protocol: "udp", nmapService: "snmp" }), svc("u2", 123, { protocol: "udp", nmapService: "ntp" })];
    mount({ services: [SMB, ...rpc, ...udp] });
    const g = await group("Services");
    const folded = await g.findByRole("button", { name: "msrpc ×7" });
    expect(g.getAllByText(/msrpc ×/)).toHaveLength(1);
    expect(g.queryByRole("button", { name: /^49664\/tcp/ })).not.toBeInTheDocument();
    await user.click(folded);
    expect(g.getByRole("button", { name: /^49664\/tcp/ })).toBeInTheDocument();
    expect(g.getAllByRole("button", { name: /^496[67]\d\/tcp/ })).toHaveLength(7);
    await user.click(g.getByRole("button", { name: "2 UDP" }));
    expect(g.getByRole("button", { name: /^161\/udp/ })).toBeInTheDocument();
  });

  it("clicking a row confirms the identity with its proving entry", async () => {
    const user = userEvent.setup();
    m.serviceConfirm.mockResolvedValue(SSH);
    mount();
    await user.click(await (await group("Services")).findByRole("button", { name: /^22\/tcp/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Product"), "OpenSSH");
    await user.type(within(dialog).getByLabelText("Version"), "8.2p1");
    await user.click(within(dialog).getByRole("combobox", { name: "Proved by" }));
    await user.click(await screen.findByRole("option", { name: "nmap sweep" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(m.serviceConfirm).toHaveBeenCalledWith("s3", { product: "OpenSSH", version: "8.2p1", entryId: "l2" });
  });

  it("the row dialog edits port, protocol and nmap guess", async () => {
    m.serviceUpdate.mockResolvedValue(svc("s3", 2222));
    const user = userEvent.setup();
    mount();
    await user.click(await (await group("Services")).findByRole("button", { name: /^22\/tcp/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit 22/tcp" });
    const port = within(dialog).getByLabelText("Port");
    await user.clear(port);
    await user.type(port, "2222");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(m.serviceUpdate).toHaveBeenCalledWith("s3", { port: 2222, protocol: "tcp", nmapService: "ssh", nmapVersion: "OpenSSH 8.2" });
  });

  it("the row dialog deletes after a confirm", async () => {
    m.serviceDelete.mockResolvedValue(null);
    const user = userEvent.setup();
    mount();
    await user.click(await (await group("Services")).findByRole("button", { name: /^445\/tcp/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete 445/tcp?" });
    expect(m.serviceDelete).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete service" }));
    expect(m.serviceDelete).toHaveBeenCalledWith("s2");
  });

  it("Add service opens the service form", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await (await group("Services")).findByRole("button", { name: "Add service" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("who am I and privesc vectors", () => {
  const after = () => host({ access: "user" });

  it("the edit icon opens inline fields that save the identity and add vectors for notable privileges", async () => {
    const user = userEvent.setup();
    m.hostIdentitySet.mockImplementation(async (input) => ({ ...input, updatedAt: 2 }));
    m.vectorUpsert.mockResolvedValue(vector("v9", "SeBackupPrivilege abuse", "try"));
    mount({ host: after() });
    const who = await group("Who am I");
    expect(await who.findByText(/Not known yet/)).toBeInTheDocument();
    const edit = who.getByRole("button", { name: "Edit who am I" });
    expect(edit).toHaveAttribute("title");
    await user.click(edit);
    await user.type(who.getByRole("textbox", { name: "User" }), "ms01\\svc");
    await user.type(who.getByRole("textbox", { name: "Privileges" }), "SeBackupPrivilege");
    await user.click(who.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(m.hostIdentitySet).toHaveBeenCalledWith({ hostId: "h1", username: "ms01\\svc", privileges: ["SeBackupPrivilege"], groups: [], entryId: null }),
    );
    await waitFor(() => expect(m.vectorUpsert).toHaveBeenCalledWith("h1", { title: "SeBackupPrivilege abuse", status: "try", source: "auto" }));
  });

  it("shows how access was gained from the matching access grant", async () => {
    mount({
      host: after(),
      identity: IDENTITY,
      usernames: [{ id: "u1", engagementId: "e1", username: "iis_apppool", domain: "ms01", sourceHostId: null, source: null, createdAt: 1 }],
      grants: [{ id: "g1", engagementId: "e1", usernameId: "u1", hostId: "h1", level: "user", via: "webshell", logEntryId: null, at: 1 }],
    });
    const who = await group("Who am I");
    expect(await who.findByText("webshell")).toBeInTheDocument();
  });

  it("+ Add vector adds a manual vector on Enter", async () => {
    const user = userEvent.setup();
    m.vectorUpsert.mockResolvedValue(vector("v2", "Unquoted service path", "untested", { source: "manual" }));
    mount({ host: after() });
    const vectors = await group("Privesc vectors");
    await user.click(await vectors.findByRole("button", { name: "Add vector" }));
    await user.type(vectors.getByRole("textbox", { name: "New privesc vector" }), "Unquoted service path{Enter}");
    expect(m.vectorUpsert).toHaveBeenCalledWith("h1", { title: "Unquoted service path", status: "untested", source: "manual" });
  });

  it("ruling a vector out asks for one line; reopening sets it untested", async () => {
    const user = userEvent.setup();
    m.vectorSetStatus.mockImplementation(async (id, status) => vector(id, "x", status));
    mount({ host: after(), vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try"), vector("v3", "AlwaysInstallElevated", "ruled_out")] });
    const vectors = await group("Privesc vectors");
    await user.click(await vectors.findByRole("button", { name: "Rule out SeImpersonatePrivilege abuse" }));
    await user.type(vectors.getByRole("textbox", { name: "Why is SeImpersonatePrivilege abuse ruled out?" }), "patched{Enter}");
    expect(m.vectorSetStatus).toHaveBeenCalledWith("v1", "ruled_out", "patched");
    await user.click(vectors.getByRole("button", { name: "Reopen AlwaysInstallElevated" }));
    expect(m.vectorSetStatus).toHaveBeenCalledWith("v3", "untested", undefined);
  });

  it("deleting a vector asks first", async () => {
    const user = userEvent.setup();
    m.vectorDelete.mockResolvedValue(null);
    mount({ host: after(), vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try")] });
    const del = await (await group("Privesc vectors")).findByRole("button", { name: "Delete SeImpersonatePrivilege abuse" });
    expect(del).toHaveAttribute("data-variant", "danger");
    await user.click(del);
    expect(m.vectorDelete).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete vector" }));
    expect(m.vectorDelete).toHaveBeenCalledWith("v1");
  });

  it("Other accounts lists uncracked hashes and other users' credentials, never this identity's", async () => {
    mount({
      host: after(),
      identity: IDENTITY,
      creds: [
        cred("c1", "svc_sql", { type: "hash", secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", crackStatus: "uncracked" }),
        cred("c2", "bob"),
        cred("c3", "iis_apppool", { domain: "ms01" }),
      ],
    });
    const g = await group("Other accounts");
    expect(await g.findByText("CORP\\svc_sql (hash)")).toBeInTheDocument();
    expect(g.getByText("uncracked")).toBeInTheDocument();
    expect(g.getByText("CORP\\bob")).toBeInTheDocument();
    expect(g.queryByText(/iis_apppool/)).not.toBeInTheDocument();
    expect(g.queryByText(/Winter2024/)).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await toggleOf("Other accounts"));
    expect(await summaryOf("Other accounts")).toBe("Other accounts · 2");
  });
});
