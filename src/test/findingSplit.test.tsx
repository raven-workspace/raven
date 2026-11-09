import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { toDraft } from "../features/findings/FindingEditor";
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
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
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
const L4 = { ...entry("l4", "Anonymous FTP check", ["h1"], "ftp", T + 2000), returnedNothing: true };
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
  m.logList.mockResolvedValue([L1, L2, L3, L4]);
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
  useArsenalStore.setState({ open: false });
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
    expect(await within(form).findByText("No connection. Use the builder.")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      title: "Apache path traversal", refs: ["CVE-2021-41773"], cvssVector: null,
    })));
  });

  it.each<[ErrorCode, string, string]>([
    ["no_key", "No NVD key", "Add an NVD API key in Settings to look up CVEs. Use the builder."],
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

describe("finding split: drafts on every close path (review round 1)", () => {
  async function openOnHost(user: User, title: string) {
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    await user.click(await screen.findByRole("button", { name: `Open ${title}` }));
    return await screen.findByRole("form", { name: "Edit finding" });
  }

  it("pasted file text survives H and comes back on reopen; a lock clears it", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", [finding({ id: "f1", title: "Open share", hostIds: ["h1"] })]);
    let form = await openOnHost(user, "Open share");
    await user.click(await within(form).findByRole("button", { name: "Add file" }));
    await user.type(within(form).getByLabelText("File name"), "poc.py");
    await user.click(within(form).getByLabelText("File content"));
    await user.paste("print(1)");
    await user.click(document.body);
    await user.keyboard("h");
    expect(await screen.findByRole("complementary", { name: /Stuck on dc01/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    form = await openOnHost(user, "Open share");
    expect(await within(form).findByLabelText("File content")).toHaveValue("print(1)");
    expect(m.findingFileCreate).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}l{/Meta}");
    await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
    form = await openOnHost(user, "Open share");
    expect(within(form).queryByLabelText("File content")).not.toBeInTheDocument();
  });

  it("a typed but not added reference survives Esc", async () => {
    const user = userEvent.setup();
    mount();
    let form = await openSplit(user);
    await user.type(within(form).getByLabelText("Add reference"), "https://example.test/adv");
    await user.keyboard("{Escape}");
    form = await openSplit(user);
    expect(within(form).getByLabelText("Add reference")).toHaveValue("https://example.test/adv");
  });

  it("saving a finding from the Findings section drops its draft kept on a host page", async () => {
    let list = [finding({ id: "f1", title: "Open share", hostIds: ["h1", "h2"] })];
    m.findingUpdate.mockImplementation(async (id, input) => {
      const saved = finding({ id, ...input, title: input.title, updatedAt: 50 });
      list = list.map((f) => (f.id === id ? saved : f));
      return saved;
    });
    const user = userEvent.setup();
    mount("/e/e1/h/h1", list);
    m.findingsList.mockImplementation(async () => list);
    let form = await openOnHost(user, "Open share");
    await user.clear(within(form).getByLabelText("Title"));
    await user.type(within(form).getByLabelText("Title"), "host page draft");
    await user.keyboard("{Escape}");
    expect(useFindingDraftStore.getState().drafts["e1:h1:f1"]?.title).toBe("host page draft");

    await user.click(screen.getByRole("link", { name: /^Findings/ }));
    await user.click(await screen.findByRole("button", { name: "Edit Open share" }));
    form = await screen.findByRole("form", { name: "Edit finding" });
    await user.clear(within(form).getByLabelText("Title"));
    await user.type(within(form).getByLabelText("Title"), "saved title");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(useFindingDraftStore.getState().drafts).toEqual({});

    await user.click(screen.getByRole("link", { name: /dc01/ }));
    form = await openOnHost(user, "saved title");
    expect(within(form).getByLabelText("Title")).toHaveValue("saved title");
  });

  it("an edit draft older than the finding's last save is dropped on open", async () => {
    const user = userEvent.setup();
    const current = finding({ id: "f1", title: "Saved elsewhere", hostIds: ["h1"], updatedAt: 9 });
    useFindingDraftStore.getState().set("e1:h1:f1", { ...toDraft(finding({ id: "f1", title: "Old", hostIds: ["h1"], updatedAt: 3 })), title: "stale draft" });
    mount("/e/e1/h/h1", [current]);
    const form = await openOnHost(user, "Saved elsewhere");
    expect(within(form).getByLabelText("Title")).toHaveValue("Saved elsewhere");
    expect(useFindingDraftStore.getState().drafts["e1:h1:f1"]).toBeUndefined();
    expect(within(form).getByRole("status")).toHaveTextContent("Your unsaved draft was replaced by a newer save.");
  });

  it("a kept draft that comes back shows no replaced line", async () => {
    const user = userEvent.setup();
    mount();
    let form = await openSplit(user);
    expect(within(form).queryByText(/replaced by a newer save/)).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText("Title"), "keep me");
    await user.keyboard("{Escape}");
    form = await openSplit(user);
    expect(within(form).getByLabelText("Title")).toHaveValue("keep me");
    expect(within(form).queryByText(/replaced by a newer save/)).not.toBeInTheDocument();
  });

  it("Esc while a new finding is saving keeps the split open, and F + Save afterwards creates no duplicate", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    m.findingCreate.mockImplementationOnce((_e, input) => new Promise((r) => (resolve = () => r(finding({ id: "f9", ...input, title: input.title })))));
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Kerberoastable svc_sql");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledTimes(1));
    await user.keyboard("{Escape}");
    await user.click(document.body);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("form", { name: "New finding" })).toBeInTheDocument();
    await act(async () => resolve());
    await waitFor(() => expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument());
    const again = await openSplit(user);
    expect(within(again).getByLabelText("Title")).toHaveValue("");
  });

  it("a new finding's draft is dropped when its save lands after the split is gone", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    m.findingCreate.mockImplementationOnce((_e, input) => new Promise((r) => (resolve = () => r(finding({ id: "f9", ...input, title: input.title })))));
    const { unmount } = mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Kerberoastable svc_sql");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledTimes(1));
    expect(useFindingDraftStore.getState().drafts["e1:h1:new"]?.title).toBe("Kerberoastable svc_sql");
    unmount();
    await act(async () => resolve());
    await waitFor(() => expect(useFindingDraftStore.getState().drafts["e1:h1:new"]).toBeUndefined());
  });
});

describe("finding split: layout and keys (review round 1)", () => {
  it("a returned-nothing entry keeps its title in the split's Log; the marker is compact", async () => {
    const user = userEvent.setup();
    mount();
    await openSplit(user);
    const row = await screen.findByRole("button", { name: "Add Anonymous FTP check as a step" });
    expect(within(row).getByTestId("entry-title")).toHaveTextContent("Anonymous FTP check");
    expect(within(row).getByTitle("Returned nothing")).toHaveTextContent("∅");
    expect(within(row).queryByText("returned nothing")).not.toBeInTheDocument();
  });

  it("host chips use the short name, with the full name in the title", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([{ ...H1, name: "dc01.corp.acme.local" }, H2]);
    mount();
    const form = await openSplit(user);
    const chip = within(form).getByRole("button", { name: "dc01" });
    expect(chip).toHaveAttribute("title", "dc01.corp.acme.local");
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("N is left alone while the Arsenal drawer is open", async () => {
    const user = userEvent.setup();
    mount();
    await openSplit(user);
    act(() => useArsenalStore.setState({ open: true }));
    await user.click(document.body);
    await user.keyboard("n");
    expect(within(contextTabs()).getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
  });

  it("NVD diffs and the error line go when their CVE is removed", async () => {
    const user = userEvent.setup();
    m.nvdLookup.mockImplementation(async (id) => {
      if (id === "CVE-2021-41773") return record();
      throw new RavenError("not_found", "missing");
    });
    mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Description"), "Mine.");
    await addRef(user, form, "CVE-2021-41773");
    expect(await within(form).findByText(/NVD has a different description/)).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Remove CVE-2021-41773" }));
    expect(within(form).queryByText(/NVD has a different/)).not.toBeInTheDocument();
    await addRef(user, form, "CVE-2020-9999");
    expect(await within(form).findByText("CVE not found on NVD")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Remove CVE-2020-9999" }));
    expect(within(form).queryByText("CVE not found on NVD")).not.toBeInTheDocument();
  });
});

describe("finding split: services list inside the editor pane", () => {
  it("scrolls on its own without doubling the pane's right padding", async () => {
    const user = userEvent.setup();
    mount();
    const form = await openSplit(user);
    const list = await within(form).findByTestId("service-list");
    // jsdom has no layout: the classes are the contract here (the pane pads pr-3; the list keeps pr-1; Playwright checks pixels).
    expect(list).toHaveClass("overflow-y-auto", "pr-1");
    expect(list).not.toHaveClass("pr-3");
    expect(form.closest("section")).toHaveClass("pr-3");
  });
});

describe("finding split: NVD lookup and failed saves (UX round 1 leftovers)", () => {
  it("a CVE is looked up once typing settles, not before, and only once", async () => {
    const user = userEvent.setup();
    m.nvdLookup.mockResolvedValue(record());
    mount();
    const form = await openSplit(user);
    await addRef(user, form, "CVE-2021-41773");
    expect(m.nvdLookup).not.toHaveBeenCalled();
    await waitFor(() => expect(m.nvdLookup).toHaveBeenCalledTimes(1));
    expect(m.nvdLookup).toHaveBeenCalledWith("CVE-2021-41773");
  });

  it("closing before the debounce fires keeps the lookup: it runs when the draft comes back", async () => {
    const user = userEvent.setup();
    m.nvdLookup.mockResolvedValue(record());
    mount();
    let form = await openSplit(user);
    await addRef(user, form, "CVE-2021-41773");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("form", { name: "New finding" })).not.toBeInTheDocument();
    expect(m.nvdLookup).not.toHaveBeenCalled();
    expect(useFindingDraftStore.getState().drafts["e1:h1:new"]?.nvdPending).toEqual(["CVE-2021-41773"]);
    form = await openSplit(user);
    await waitFor(() => expect(m.nvdLookup).toHaveBeenCalledWith("CVE-2021-41773"));
    await waitFor(() => expect(within(form).getByLabelText("CVSS vector")).toHaveValue(V31));
    expect(useFindingDraftStore.getState().drafts["e1:h1:new"]?.nvdPending).toEqual([]);
  });

  it("an NVD answer merges into what is typed by the time it lands", async () => {
    const user = userEvent.setup();
    let answer!: () => void;
    m.nvdLookup.mockImplementation(() => new Promise((r) => (answer = () => r(record()))));
    mount();
    const form = await openSplit(user);
    await addRef(user, form, "CVE-2021-41773");
    await waitFor(() => expect(m.nvdLookup).toHaveBeenCalled());
    await user.type(within(form).getByLabelText("Description"), "Typed meanwhile.");
    await act(async () => answer());
    await waitFor(() => expect(within(form).getByLabelText("CVSS vector")).toHaveValue(V31));
    expect(within(form).getByLabelText("Description")).toHaveValue("Typed meanwhile.");
    expect(within(form).getByText(/NVD has a different description/)).toBeInTheDocument();
  });

  it("a save that fails after the split is gone is reported when the draft comes back", async () => {
    const user = userEvent.setup();
    let fail!: () => void;
    m.findingCreate.mockImplementationOnce(() => new Promise((_r, rej) => (fail = () => rej(new RavenError("db", "disk full")))));
    const first = mount();
    const form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Kerberoastable svc_sql");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => fail());
    mount();
    const again = await openSplit(user);
    expect(within(again).getByLabelText("Title")).toHaveValue("Kerberoastable svc_sql");
    expect(await within(again).findByText(/The last save didn't go through: disk full/)).toBeInTheDocument();
  });

  it("a save that fails with the form open shows its error once, and not again on reopen", async () => {
    const user = userEvent.setup();
    m.findingCreate.mockRejectedValueOnce(new RavenError("db", "disk full"));
    mount();
    let form = await openSplit(user);
    await user.type(within(form).getByLabelText("Title"), "Kerberoastable svc_sql");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("disk full");
    await user.keyboard("{Escape}");
    form = await openSplit(user);
    expect(within(form).queryByText(/The last save didn't go through/)).not.toBeInTheDocument();
  });
});

