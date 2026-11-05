import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { GoalRow } from "../features/checklist/GoalRow";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useCredPickStore } from "../features/checklist/credPick";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem } from "../types/checklist";
import type { CredAttempt, Credential } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Service } from "../types/service";

vi.mock("../lib/api");
vi.mock("../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string, over: Partial<Host> = {}): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "enumerate", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web02", "10.10.10.6", { os: "linux" });
const svc = (id: string, port: number, over: Partial<Service> = {}): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1, ...over,
});
const entry = (id: string, title: string): LogEntry => ({
  id, engagementId: "e1", kind: "note", title, titleEdited: false, ranOn: null, hostIds: ["h1"], observations: null,
  returnedNothing: false, private: false, content: { kind: "note", text: "body" }, at: 1000, createdAt: 1000, updatedAt: 1000,
});
const item = (goalId: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  ownerId: "h1", goalId, status: "todo", notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [],
  updatedAt: 1, ...over,
});

const cred = (id: string, username: string, over: Partial<Credential> = {}): Credential => ({
  id, engagementId: "e1", type: "password", username, domain: "CORP", secret: "Winter2024!", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null,
  createdAt: 1, updatedAt: 1, ...over,
});
const attempt = (id: string, credId: string, at: number, over: Partial<CredAttempt> = {}): CredAttempt => ({
  id, engagementId: "e1", credId, usernameId: null, hostId: "h1", service: "smb", port: null, result: "valid",
  authMode: "domain", detail: null, logEntryId: null, at, ...over,
});

function mount(opts: { engagement?: Engagement; hosts?: Host[]; items?: ChecklistItem[]; services?: Service[]; creds?: Credential[]; attempts?: CredAttempt[] } = {}) {
  m.credentialsList.mockResolvedValue(opts.creds ?? []);
  m.credAttemptsList.mockResolvedValue(opts.attempts ?? []);
  m.engagementGet.mockResolvedValue(opts.engagement ?? E1);
  m.hostsList.mockResolvedValue(opts.hosts ?? [H1, H2]);
  m.checklistList.mockResolvedValue(opts.items ?? []);
  m.servicesListEngagement.mockResolvedValue(opts.services ?? [svc("s1", 445, { nmapService: "microsoft-ds" })]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function openChecklist(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Checklist" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  useCredPickStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444",
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
  m.logList.mockResolvedValue([entry("en1", "nmap sweep")]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.hopCreate.mockResolvedValue({ id: "hp1", engagementId: "e1", fromHostId: null, toHostId: "h1", via: "x", logEntryId: null, at: 1, updatedAt: 1 });
});

describe("host checklist tab", () => {
  it("renders only applicable goals for a windows smb host", async () => {
    const user = userEvent.setup();
    mount();
    await openChecklist(user);
    expect(await within(await screen.findByRole("tabpanel")).findByText("Check SMB shares and null/guest access")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByRole("heading", { name: "Enumerate" })).toBeInTheDocument();
    expect(screen.queryByText("Check FTP for anonymous access")).not.toBeInTheDocument();
    expect(screen.queryByText("Identify the web stack and framework")).not.toBeInTheDocument();
  });

  it("commands are filled with the host IP and the attacker IP setting", async () => {
    const user = userEvent.setup();
    mount();
    await openChecklist(user);
    expect(await screen.findByText("smbclient -N -L //10.10.10.5")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^Copy command: / })[0]);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toContain("10.10.10.5");
  });

  it("unresolved tokens are marked, not blank", async () => {
    const user = userEvent.setup();
    mount();
    await openChecklist(user);
    const marks = await screen.findAllByText("{USER}");
    expect(marks[0].tagName).toBe("MARK");
    expect(marks[0]).toHaveClass("text-warn");
  });

  it("exam-sim host shows no banned command", async () => {
    const user = userEvent.setup();
    const exam = { ...E1, kind: "exam-sim" as const };
    mount({ engagement: exam, services: [svc("s1", 80, { nmapService: "http" })] });
    await openChecklist(user);
    expect(await screen.findByText("Test the web app for injection and upload flaws")).toBeInTheDocument();
    expect(screen.queryByText(/sqlmap/)).not.toBeInTheDocument();
  });

  it("metasploit commands only on the locked host once locked", async () => {
    const user = userEvent.setup();
    const exam = { ...E1, kind: "exam-sim" as const };
    mount({ engagement: exam });
    await openChecklist(user);
    expect((await screen.findAllByText(/uses your one Metasploit host/)).length).toBeGreaterThan(0);
  });

  it("metasploit commands hide on another host once locked", async () => {
    const user = userEvent.setup();
    const exam = { ...E1, kind: "exam-sim" as const, msfHostId: "h2" };
    mount({ engagement: exam });
    await openChecklist(user);
    await within(await screen.findByRole("tabpanel")).findByText("Check SMB shares and null/guest access");
    expect(screen.queryByText(/ms17_010/)).not.toBeInTheDocument();
    expect(screen.queryByText(/uses your one Metasploit host/)).not.toBeInTheDocument();
  });

  it("metasploit commands show without the marker on the locked host itself", async () => {
    const user = userEvent.setup();
    const exam = { ...E1, kind: "exam-sim" as const, msfHostId: "h1" };
    mount({ engagement: exam });
    await openChecklist(user);
    expect((await screen.findAllByText(/ms17_010/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/uses your one Metasploit host/)).not.toBeInTheDocument();
  });

  it("a host behind a tunnel shows the tunnel note, in warn when down", async () => {
    const user = userEvent.setup();
    const tun = (id: string, status: "up" | "down") => ({
      id, engagementId: "e1", kind: "ligolo" as const, viaHostId: "h2", subnets: ["10.10.10.0/24"],
      callbackIp: "10.20.0.1", status, notes: null, createdAt: 1, updatedAt: 1,
    });
    m.tunnelsList.mockResolvedValue([tun("t1", "down")]);
    mount();
    await openChecklist(user);
    const notes = await screen.findAllByText(/via tunnel on web02/);
    expect(notes[0]).toHaveClass("text-warn");
    expect(notes[0]).toHaveTextContent("(down)");
  });

  it("an up tunnel is not styled as a warning", async () => {
    const user = userEvent.setup();
    m.tunnelsList.mockResolvedValue([
      { id: "t1", engagementId: "e1", kind: "ligolo", viaHostId: "h2", subnets: ["10.10.10.0/24"], callbackIp: "10.20.0.1", status: "up", notes: null, createdAt: 1, updatedAt: 1 },
    ]);
    mount();
    await openChecklist(user);
    const notes = await screen.findAllByText(/via tunnel on web02/);
    expect(notes[0]).not.toHaveClass("text-warn");
  });

  it("shows an error line when the checklist data fails to load", async () => {
    const user = userEvent.setup();
    mount();
    m.servicesListEngagement.mockRejectedValue(new Error("boom"));
    await openChecklist(user);
    expect(await within(await screen.findByRole("tabpanel")).findByRole("alert")).toHaveTextContent("boom");
  });

  it("a failed tick after the hop was created retries only the tick (hopCreate called once)", async () => {
    const user = userEvent.setup();
    mount();
    m.checklistPut.mockRejectedValueOnce(new Error("tick failed"));
    await openChecklist(user);
    await user.type(await screen.findByLabelText("Via"), "smb creds");
    await user.click(screen.getByRole("button", { name: "Save hop" }));
    expect(await screen.findByText(/tick failed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save hop" }));
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalledTimes(2));
    expect(m.hopCreate).toHaveBeenCalledTimes(1);
  });

  it("status buttons call checklistPut with auto false", async () => {
    const user = userEvent.setup();
    mount({ items: [item("h-enum-smb", { status: "in_progress", auto: true })] });
    await openChecklist(user);
    const group = await screen.findByRole("group", { name: "Status: Check SMB shares and null/guest access" });
    await user.click(within(group).getByRole("button", { name: "Done" }));
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    const sent = m.checklistPut.mock.calls[0][1][0];
    expect(sent).toMatchObject({ ownerId: "h1", goalId: "h-enum-smb", status: "done", auto: false });
  });

  it("evidence chip opens the Story tab with the entry expanded", async () => {
    const user = userEvent.setup();
    mount({ items: [item("h-enum-smb", { evidence: [{ entryId: "en1" }, { entryId: "gone" }] })] });
    await openChecklist(user);
    expect(await screen.findByText("log entry removed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /nmap sweep/ }));
    expect(screen.getByRole("tab", { name: "Story" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /nmap sweep/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("recording arrived-from creates a hop and ticks the goal", async () => {
    const user = userEvent.setup();
    mount();
    await openChecklist(user);
    await user.type(await screen.findByLabelText("Via"), "smb creds");
    await user.click(screen.getByRole("button", { name: "Save hop" }));
    await vi.waitFor(() =>
      expect(m.hopCreate).toHaveBeenCalledWith("e1", { fromHostId: null, toHostId: "h1", via: "smb creds" }),
    );
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    expect(m.checklistPut.mock.calls[0][1][0]).toMatchObject({ goalId: "h-foot-arrived", status: "done", auto: false });
  });
});

describe("credential fill on the checklist", () => {
  const tab = async () => within(await screen.findByRole("tabpanel"));
  const pickerOf = async () => (await tab()).findByRole("combobox", { name: "Commands use" });

  it("picker defaults to the newest credential with access on the host", async () => {
    const user = userEvent.setup();
    mount({
      creds: [cred("c1", "alice"), cred("c2", "bob"), cred("c3", "carol")],
      attempts: [attempt("a1", "c1", 10), attempt("a2", "c2", 20, { result: "admin" }), attempt("a3", "c3", 30, { result: "failed" })],
    });
    await openChecklist(user);
    expect(await pickerOf()).toHaveTextContent("CORP\\bob");
    expect((await tab()).getAllByText(/-u bob/).length).toBeGreaterThan(0);
    // The choice is remembered per host, so Now follows it.
    await user.click(await pickerOf());
    await user.click(await screen.findByRole("option", { name: "None" }));
    expect(await pickerOf()).toHaveTextContent("None");
    expect((await tab()).queryByText(/-u bob/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Now" })).getByRole("combobox", { name: "Commands use" })).toHaveTextContent("None");
  });

  it("two credentials with the same label get a distinguishing suffix", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred("c1", "alice"), cred("c2", "alice", { secret: "Other1" })], attempts: [attempt("a1", "c1", 10)] });
    await openChecklist(user);
    expect(await pickerOf()).toHaveTextContent("CORP\\alice · #1");
    await user.click(await pickerOf());
    expect(await screen.findByRole("option", { name: "CORP\\alice · #2" })).toBeInTheDocument();
  });

  it("the pick resets on lock: after unlock the default is back", async () => {
    const user = userEvent.setup();
    m.vaultLock.mockResolvedValue(null);
    m.vaultUnlock.mockResolvedValue({ migratedFrom: 3, migratedTo: 3, dailyBackup: null, dailyBackupError: null });
    mount({ creds: [cred("c1", "alice")], attempts: [attempt("a1", "c1", 10)] });
    await openChecklist(user);
    await user.click(await pickerOf());
    await user.click(await screen.findByRole("option", { name: "None" }));
    expect(await pickerOf()).toHaveTextContent("None");
    await user.keyboard("{Meta>}l{/Meta}");
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
    await openChecklist(user);
    expect(await pickerOf()).toHaveTextContent("CORP\\alice");
  });

  it("displayed command masks PASS; copy has it", async () => {
    const user = userEvent.setup();
    mount({ creds: [cred("c1", "alice", { secret: "Pa'ss-W0rd" })], attempts: [attempt("a1", "c1", 10)] });
    await openChecklist(user);
    const panel = await tab();
    await panel.findAllByText(/-u alice/);
    expect(screen.queryByText(/Pa'ss-W0rd/)).not.toBeInTheDocument();
    const pre = [...document.querySelectorAll("pre")].find((p) => p.textContent?.includes("••••••••"));
    expect(pre).toBeDefined();
    await user.click(within(pre!.closest("li")!).getByRole("button", { name: /^Copy command: / }));
    expect(await navigator.clipboard.readText()).toContain(String.raw`Pa'\''ss-W0rd`);
  });
});

describe("GoalRow", () => {
  it("says so when exam rules removed every command", () => {
    render(
      <GoalRow
        goal={{ id: "g", title: "Do it" }}
        state={undefined}
        commands={[]}
        evidence={[]}
        emptyCommandsText="Nothing allowed in an exam sim; do it by hand"
        onStatus={() => {}}
        onNotes={() => {}}
      />,
    );
    expect(screen.getByText("Nothing allowed in an exam sim; do it by hand")).toBeInTheDocument();
  });
});
