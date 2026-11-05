import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useCredPickStore } from "../features/checklist/credPick";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { ChecklistItem } from "../types/checklist";
import type { CredAttempt, Credential } from "../types/credentials";
import type { Hop, Tunnel } from "../types/network";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string, os: Host["os"]): Host => ({
  id, engagementId: "e1", name, ip, os, boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5", "windows");
const H2 = host("h2", "web02", "10.10.10.6", "linux");
const svc = (id: string, port: number): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1,
});
const AD = [svc("s88", 88), svc("s389", 389)];
const hop = (): Hop => ({ id: "hp1", engagementId: "e1", fromHostId: null, toHostId: "h1", via: "creds", logEntryId: null, at: 1, updatedAt: 1 });
const flagEntry: LogEntry = {
  id: "f1", engagementId: "e1", kind: "flag", title: "local flag", titleEdited: false, ranOn: null, hostIds: ["h2"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef" }, at: 1000, createdAt: 1000, updatedAt: 1000,
};

const cred = (id: string, over: Partial<Credential> = {}): Credential => ({
  id, engagementId: "e1", type: "password", username: "svc_sql", domain: "CORP", secret: "Winter2024!", hashType: null,
  scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 10, updatedAt: 10, ...over,
});
const attempt = (id: string, credId: string, over: Partial<CredAttempt> = {}): CredAttempt => ({
  id, engagementId: "e1", credId, usernameId: null, hostId: "h1", service: "winrm", port: null, result: "valid",
  authMode: "domain", detail: null, logEntryId: null, at: 100, ...over,
});

function mount(opts: { services?: Service[]; hops?: Hop[]; log?: LogEntry[]; tunnels?: Tunnel[]; creds?: Credential[]; attempts?: CredAttempt[]; items?: ChecklistItem[]; hosts?: Host[]; eng?: Engagement } = {}) {
  m.credentialsList.mockResolvedValue(opts.creds ?? []);
  m.credAttemptsList.mockResolvedValue(opts.attempts ?? []);
  m.engagementGet.mockResolvedValue(opts.eng ?? E1);
  m.hostsList.mockResolvedValue(opts.hosts ?? [H1, H2]);
  m.checklistList.mockResolvedValue(opts.items ?? []);
  m.servicesListEngagement.mockResolvedValue(opts.services ?? []);
  m.hopsList.mockResolvedValue(opts.hops ?? []);
  m.tunnelsList.mockResolvedValue(opts.tunnels ?? []);
  m.logList.mockResolvedValue(opts.log ?? []);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/s/checklist"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  useCredPickStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.hostSyncBoard.mockResolvedValue(H1);
});

describe("engagement checklist", () => {
  it("clock sync shows only with an AD host", async () => {
    mount();
    expect(await screen.findByText("Add the /etc/hosts lines")).toBeInTheDocument();
    expect(screen.queryByText("Sync the clock to the DC")).not.toBeInTheDocument();
  });

  it("clock sync shows with an AD host", async () => {
    mount({ services: AD });
    // The second match is the library command of the same title inside the goal row, not a second goal row.
    expect((await screen.findAllByText("Sync the clock to the DC")).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('li[data-goal-id="e-setup-clock"]')).toHaveLength(1);
  });

  it("no-credentials playbook opens with an AD host; the others stay closed", async () => {
    const user = userEvent.setup();
    mount({ services: AD });
    expect(await screen.findByText("Try null, guest and anonymous SMB")).toBeInTheDocument();
    expect(screen.queryByText("RID cycle with the credential")).not.toBeInTheDocument();
    expect(screen.queryByText(/Opens automatically once credentials arrive/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /First domain user/ }));
    expect((await screen.findAllByText("RID cycle with the credential")).length).toBeGreaterThan(0);
  });

  it("no-credentials playbook stays closed without an AD host", async () => {
    mount();
    await screen.findByText("Add the /etc/hosts lines");
    expect(screen.queryByText("Try null, guest and anonymous SMB")).not.toBeInTheDocument();
  });

  it("adding a tunnel validates subnets and lists it", async () => {
    const user = userEvent.setup();
    const created: Tunnel = {
      id: "t1", engagementId: "e1", kind: "ligolo", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "10.10.14.9",
      status: "up", notes: null, createdAt: 1, updatedAt: 1,
    };
    m.tunnelCreate.mockResolvedValue(created);
    mount();
    await user.click(await screen.findByRole("button", { name: "Add tunnel" }));
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24, nonsense");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(await within(dialog).findByText(/Not a valid subnet: nonsense/)).toBeInTheDocument();
    expect(m.tunnelCreate).not.toHaveBeenCalled();

    m.tunnelsList.mockResolvedValue([created]);
    await user.clear(within(dialog).getByLabelText("Subnets"));
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24");
    await user.type(within(dialog).getByLabelText("Callback IP"), "10.10.14.9");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(m.tunnelCreate).toHaveBeenCalledWith("e1", {
      kind: "ligolo", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "10.10.14.9", status: "up",
    });
    expect(await screen.findByText("10.20.0.0/24")).toBeInTheDocument();
  });

  it("shows a server field error on the tunnel dialog", async () => {
    const user = userEvent.setup();
    m.tunnelCreate.mockRejectedValue(Object.assign(new Error("Not an IPv4 address"), { field: "callbackIp" }));
    mount();
    await user.click(await screen.findByRole("button", { name: "Add tunnel" }));
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(await within(dialog).findByText("Not an IPv4 address")).toBeInTheDocument();
  });

  it("a hop to the DC opens the Domain admin playbook", async () => {
    mount({ services: AD, hops: [hop()] });
    expect(await screen.findByText(/dc01.*creds|Kali.*dc01/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Domain admin/, expanded: true })).toBeInTheDocument();
  });

  it("Domain admin stays closed without a hop to the DC", async () => {
    mount({ services: AD });
    await screen.findByText("Try null, guest and anonymous SMB");
    expect(screen.getByRole("button", { name: /Domain admin/, expanded: false })).toBeInTheDocument();
  });

  it("First domain user opens once a domain credential has a valid domain attempt", async () => {
    mount({ services: AD, creds: [cred("c1")], attempts: [attempt("a1", "c1")] });
    expect(await screen.findByRole("button", { name: /First domain user/, expanded: true })).toBeInTheDocument();
    // Having a working domain credential closes the no-credentials playbook.
    expect(screen.getByRole("button", { name: /No credentials/, expanded: false })).toBeInTheDocument();
  });

  it("RID cycle with the credential shows USER filled and PASS masked, and copies the real values", async () => {
    const user = userEvent.setup();
    mount({ services: AD, creds: [cred("c1", { secret: "Pa'ss w0rd" })], attempts: [attempt("a1", "c1")] });
    await screen.findAllByText("RID cycle with the credential");
    const pre = [...document.querySelectorAll("pre")].find((p) => p.textContent?.startsWith("nxc smb") && p.textContent.includes("--rid-brute"))!;
    expect(pre.textContent).toContain("-u svc_sql -p '••••••••'");
    expect(document.body.textContent).not.toContain("Pa'ss");
    await user.click(within(pre.closest("li")!).getByRole("button", { name: /^Copy command: / }));
    expect(await navigator.clipboard.readText()).toContain(String.raw`-u svc_sql -p 'Pa'\''ss w0rd'`);
  });

  it("the engagement picker defaults to the working domain credential and can be set to none", async () => {
    const user = userEvent.setup();
    mount({ services: AD, creds: [cred("c1")], attempts: [attempt("a1", "c1")] });
    const picker = await screen.findByRole("combobox", { name: "Commands use" });
    expect(picker).toHaveTextContent("CORP\\svc_sql");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "None" }));
    expect(screen.getByRole("combobox", { name: "Commands use" })).toHaveTextContent("None");
  });

  it("local-auth-only success does not open it", async () => {
    mount({ services: AD, creds: [cred("c1")], attempts: [attempt("a1", "c1", { authMode: "local" })] });
    await screen.findByText("Try null, guest and anonymous SMB");
    expect(screen.getByRole("button", { name: /First domain user/, expanded: false })).toBeInTheDocument();
  });

  it("an admin attempt on the DC opens Domain admin", async () => {
    mount({ services: AD, creds: [cred("c1")], attempts: [attempt("a1", "c1", { result: "admin" })] });
    expect(await screen.findByRole("button", { name: /Domain admin/, expanded: true })).toBeInTheDocument();
  });

  it("access flag appears for a new valid attempt and Reviewed clears it", async () => {
    const user = userEvent.setup();
    let reviewed = false;
    m.hostMarkAccessReviewed.mockImplementation(async () => {
      reviewed = true;
      return { ...H1, accessReviewedAt: 200 };
    });
    mount({ services: AD, creds: [cred("c1")], attempts: [attempt("a1", "c1", { result: "admin" })] });
    m.hostsList.mockImplementation(async () => [reviewed ? { ...H1, accessReviewedAt: 200 } : H1, H2]);
    const flags = await screen.findByRole("region", { name: "New access" });
    expect(within(flags).getByText("dc01: admin over winrm as CORP\\svc_sql")).toBeInTheDocument();
    await user.click(within(flags).getByRole("button", { name: "Reviewed" }));
    expect(m.hostMarkAccessReviewed).toHaveBeenCalledWith("h1");
    await waitFor(() => expect(screen.queryByText(/admin over winrm/)).not.toBeInTheDocument());
  });

  it("a bare-username access flag names the username, not the secret's credential", async () => {
    m.usernamesList.mockResolvedValue([{ id: "u1", engagementId: "e1", username: "alice", domain: "CORP", sourceHostId: null, source: null, createdAt: 1 }]);
    mount({ services: AD, creds: [cred("c1")], attempts: [attempt("a1", "c1", { usernameId: "u1", result: "valid" })] });
    const flags = await screen.findByRole("region", { name: "New access" });
    expect(await within(flags).findByText("dc01: valid over winrm as CORP\\alice")).toBeInTheDocument();
  });

  it("a done goal shows new credential since for a later domain credential", async () => {
    const done: ChecklistItem = { ownerId: "e1", goalId: "e-setup-clock", status: "done", notes: null, completedAt: 5, auto: false, autoFrom: null, evidence: [], updatedAt: 1 };
    mount({ services: AD, items: [done], creds: [cred("c1", { createdAt: 50 })] });
    await screen.findAllByText("Sync the clock to the DC");
    const row = document.querySelector('li[data-goal-id="e-setup-clock"]') as HTMLElement;
    expect(within(row).getByText(/New credential since/)).toHaveTextContent("CORP\\svc_sql");
  });

  it("no new credential badge when the credential is older than the done goal", async () => {
    const done: ChecklistItem = { ownerId: "e1", goalId: "e-setup-clock", status: "done", notes: null, completedAt: 500, auto: false, autoFrom: null, evidence: [], updatedAt: 1 };
    mount({ services: AD, items: [done], creds: [cred("c1", { createdAt: 50 })] });
    await screen.findAllByText("Sync the clock to the DC");
    expect(screen.queryByText(/New credential since/)).not.toBeInTheDocument();
  });

  it("Tick from log re-derives a tick that was missing and reports the count", async () => {
    const user = userEvent.setup();
    mount({ log: [flagEntry] });
    await user.click(await screen.findByRole("button", { name: "Tick from log" }));
    const section = screen.getByRole("region", { name: "Engagement checklist" });
    expect(await within(section).findByText("Updated 1 goal")).toBeInTheDocument();
    expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ ownerId: "h2", goalId: "h-orient-proof", status: "done" })]);
  });

  it("Tick from log re-fetches the checklist and shows the repaired goal as done", async () => {
    const user = userEvent.setup();
    let repaired = false;
    mount({ services: AD });
    // tickFromLog reads the log; from then on the store holds the repaired tick.
    m.logList.mockImplementation(async () => {
      repaired = true;
      return [];
    });
    m.checklistList.mockImplementation(async () =>
      repaired ? [{ ownerId: "e1", goalId: "e-setup-clock", status: "done", notes: null, completedAt: 5, auto: true, autoFrom: null, evidence: [], updatedAt: 1 }] : [],
    );
    await screen.findAllByText("Sync the clock to the DC");
    const hostReads = m.hostsList.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Tick from log" }));
    await waitFor(() => {
      const row = screen.getAllByText("Sync the clock to the DC")[0]!.closest("li")!;
      expect(within(row).getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
    });
    await waitFor(() => expect(m.hostsList.mock.calls.length).toBeGreaterThan(hostReads));
  });

  it("shows an alert when settings fail to load", async () => {
    m.settingsGet.mockRejectedValue(new Error("settings broke"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("settings broke");
  });

  it("a hop cannot go from a host to itself", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add hop" }));
    const dialog = await screen.findByRole("dialog", { name: "Add hop" });
    await user.click(within(dialog).getByRole("combobox", { name: /^From/ }));
    await user.click(await screen.findByRole("option", { name: "dc01" }));
    await user.type(within(dialog).getByLabelText("Via"), "creds");
    await user.click(within(dialog).getByRole("button", { name: "Add hop" }));
    expect(await within(dialog).findByText("A hop needs two different hosts")).toBeInTheDocument();
    expect(m.hopCreate).not.toHaveBeenCalled();
  });

  it("deleting a hop or tunnel asks first", async () => {
    const user = userEvent.setup();
    const t: Tunnel = { id: "t1", engagementId: "e1", kind: "chisel", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "", status: "up", notes: null, createdAt: 1, updatedAt: 1 };
    m.hopDelete.mockResolvedValue(null);
    m.tunnelDelete.mockResolvedValue(null);
    mount({ hops: [hop()], tunnels: [t] });
    await user.click(await screen.findByRole("button", { name: /^Delete hop/ }));
    expect(m.hopDelete).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(m.hopDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Delete hop/ }));
    await user.click(await screen.findByRole("button", { name: "Delete hop" }));
    expect(m.hopDelete).toHaveBeenCalledWith("hp1");

    await user.click(await screen.findByRole("button", { name: /^Delete chisel tunnel/ }));
    expect(m.tunnelDelete).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Delete tunnel" }));
    expect(m.tunnelDelete).toHaveBeenCalledWith("t1");
  });

  it("setup follows Off-the-Bat order with groups", async () => {
    mount();
    await screen.findByText("Add the /etc/hosts lines");
    const setup = screen.getByRole("heading", { name: "Setup" }).parentElement!;
    const heads = within(setup).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(heads).toEqual(["Workspace", "Network", "Scope", "Kick off scans"]);
    const ids = [...setup.querySelectorAll("li[data-goal-id]")].map((li) => li.getAttribute("data-goal-id"));
    expect(ids).toEqual(["e-setup-logging", "e-setup-vpn", "e-setup-reach", "e-setup-kind", "e-setup-scope", "e-setup-hosts", "e-setup-scans", "e-setup-assumed-breach"]);
  });

  it("exam-rules step shows only in exam sims", async () => {
    mount();
    await screen.findByText("Add the /etc/hosts lines");
    expect(document.querySelector('li[data-goal-id="e-setup-exam-rules"]')).toBeNull();
    cleanup();
    mount({ eng: { ...E1, kind: "exam-sim" } });
    expect(await screen.findByText("Note the start time, the Metasploit allowance and the proof rules")).toBeInTheDocument();
  });

  it("lateral movement lists pivot steps behind each dual-homed host with filled commands", async () => {
    mount({ hosts: [{ ...H1, dualHomed: true }, { ...H2, dualHomed: true }] });
    const section = within(await screen.findByRole("region", { name: "Lateral movement" }));
    expect(section.getByRole("heading", { name: "Behind dc01" })).toBeInTheDocument();
    expect(section.getByRole("heading", { name: "Behind web02" })).toBeInTheDocument();
    const tunnels = document.querySelectorAll('li[data-goal-id="h-pivot-tunnel"]');
    expect(tunnels).toHaveLength(2);
    for (const li of tunnels) expect(within(li as HTMLElement).getAllByRole("button", { name: /^Copy command: / }).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('li[data-goal-id="h-pivot-sweep"]')).toHaveLength(2);
    expect(document.querySelector('li[data-goal-id="e-lat-record-hop"]')).not.toBeNull();
  });

  it("ticking a pivot step writes the host as owner", async () => {
    const user = userEvent.setup();
    mount({ hosts: [{ ...H1, dualHomed: true }, H2] });
    await screen.findByRole("region", { name: "Lateral movement" });
    const li = document.querySelector('li[data-goal-id="h-pivot-tunnel"]') as HTMLElement;
    await user.click(within(li).getByRole("button", { name: /done/i }));
    expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ ownerId: "h1", goalId: "h-pivot-tunnel" })]);
  });

  it("lateral movement is closed with no dual-homed host and no untried credential", async () => {
    mount();
    const toggle = await screen.findByRole("button", { name: /Lateral movement/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('li[data-goal-id="e-lat-spray"]')).toBeNull();
  });

  it("lateral movement opens for a credential not yet tried on a host with a sprayable service", async () => {
    mount({ services: [{ ...svc("s445", 445) }], creds: [cred("c1")] });
    await screen.findByRole("region", { name: "Lateral movement" });
    expect(await screen.findByRole("button", { name: /Lateral movement/ })).toHaveAttribute("aria-expanded", "true");
  });
});
