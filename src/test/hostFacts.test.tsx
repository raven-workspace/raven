import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { servicesSummaryParts } from "../features/hosts/facts/ServicesFacts/ServicesFacts";
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
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
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
  /** Services, identity, vectors and credentials never arrive. */
  pending?: boolean;
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
  if (opts.pending) {
    const never = new Promise<never>(() => {});
    m.servicesList.mockReturnValue(never);
    m.hostIdentityGet.mockReturnValue(never);
    m.vectorsList.mockReturnValue(never);
    m.credentialsList.mockReturnValue(never);
  }
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
  (await (await group(name)).findAllByRole("button")).find((b) => b.classList.contains("fact-group__toggle"))!;
const isOpen = async (name: string) => (await (await group(name)).findAllByRole("button")).some((b) => b.getAttribute("aria-expanded") === "true" && b.classList.contains("fact-group__toggle"));
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
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [] });
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
  it("a failed services load shows the standard error in Services, and Retry loads them (RAV-22)", async () => {
    const user = userEvent.setup();
    mount();
    m.servicesList.mockRejectedValue(new Error("vault busy"));
    const group = await screen.findByRole("region", { name: "Services" });
    const alert = await within(group).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load services");
    m.servicesList.mockResolvedValue([NGINX, SMB, SSH]);
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(group).queryByRole("alert")).toBeNull());
    expect(group.querySelector("[data-services-grid]")).not.toBeNull();
  });

  it("before a foothold: Coverage, Services and Host Credentials are open; the after-foothold groups are folded summaries", async () => {
    mount();
    for (const name of ["Coverage", "Services", "Host Credentials"]) expect(await isOpen(name)).toBe(true);
    expect(await summaryOf("Who am I")).toMatch(/^Who am I.*not known yet/);
    expect(await summaryOf("Privesc vectors")).toMatch(/^Privesc vectors.*none yet/);
    expect(await summaryOf("Other accounts")).toMatch(/^Other accounts.*none yet$/);
    const order = [...screen.getByRole("region", { name: "Facts" }).children].map((r) => r.getAttribute("aria-label"));
    expect(order).toEqual(["Coverage", "Services", "Host Credentials", "Who am I", "Privesc vectors", "Other accounts"]);
  });

  it("after a foothold: Who am I with SeImpersonatePrivilege in accent, the vector, and Services folded to a summary", async () => {
    mount({ host: host({ access: "user", boardColumn: "initial-foothold" }), identity: IDENTITY, vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try")] });
    const who = await group("Who am I");
    expect(await who.findByText("ms01\\iis_apppool")).toBeInTheDocument();
    expect(who.getByText("SeImpersonatePrivilege")).toHaveClass("identity-facts__item--notable");
    expect(who.getByText("SeChangeNotifyPrivilege")).not.toHaveClass("identity-facts__item--notable");
    expect(who.getByRole("button", { name: /whoami \/all/ })).toBeInTheDocument();
    const vectors = await group("Privesc vectors");
    expect(await vectors.findByText("SeImpersonatePrivilege abuse")).toBeInTheDocument();
    expect(vectors.getByRole("button", { name: "SeImpersonatePrivilege abuse: try" })).toBeInTheDocument();
    expect(await summaryOf("Services")).toMatch(/^Services.+/);
    const order = [...screen.getByRole("region", { name: "Facts" }).children].map((r) => r.getAttribute("aria-label"));
    expect(order.slice(0, 3)).toEqual(["Who am I", "Privesc vectors", "Other accounts"]);
  });

  it("phase follows access, not the board column", async () => {
    mount({ host: host({ access: "none", boardColumn: "privilege-escalation" }) });
    expect(await isOpen("Services")).toBe(true);
    expect(await summaryOf("Who am I")).toMatch(/^Who am I.+/);
  });

  it("the summaries: Services, Coverage and Host Credentials, as labelled cells", async () => {
    mount({ host: host({ access: "root" }) });
    const services = await group("Services");
    await services.findByRole("button", { expanded: false });
    const cells = [...services.getByRole("button", { expanded: false }).querySelectorAll("[data-summary-cell]")];
    expect(cells.map((c) => c.textContent)).toEqual(["3 services", "1 confirmed", "entry:nginx on 80", "1 unidentified"]);
    expect(await summaryOf("Coverage")).toMatch(/^Coverage.*Vulnerability detection:0\/\d+ done$/);
    await waitFor(async () => expect(await summaryOf("Host Credentials")).toBe("Host Credentials0 working0 untested"));
  });

  it("services summary has no middot string", async () => {
    mount({ host: host({ access: "root" }) });
    for (const name of ["Services", "Coverage", "Host Credentials"]) expect(await summaryOf(name)).not.toMatch(/[·—→]/);
    expect(await summaryOf("Services")).not.toContain("✓");
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

describe("summaries while loading", () => {
  it("before a foothold, the folded identity groups show only their titles until their data arrives", async () => {
    mount({ pending: true });
    for (const name of ["Who am I", "Privesc vectors", "Other accounts"]) expect(await summaryOf(name)).toBe(name);
  });

  it("after a foothold, folded Services shows only its title until its data arrives", async () => {
    mount({ host: host({ access: "user" }), pending: true });
    expect(await summaryOf("Services")).toBe("Services");
  });
});

describe("S toggles Services", () => {
  it("pressing S folds Services and pressing it again opens it", async () => {
    const user = userEvent.setup();
    mount();
    expect(await isOpen("Services")).toBe(true);
    await user.keyboard("s");
    expect(await summaryOf("Services")).toMatch(/^Services.+/);
    await user.keyboard("S");
    expect(await isOpen("Services")).toBe(true);
  });
});

describe("services grid", () => {
  it("is a port / identity / verdict grid in port order, whatever the verdicts", async () => {
    mount({ services: [SSH, svc("s4", 21, { nmapService: "ftp", verdict: "dead_end" }), SMB, NGINX] });
    const g = await group("Services");
    const list = (await g.findAllByRole("list"))[0];
    expect(list).toHaveClass("services-facts");
    const rows = within(list).getAllByRole("button", { name: /\/tcp/ }).filter((b) => b.hasAttribute("data-service-row"));
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "21/tcp ftp, dead end",
      "22/tcp ssh OpenSSH 8.2, untested",
      "80/tcp nginx 1.18, candidate",
      "445/tcp microsoft-ds?, identify",
    ]);
  });

  it("a confirmed identity shows ✓ with nmap's guess on hover; unconfirmed ones are dimmed, unidentified marked ?", async () => {
    mount();
    const g = await group("Services");
    const nginx = (await g.findByText(/nginx 1\.18/)).closest("span")!;
    expect(nginx).toHaveClass("services-facts__label--confirmed");
    expect(nginx).toHaveAttribute("title", "nmap: http Apache 2.4");
    expect(within(nginx.parentElement!).getByText("confirmed").parentElement).toHaveClass("services-facts__mark--confirmed");
    expect(g.getByText("ssh OpenSSH 8.2")).toHaveClass("services-facts__label");
    expect(g.getByText("ssh OpenSSH 8.2")).not.toHaveClass("services-facts__label--confirmed");
    const smb = g.getByRole("button", { name: /^445\/tcp/ });
    expect(within(smb).getByText("unidentified")).toBeInTheDocument();
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

  it("a failed dead end keeps the reason input and its text for a retry", async () => {
    const user = userEvent.setup();
    m.serviceSetVerdict.mockRejectedValueOnce(new Error("vault locked"));
    mount();
    const row = await (await group("Services")).findByRole("button", { name: /^445\/tcp/ });
    row.focus();
    await user.keyboard("d");
    await user.keyboard("patched{Enter}");
    expect(await screen.findByText(/Couldn't set the verdict: vault locked/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Why is 445/tcp a dead end?" })).toHaveValue("patched");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Why is 445/tcp a dead end?" })).not.toBeInTheDocument());
    expect(m.serviceSetVerdict).toHaveBeenCalledTimes(2);
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

  it("E on a focused row marks it exploited without asking", async () => {
    const user = userEvent.setup();
    mount();
    const row = await (await group("Services")).findByRole("button", { name: /^80\/tcp/ });
    row.focus();
    await user.keyboard("e");
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s1", "exploited", undefined);
  });

  it("an exploited service reads as exploited on an accent chip and is the summary's entry", async () => {
    mount({ services: [svc("s4", 21, { nmapService: "ftp", verdict: "candidate" }), SSH, svc("s5", 8080, { nmapService: "http", verdict: "exploited" })] });
    const g = await group("Services");
    const chip = await g.findByRole("button", { name: "Verdict for 8080/tcp: exploited" });
    expect(within(chip).getByText("exploited")).toHaveAttribute("data-variant", "accent");
    expect(servicesSummaryParts([svc("s4", 21, { nmapService: "ftp", verdict: "candidate" }), svc("s5", 8080, { nmapService: "http", verdict: "exploited" })]).entry).toBe("http on 8080");
  });

  it("the verdict menu offers Exploited", async () => {
    const user = userEvent.setup();
    mount();
    const g = await group("Services");
    await user.click(await g.findByRole("button", { name: "Verdict for 80/tcp: candidate" }));
    await user.click(within(g.getByRole("radiogroup", { name: "Verdict for 80/tcp" })).getByRole("radio", { name: "Exploited" }));
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s1", "exploited", undefined);
  });

  it("C and U do nothing on a dead-end row, so its typed reason is never deleted by a stray key", async () => {
    const user = userEvent.setup();
    mount({ services: [svc("s4", 21, { nmapService: "ftp", verdict: "dead_end" })] });
    const row = await (await group("Services")).findByRole("button", { name: /^21\/tcp/ });
    row.focus();
    await user.keyboard("c");
    await user.keyboard("u");
    expect(m.serviceSetVerdict).not.toHaveBeenCalled();
    expect(row).toHaveAccessibleName("21/tcp ftp, dead end");
  });

  it("the verdict tag opens a menu with the same choices", async () => {
    const user = userEvent.setup();
    mount();
    const g = await group("Services");
    await user.click(await g.findByRole("button", { name: "Verdict for 22/tcp: untested" }));
    await user.click(within(g.getByRole("radiogroup", { name: "Verdict for 22/tcp" })).getByRole("radio", { name: "Candidate" }));
    expect(m.serviceSetVerdict).toHaveBeenCalledWith("s3", "candidate", undefined);
  });

  it("a fact group's toggle explains itself in a tooltip on keyboard focus, with its key, not a title (RAV-22)", async () => {
    mount();
    const toggle = await toggleOf("Services");
    expect(toggle).not.toHaveAttribute("title");
    act(() => toggle.focus());
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/^Fold Services/);
    expect(within(tip).getByText("S")).toHaveClass("tooltip__key");
  });

  it("a folded run of services explains itself in a tooltip on keyboard focus, not a title (RAV-22)", async () => {
    mount({ services: Array.from({ length: 7 }, (_, i) => svc(`rpc${i}`, 49664 + i, { nmapService: "msrpc" })) });
    const fold = await (await group("Services")).findByRole("button", { name: "msrpc ×7" });
    expect(fold).not.toHaveAttribute("title");
    act(() => fold.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Show msrpc ×7");
  });

  it("the verdict chip's hint is a tooltip that keyboard focus opens", async () => {
    mount();
    const g = await group("Services");
    const chip = await g.findByRole("button", { name: "Verdict for 22/tcp: untested" });
    expect(chip).not.toHaveAttribute("title");
    expect(chip).toHaveClass("services-facts__verdict");
    chip.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Set the verdict (C, U, E or D on the row)");
  });

  it("clicking the pressed verdict closes the menu without changing it", async () => {
    const user = userEvent.setup();
    mount();
    const g = await group("Services");
    await user.click(await g.findByRole("button", { name: "Verdict for 80/tcp: candidate" }));
    await user.click(within(g.getByRole("radiogroup", { name: "Verdict for 80/tcp" })).getByRole("radio", { name: "Candidate" }));
    expect(g.queryByRole("radiogroup", { name: "Verdict for 80/tcp" })).not.toBeInTheDocument();
    expect(m.serviceSetVerdict).not.toHaveBeenCalled();
  });

  it("clicking the pressed Dead end asks for the reason again", async () => {
    const user = userEvent.setup();
    mount({ services: [SSH, svc("s4", 21, { nmapService: "ftp", verdict: "dead_end" })] });
    const g = await group("Services");
    await user.click(await g.findByRole("button", { name: "Verdict for 21/tcp: dead end" }));
    await user.click(within(g.getByRole("radiogroup", { name: "Verdict for 21/tcp" })).getByRole("radio", { name: /Dead end/ }));
    expect(await screen.findByRole("textbox", { name: "Why is 21/tcp a dead end?" })).toBeInTheDocument();
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
    await user.hover(edit);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Edit who am I");
    await user.click(edit);
    await user.type(who.getByRole("textbox", { name: "User" }), "ms01\\svc");
    await user.type(who.getByRole("textbox", { name: "Privileges" }), "SeBackupPrivilege");
    await user.click(who.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(m.hostIdentitySet).toHaveBeenCalledWith({ hostId: "h1", username: "ms01\\svc", privileges: ["SeBackupPrivilege"], groups: [], entryId: null }),
    );
    await waitFor(() => expect(m.vectorUpsert).toHaveBeenCalledWith("h1", { title: "SeBackupPrivilege abuse", status: "try", source: "auto" }));
  });

  it("the edit form labels User, Privileges and Groups", async () => {
    const user = userEvent.setup();
    mount({ host: after() });
    const who = await group("Who am I");
    await user.click(await who.findByRole("button", { name: "Edit who am I" }));
    expect(who.getByLabelText("User")).toHaveAttribute("placeholder", expect.stringMatching(/^e\.g\. /));
    expect(who.getByLabelText("Privileges")).toHaveAttribute("placeholder", expect.stringMatching(/^e\.g\. /));
    expect(who.getByLabelText("Groups")).toBeInTheDocument();
    expect(who.getAllByText("Separate with spaces")).toHaveLength(2);
  });

  describe("read from log", () => {
    const winrm = (id: string, command: string, output: string, over: Partial<LogEntry> = {}): LogEntry => ({
      ...entry(id, command), kind: "command", ranOn: "ms01", content: { kind: "command", blocks: [{ command, output }] }, ...over,
    });
    const PRIV_OUT = "Privilege Name  Description  State\n=== === ===\nSeImpersonatePrivilege  Impersonate a client after authentication  Enabled";
    const GROUP_OUT = "Group Name  Type  SID  Attributes\n=== === === ===\nEveryone  Well-known group  S-1-1-0  Mandatory group";

    it("offers the button, and writes the identity and vectors only when clicked", async () => {
      const user = userEvent.setup();
      m.logList.mockResolvedValue([winrm("l1", "whoami /priv", PRIV_OUT), winrm("l2", "whoami /groups", GROUP_OUT, { at: 2000 })]);
      m.hostIdentitySet.mockImplementation(async (input) => ({ ...input, updatedAt: 2 }));
      m.vectorUpsert.mockResolvedValue(vector("v9", "SeImpersonatePrivilege abuse", "try"));
      mount({ host: after() });
      const who = await group("Who am I");
      const button = await who.findByRole("button", { name: "Read from log (2 found)" });
      expect(m.hostIdentitySet).not.toHaveBeenCalled();
      await user.click(button);
      await waitFor(() => expect(m.hostIdentitySet).toHaveBeenCalledTimes(1));
      expect(m.hostIdentitySet).toHaveBeenCalledWith({
        hostId: "h1", username: "unknown", privileges: ["SeImpersonatePrivilege"], groups: ["Everyone"], entryId: "l2",
      });
      await waitFor(() => expect(m.vectorUpsert).toHaveBeenCalledWith("h1", { title: "SeImpersonatePrivilege abuse", status: "try", source: "auto" }));
    });

    it("a vector that fails to save still shows its error once the identity exists", async () => {
      const user = userEvent.setup();
      m.logList.mockResolvedValue([winrm("l1", "whoami /priv", PRIV_OUT)]);
      m.hostIdentitySet.mockImplementation(async (input) => ({ ...input, updatedAt: 2 }));
      m.vectorUpsert.mockRejectedValue(new Error("vault locked"));
      mount({ host: after() });
      const who = await group("Who am I");
      const button = await who.findByRole("button", { name: "Read from log (1 found)" });
      // Once saved, the identity reloads and the group switches to showing it.
      m.hostIdentityGet.mockResolvedValue({ ...IDENTITY, username: "unknown", privileges: ["SeImpersonatePrivilege"], entryId: "l1" });
      await user.click(button);
      expect(await who.findByText("unknown")).toBeInTheDocument();
      expect(await who.findByRole("alert")).toHaveTextContent("vault locked");
    });

    it("offers the button for a Windows-only whoami /all logged with Ran on Kali", async () => {
      m.logList.mockResolvedValue([winrm("l1", "whoami /all", `PRIVILEGES INFORMATION\n---\n\n${PRIV_OUT}`, { ranOn: "Kali (VM)" })]);
      mount({ host: after() });
      const who = await group("Who am I");
      expect(await who.findByRole("button", { name: "Read from log (1 found)" })).toBeInTheDocument();
    });

    it("shows no button when no entry qualifies", async () => {
      m.logList.mockResolvedValue([winrm("l1", "whoami", "kali", { ranOn: "kali" })]);
      mount({ host: after() });
      const who = await group("Who am I");
      expect(await who.findByText(/Not known yet/)).toBeInTheDocument();
      expect(who.queryByRole("button", { name: /Read from log/ })).not.toBeInTheDocument();
    });
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

  it("a vector's status chip names its toggle in a tooltip on keyboard focus", async () => {
    mount({ host: after(), vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try"), vector("v3", "AlwaysInstallElevated", "ruled_out")] });
    const vectors = await group("Privesc vectors");
    const tryChip = await vectors.findByRole("button", { name: "SeImpersonatePrivilege abuse: try" });
    const reopen = vectors.getByRole("button", { name: "Reopen AlwaysInstallElevated" });
    for (const b of [tryChip, reopen]) expect(b).not.toHaveAttribute("title");
    tryChip.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Mark untested");
    reopen.focus();
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Reopen as untested"));
  });

  it("Mark exploited records that a vector got you higher, without asking", async () => {
    const user = userEvent.setup();
    m.vectorSetStatus.mockImplementation(async (id, status) => vector(id, "x", status));
    mount({ host: after(), vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try")] });
    const vectors = await group("Privesc vectors");
    await user.click(await vectors.findByRole("button", { name: "Mark SeImpersonatePrivilege abuse exploited" }));
    expect(m.vectorSetStatus).toHaveBeenCalledWith("v1", "exploited", undefined);
  });

  it("an exploited vector leads the list on an accent chip, offers only Reopen, and the summary counts it", async () => {
    const user = userEvent.setup();
    m.vectorSetStatus.mockImplementation(async (id, status) => vector(id, "x", status));
    mount({
      host: after(),
      vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try"), vector("v2", "AlwaysInstallElevated", "exploited", { createdAt: 9 })],
    });
    const vectors = await group("Privesc vectors");
    const titles = (await vectors.findAllByRole("listitem")).map((li) => li.querySelector(".vectors-facts__title")?.textContent);
    expect(titles.slice(0, 2)).toEqual(["AlwaysInstallElevated", "SeImpersonatePrivilege abuse"]);
    const reopen = vectors.getByRole("button", { name: "Reopen AlwaysInstallElevated" });
    expect(within(reopen).getByText("exploited")).toHaveAttribute("data-variant", "accent");
    expect(vectors.queryByRole("button", { name: "Rule out AlwaysInstallElevated" })).not.toBeInTheDocument();
    expect(vectors.queryByRole("button", { name: "Mark AlwaysInstallElevated exploited" })).not.toBeInTheDocument();
    await user.click(reopen);
    expect(m.vectorSetStatus).toHaveBeenCalledWith("v2", "untested", undefined);
    await user.click(vectors.getByRole("button", { expanded: true, name: /^Privesc vectors/ }));
    expect(await summaryOf("Privesc vectors")).toBe("Privesc vectors1 exploited1 to try");
  });

  it("deleting a vector asks first", async () => {
    const user = userEvent.setup();
    m.vectorDelete.mockResolvedValue(null);
    mount({ host: after(), vectors: [vector("v1", "SeImpersonatePrivilege abuse", "try")] });
    const del = await (await group("Privesc vectors")).findByRole("button", { name: "Delete SeImpersonatePrivilege abuse" });
    expect(del).toHaveAccessibleName("Delete SeImpersonatePrivilege abuse");
    // Destructive tone: muted at rest, amber only on hover or focus.
    expect(del).toHaveClass("icon-button--destructive");
    await user.click(del);
    expect(m.vectorDelete).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete vector" }));
    expect(m.vectorDelete).toHaveBeenCalledWith("v1");
  });

  it("Other accounts: uncracked hashes once per capture and credentials found on this host, never the identity's own", async () => {
    const tgs = (id: string, tail: string) =>
      cred(id, "svc_sql", { type: "hash", hashType: "krb5tgs", secret: `$krb5tgs$23$*svc_sql$CORP*$${tail}`, crackStatus: "uncracked" });
    mount({
      host: after(),
      identity: IDENTITY,
      creds: [
        tgs("c1", "aaaa"),
        tgs("c1b", "bbbb"), // the same account re-roasted: one row
        cred("c2", "bob", { sourceHostId: "h1" }),
        cred("c3", "carol"), // found elsewhere: not this host's business
        cred("c4", "iis_apppool", { domain: "ms01", sourceHostId: "h1" }), // the account held here
      ],
    });
    const g = await group("Other accounts");
    expect(await g.findByText("CORP\\svc_sql (hash)")).toBeInTheDocument();
    expect(g.getAllByText(/svc_sql/)).toHaveLength(1);
    expect(g.getByText("uncracked")).toBeInTheDocument();
    expect(g.getByText("CORP\\bob")).toBeInTheDocument();
    expect(g.queryByText(/carol/)).not.toBeInTheDocument();
    expect(g.queryByText(/iis_apppool/)).not.toBeInTheDocument();
    expect(g.queryByText(/Winter2024/)).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await toggleOf("Other accounts"));
    expect(await summaryOf("Other accounts")).toMatch(/^Other accounts.*2 accounts$/);
  });

  it("Other accounts shows at most six rows, then +N more; the summary counts them all", async () => {
    const hashes = Array.from({ length: 9 }, (_, i) =>
      cred(`h${i}`, `user${i}`, { type: "hash", hashType: "krb5tgs", secret: `$krb5tgs$23$*user${i}$CORP*$${i}`, crackStatus: "uncracked" }),
    );
    mount({ host: after(), identity: IDENTITY, creds: hashes });
    const g = await group("Other accounts");
    expect(await g.findByText("+3 more on the Credentials page")).toBeInTheDocument();
    expect(g.getAllByText(/\(hash\)$/)).toHaveLength(6);
    const user = userEvent.setup();
    await user.click(await toggleOf("Other accounts"));
    expect(await summaryOf("Other accounts")).toMatch(/^Other accounts.*9 accounts$/);
  });

  it("saving an identity edit adds vectors only for newly added privileges, keeping the user's status on the rest", async () => {
    const user = userEvent.setup();
    m.hostIdentitySet.mockImplementation(async (input) => ({ ...input, updatedAt: 2 }));
    m.vectorUpsert.mockResolvedValue(vector("v9", "SeBackupPrivilege abuse", "try"));
    mount({ host: after(), identity: IDENTITY, vectors: [vector("v1", "SeImpersonatePrivilege abuse", "untested")] });
    const who = await group("Who am I");
    await user.click(await who.findByRole("button", { name: "Edit who am I" }));
    await user.type(who.getByRole("textbox", { name: "Privileges" }), " SeBackupPrivilege");
    await user.click(who.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.vectorUpsert).toHaveBeenCalledWith("h1", { title: "SeBackupPrivilege abuse", status: "try", source: "auto" }));
    expect(m.vectorUpsert).toHaveBeenCalledTimes(1);
  });
});
