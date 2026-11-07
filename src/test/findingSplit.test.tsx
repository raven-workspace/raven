import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useFindingDraftStore } from "../features/findings/useFindingDraftStore";
import { resetNotesStore } from "../features/notes/useNotesStore";
import { api } from "../lib/api";
import { reportError } from "../lib/lockSignal";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import { RavenError, type ErrorCode } from "../types/errors";
import type { Finding, NvdRecord } from "../types/findings";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "vulnerability-detection", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web01", "10.10.10.6");
const svc = (id: string, hostId: string, port: number, over: Partial<Service> = {}): Service => ({
  id, hostId, port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1, ...over,
});
const S1 = svc("s1", "h1", 80, { nmapService: "http", confirmedProduct: "IIS", confirmedVersion: "10.0" });
const S2 = svc("s2", "h2", 22, { nmapService: "ssh" });
const T = new Date(2026, 10, 4, 9, 5).getTime();
const entry = (id: string, title: string, hostIds: string[], text = "body", at = T): LogEntry => ({
  id, engagementId: "e1", kind: "note", title, titleEdited: false, ranOn: null, hostIds, observations: null,
  returnedNothing: false, private: false, content: { kind: "note", text }, at, createdAt: at, updatedAt: at,
});
const L1 = entry("l1", "nmap sweep", ["h1"], "Apache looks like CVE-2021-41773");
const L2 = entry("l2", "upload the shell", ["h1"], "see EDB-ID: 50383", T + 1000);
const L3 = entry("l3", "web probe", ["h2"], "nothing");
const finding = (o: Partial<Finding> & { id: string; title: string }): Finding => ({
  engagementId: "e1", severity: null, cvssVector: null, cvssScore: null, status: "draft", description: "", impact: "",
  remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [],
  createdAt: 1, updatedAt: 1, ...o,
});
const V31 = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N";
const record = (o: Partial<NvdRecord> = {}): NvdRecord => ({
  cveId: "CVE-2021-41773", description: "Path traversal in Apache 2.4.49.", vector: V31, score: 7.5, cwes: ["CWE-22"],
  references: [], published: null, lastModified: null, ...o,
});

function mount(path = "/e/e1/h/h1", findings: Finding[] = []) {
  m.findingsList.mockResolvedValue(findings);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  resetNotesStore();
  useFindingDraftStore.getState().clearAll();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.vaultLock.mockResolvedValue(null);
  m.vaultUnlock.mockResolvedValue({ migratedFrom: 3, migratedTo: 3, dailyBackup: null, dailyBackupError: null });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1, H2]);
  m.servicesList.mockImplementation(async (hostId) => [S1, S2].filter((s) => s.hostId === hostId));
  m.servicesListEngagement.mockResolvedValue([S1, S2]);
  m.logList.mockResolvedValue([L1, L2, L3]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.notesGet.mockImplementation(async (_e, hostId) => ({ ownerId: hostId ?? "e1", engagementId: "e1", hostId, body: "", private: false, updatedAt: 0 }));
  m.noteSave.mockImplementation(async (_e, hostId, body, isPrivate) => ({ ownerId: hostId ?? "e1", engagementId: "e1", hostId, body, private: isPrivate, updatedAt: 9 }));
  m.findingFilesList.mockResolvedValue([]);
  m.findingCreate.mockImplementation(async (_e, input) => finding({ id: "f9", ...input, title: input.title }));
  m.findingUpdate.mockImplementation(async (id, input) => finding({ id, ...input, title: input.title }));
});

type User = ReturnType<typeof userEvent.setup>;

async function openSplit(user: User) {
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("f");
  return await screen.findByRole("form", { name: "New finding" });
}
const stepTitles = (form: HTMLElement) =>
  within(form).queryAllByTestId("step-title").map((e) => e.textContent);
const contextTabs = () => screen.getByRole("tablist", { name: "Finding context" });

async function addRef(user: User, form: HTMLElement, ref: string) {
  await user.type(within(form).getByLabelText("Add reference"), `${ref}{Enter}`);
}

describe("finding split editor", () => {
  it("F on a host page shows a form named New finding beside a Log tab, with no dialog", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    expect(within(contextTabs()).getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The host is filled in.
    expect(within(form).getByRole("button", { name: "dc01" })).toHaveAttribute("aria-pressed", "true");
    expect(within(form).getByRole("button", { name: "web01" })).toHaveAttribute("aria-pressed", "false");
    // The host's log stays live on the left; another host's entry is not there.
    expect(await screen.findByRole("button", { name: "Add nmap sweep as a step" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add web probe as a step" })).not.toBeInTheDocument();
  });

  it("clicking a Log row adds it to the Steps list, in order; Enter on a focused row too", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    await user.click(await screen.findByRole("button", { name: "Add upload the shell as a step" }));
    expect(stepTitles(form)).toEqual(["upload the shell"]);
    screen.getByRole("button", { name: "Add nmap sweep as a step" }).focus();
    await user.keyboard("{Enter}");
    expect(stepTitles(form)).toEqual(["upload the shell", "nmap sweep"]);
    // Already a step: a second click adds nothing.
    await user.click(screen.getByRole("button", { name: /^upload the shell, step 1/ }));
    expect(stepTitles(form)).toEqual(["upload the shell", "nmap sweep"]);
    await user.type(within(form).getByLabelText("Title"), "Shell upload");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      title: "Shell upload", hostIds: ["h1"], stepEntryIds: ["l2", "l1"],
    })));
    // Saved: the split closes and the draft is gone.
    await waitFor(() => expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument());
    expect(useFindingDraftStore.getState().drafts).toEqual({});
  });

  it("Esc closes, and pressing F again restores the typed title", async () => {
    const user = userEvent.setup();
    mount();
    let form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Kerberoastable svc_sql");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument();
    // Esc closed the split only: still on the host page.
    expect(screen.getByRole("tab", { name: "Next" })).toBeInTheDocument();
    form = await openSplit(user);
    expect(within(form).getByLabelText("Title")).toHaveValue("Kerberoastable svc_sql");
    // Discarding asks first, then starts clean.
    await user.click(within(form).getByRole("button", { name: "Discard changes" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument();
    form = await openSplit(user);
    expect(within(form).getByLabelText("Title")).toHaveValue("");
  });

  it("drafts are cleared on lock", async () => {
    const user = userEvent.setup();
    mount();
    let form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "secret draft");
    expect(Object.keys(useFindingDraftStore.getState().drafts)).toHaveLength(1);
    await user.keyboard("{Meta>}l{/Meta}");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(useFindingDraftStore.getState().drafts).toEqual({});
    await user.type(screen.getByLabelText("Password"), "correct horse battery{Enter}");
    form = await openSplit(user);
    expect(within(form).getByLabelText("Title")).toHaveValue("");
  });

  it("drafts are cleared when a command answers locked", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "secret draft");
    act(() => reportError(new RavenError("locked", "Vault is locked")));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(useFindingDraftStore.getState().drafts).toEqual({});
  });

  it("the services picker lists only the selected hosts' services and shows the confirmed IIS 10.0, not http", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    const picker = within(form).getByRole("group", { name: "Affected services" });
    const iis = within(picker).getByRole("checkbox", { name: "80/tcp IIS 10.0" });
    expect(within(picker).queryByText(/http/)).not.toBeInTheDocument();
    expect(within(picker).queryByRole("checkbox", { name: /22\/tcp/ })).not.toBeInTheDocument();
    await user.click(iis);
    expect(iis).toBeChecked();
    // A second host brings its services, under its name.
    await user.click(within(form).getByRole("button", { name: "web01" }));
    expect(within(picker).getByRole("checkbox", { name: "22/tcp ssh" })).toBeInTheDocument();
    // Unselecting a host drops its services from the finding.
    await user.click(within(form).getByRole("button", { name: "dc01" }));
    expect(within(picker).queryByRole("checkbox", { name: "80/tcp IIS 10.0" })).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "dc01" }));
    expect(within(picker).getByRole("checkbox", { name: "80/tcp IIS 10.0" })).not.toBeChecked();
  });

  it("several affected hosts get a host switcher; steps come from any of them", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    expect(screen.queryByRole("group", { name: "Host" })).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "web01" }));
    const switcher = screen.getByRole("group", { name: "Host" });
    await user.click(within(switcher).getByRole("button", { name: "web01" }));
    await user.click(await screen.findByRole("button", { name: "Add web probe as a step" }));
    expect(stepTitles(form)).toEqual(["web probe"]);
  });

  it("references from this host's log and notes are offered as chips, minus those added", async () => {
    const user = userEvent.setup();
    m.notesList.mockResolvedValue([{ ownerId: "h1", engagementId: "e1", hostId: "h1", body: "try CVE-2019-0708 later", private: false, updatedAt: 3 }]);
    m.nvdLookup.mockRejectedValue(new RavenError("no_key", "No NVD key"));
    mount();
    const form = await openSplit(user);
    const chips = within(form).getByRole("group", { name: "Suggested references" });
    expect(await within(chips).findByRole("button", { name: "Add CVE-2019-0708" })).toBeInTheDocument();
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["CVE-2021-41773", "EDB-50383", "CVE-2019-0708"]);
    await user.click(within(chips).getByRole("button", { name: "Add EDB-50383" }));
    expect(within(form).getByText("EDB-50383", { selector: "span" })).toBeInTheDocument();
    expect(within(chips).queryByRole("button", { name: "Add EDB-50383" })).not.toBeInTheDocument();
    // EDB ids are not looked up; a CVE chip is.
    expect(m.nvdLookup).not.toHaveBeenCalled();
    await user.click(within(chips).getByRole("button", { name: "Add CVE-2021-41773" }));
    await waitFor(() => expect(m.nvdLookup).toHaveBeenCalledWith("CVE-2021-41773"));
  });

  it("with nvdLookup rejecting offline, the No connection line shows and Save still calls findingCreate", async () => {
    const user = userEvent.setup();
    m.nvdLookup.mockRejectedValue(new RavenError("offline", "offline"));
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Apache path traversal");
    await addRef(user, form, "CVE-2021-41773");
    expect(await within(form).findByText("No connection · use the builder")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      title: "Apache path traversal", refs: ["CVE-2021-41773"], cvssVector: null,
    })));
  });

  it.each<[ErrorCode, string, string]>([
    ["no_key", "No NVD key", "Add an NVD API key in Settings to look up CVEs · use the builder"],
    ["key_rejected", "NVD refused the request (key rejected or rate-limited)", "NVD refused the request (key rejected or rate-limited)"],
    ["not_found", "missing", "CVE not found on NVD"],
  ])("lookup failure leaves the form savable (%s)", async (code, message, line) => {
    const user = userEvent.setup();
    m.nvdLookup.mockRejectedValue(new RavenError(code, message));
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Something");
    await addRef(user, form, "CVE-2021-41773");
    expect(await within(form).findByText(line)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalled());
  });

  it("an NVD result fills empty fields and offers a diff for typed ones", async () => {
    const user = userEvent.setup();
    m.nvdLookup.mockResolvedValue(record({ references: ["https://www.exploit-db.com/exploits/50383"] }));
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Description"), "My words.");
    await addRef(user, form, "CVE-2021-41773");
    await waitFor(() => expect(within(form).getByLabelText("CVSS vector")).toHaveValue(V31));
    expect(within(form).getByLabelText("Description")).toHaveValue("My words.");
    expect(within(form).getByText("EDB-50383", { selector: "span" })).toBeInTheDocument();
    expect(within(form).getByText("CWE-22", { selector: "span" })).toBeInTheDocument();
    expect(within(form).getByText(/NVD has a different description/)).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "use NVD" }));
    expect(within(form).getByLabelText("Description")).toHaveValue("Path traversal in Apache 2.4.49.");
    expect(within(form).queryByText(/NVD has a different/)).not.toBeInTheDocument();
  });

  it("N selects the Notes tab instead of opening the notes panel; H closes the split and keeps the draft", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "keep me");
    await user.click(document.body);
    await user.keyboard("n");
    expect(within(contextTabs()).getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("complementary", { name: /^Notes/ })).not.toBeInTheDocument();
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    expect(notes).toHaveFocus();
    await user.type(notes, "found it");
    await waitFor(() => expect(m.noteSave).toHaveBeenCalledWith("e1", "h1", "found it", false));
    await user.click(document.body);
    await user.keyboard("h");
    expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument();
    expect(await screen.findByRole("complementary", { name: /Stuck on dc01/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const again = await openSplit(user);
    expect(within(again).getByLabelText("Title")).toHaveValue("keep me");
  });

  it("⌘\\ flips between the panes", async () => {
    const user = userEvent.setup();
    mount();
    await openSplit(user);
    const split = screen.getByTestId("finding-split");
    expect(split).toHaveAttribute("data-pane", "editor");
    await user.keyboard("{Meta>}\\{/Meta}");
    expect(split).toHaveAttribute("data-pane", "context");
    await user.keyboard("{Meta>}\\{/Meta}");
    expect(split).toHaveAttribute("data-pane", "editor");
  });

  it("a finding on the Findings tab opens in the split for editing", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", [finding({ id: "f1", title: "Open share", hostIds: ["h1"], stepEntryIds: ["l1"] })]);
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    await user.click(await screen.findByRole("button", { name: "Open Open share" }));
    const form = await screen.findByRole("form", { name: "Edit finding" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(stepTitles(form)).toEqual(["nmap sweep"]);
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalledWith("f1", expect.objectContaining({ stepEntryIds: ["l1"] })));
  });

  it("the engagement Findings section opens the same split; with no host it shows the engagement Log", async () => {
    const user = userEvent.setup();
    mount("/e/e1/s/findings");
    await user.click(await screen.findByRole("button", { name: "Add finding" }));
    await screen.findByRole("form", { name: "New finding" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Every host's entries: the engagement Log.
    expect(await screen.findByRole("button", { name: "Add web probe as a step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add nmap sweep as a step" })).toBeInTheDocument();
    expect(within(contextTabs()).getByRole("tab", { name: "Facts" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
  });
});
