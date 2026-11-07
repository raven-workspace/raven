import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { FailedAttempt, FailedAttemptInput, Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web01", "10.10.10.6");
const T = new Date(2026, 10, 4, 9, 5).getTime();
const L1: LogEntry = {
  id: "l1", engagementId: "e1", kind: "note", title: "tried the exploit", titleEdited: false, ranOn: null, hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false, content: { kind: "note", text: "body" }, at: T, createdAt: T, updatedAt: T,
};
const FIND: Finding = {
  id: "f1", engagementId: "e1", title: "Shell upload", severity: null, cvssVector: null, cvssScore: null, status: "draft",
  description: "", impact: "", remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [], serviceIds: [],
  stepEntryIds: [], createdAt: 1, updatedAt: 1,
};
const attempt = (o: Partial<FailedAttempt> & { id: string; title: string }): FailedAttempt => ({
  engagementId: "e1", hostId: null, findingId: null, reasonKind: "control", reason: "blocked", private: false,
  logEntryId: null, createdAt: 1, updatedAt: 1, ...o,
});

/** A stateful fake of the attempts table; like the server, it derives `private` from the reason kind. */
function mount(path: string, initial: FailedAttempt[] = []) {
  let rows = initial;
  const fill = (id: string, input: FailedAttemptInput, base?: FailedAttempt): FailedAttempt => ({
    ...attempt({ id, title: input.title }), ...base, hostId: input.hostId ?? null, findingId: input.findingId ?? null,
    title: input.title, reasonKind: input.reasonKind ?? null, reason: input.reason, logEntryId: input.logEntryId ?? null,
    private: input.reasonKind === "operator",
  });
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1, H2]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.servicesList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([L1]);
  m.notesList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.findingsList.mockResolvedValue([FIND]);
  m.failedAttemptsList.mockImplementation(async () => rows);
  m.failedAttemptCreate.mockImplementation(async (_e, input) => {
    const row = fill("a9", input);
    rows = [...rows, row];
    return row;
  });
  m.failedAttemptUpdate.mockImplementation(async (id, input) => {
    const row = fill(id, input, rows.find((r) => r.id === id));
    rows = rows.map((r) => (r.id === id ? row : r));
    return row;
  });
  m.failedAttemptDelete.mockImplementation(async (id) => {
    rows = rows.filter((r) => r.id !== id);
    return null;
  });
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
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
});

const SECTION = "/e/e1/s/findings";

async function addAttempt(user: ReturnType<typeof userEvent.setup>, kind: string | RegExp) {
  await user.click(await screen.findByRole("button", { name: "Add attempt" }));
  const dlg = await screen.findByRole("dialog");
  await user.type(within(dlg).getByLabelText("What was tried"), "Relay to the DC");
  await user.click(within(dlg).getByRole("radio", { name: kind }));
  await user.type(within(dlg).getByLabelText("Reason"), "SMB signing is required");
  return dlg;
}

describe("attempts", () => {
  it("a reported reason saves as not private", async () => {
    const user = userEvent.setup();
    mount(SECTION);
    const dlg = await addAttempt(user, "Blocked by a control");
    expect(within(dlg).queryByText("Never appears in a report")).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.failedAttemptCreate).toHaveBeenCalledTimes(1));
    const input = m.failedAttemptCreate.mock.calls[0]![1];
    expect(input).toMatchObject({ title: "Relay to the DC", reasonKind: "control", reason: "SMB signing is required" });
    expect(input).not.toHaveProperty("private");
    const list = await screen.findByRole("region", { name: "Attempts" });
    expect(await within(list).findByText("Relay to the DC")).toBeInTheDocument();
    expect(within(list).queryByText("Private")).not.toBeInTheDocument();
  });

  it("operator error saves private and shows the chip", async () => {
    const user = userEvent.setup();
    mount(SECTION);
    const dlg = await addAttempt(user, /^Operator error or inexperience \(private\)$/);
    expect(within(dlg).getByText("Never appears in a report")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.failedAttemptCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ reasonKind: "operator" })));
    expect(m.failedAttemptCreate.mock.calls[0]![1]).not.toHaveProperty("private");
    const list = await screen.findByRole("region", { name: "Attempts" });
    expect(await within(list).findByText("Private")).toBeInTheDocument();
  });

  it("switching a private attempt to a reported reason clears private", async () => {
    const user = userEvent.setup();
    mount(SECTION, [attempt({ id: "a1", title: "Spray the VPN", reasonKind: "operator", reason: "wrong user list", private: true })]);
    const list = await screen.findByRole("region", { name: "Attempts" });
    expect(await within(list).findByText("Private")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Edit Spray the VPN" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Never appears in a report")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("radio", { name: "Insufficient access" }));
    expect(within(dlg).queryByText("Never appears in a report")).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.failedAttemptUpdate).toHaveBeenCalledWith("a1", expect.objectContaining({ reasonKind: "access" })));
    await waitFor(() => expect(within(list).queryByText("Private")).not.toBeInTheDocument());
  });

  it("a blank title or reason is refused without saving", async () => {
    const user = userEvent.setup();
    mount(SECTION);
    await user.click(await screen.findByRole("button", { name: "Add attempt" }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(within(dlg).getByText("Say what was tried")).toBeInTheDocument();
    expect(within(dlg).getByText("Say why it failed")).toBeInTheDocument();
    expect(m.failedAttemptCreate).not.toHaveBeenCalled();
  });

  it("saving without a reason kind is refused and nothing is sent", async () => {
    const user = userEvent.setup();
    mount(SECTION);
    await user.click(await screen.findByRole("button", { name: "Add attempt" }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("What was tried"), "Relay to the DC");
    await user.type(within(dlg).getByLabelText("Reason"), "SMB signing is required");
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(within(dlg).getByText("Pick why it failed")).toBeInTheDocument();
    expect(m.failedAttemptCreate).not.toHaveBeenCalled();
  });

  it("clicking the selected reason keeps it selected", async () => {
    const user = userEvent.setup();
    mount(SECTION);
    await user.click(await screen.findByRole("button", { name: "Add attempt" }));
    const dlg = await screen.findByRole("dialog");
    const radio = within(dlg).getByRole("radio", { name: "Insufficient access" });
    await user.click(radio);
    await user.click(radio);
    expect(radio).toHaveAttribute("aria-checked", "true");
  });

  it("delete asks first, then removes the row", async () => {
    const user = userEvent.setup();
    mount(SECTION, [attempt({ id: "a1", title: "Spray the VPN" })]);
    await user.click(await screen.findByRole("button", { name: "Delete Spray the VPN" }));
    expect(m.failedAttemptDelete).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete attempt" }));
    await waitFor(() => expect(m.failedAttemptDelete).toHaveBeenCalledWith("a1"));
    await waitFor(() => expect(screen.queryByText("Spray the VPN")).not.toBeInTheDocument());
  });

  it("a row with a log entry links to the Log section", async () => {
    const user = userEvent.setup();
    m.logList.mockResolvedValue([L1]);
    mount(SECTION, [attempt({ id: "a1", title: "Spray the VPN", logEntryId: "l1" })]);
    await user.click(await screen.findByRole("button", { name: "Open log entry for Spray the VPN" }));
    expect(await screen.findByRole("region", { name: "Log" })).toBeInTheDocument();
  });

  it("host Findings tab lists this host's attempts", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", [
      attempt({ id: "a1", title: "Relay to the DC", hostId: "h1", logEntryId: "l1" }),
      attempt({ id: "a2", title: "Brute the web login", hostId: "h2" }),
      attempt({ id: "a3", title: "General phish", hostId: null }),
    ]);
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    const list = await screen.findByRole("region", { name: "Attempts" });
    expect(await within(list).findByText("Relay to the DC")).toBeInTheDocument();
    expect(within(list).queryByText("Brute the web login")).not.toBeInTheDocument();
    expect(within(list).queryByText("General phish")).not.toBeInTheDocument();

    // A new attempt from here starts on this host.
    await user.click(within(list).getByRole("button", { name: "Add attempt" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("combobox", { name: "Host" })).toHaveTextContent("dc01");
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));

    // The linked log entry opens in the Log tab.
    await user.click(within(list).getByRole("button", { name: "Open log entry for Relay to the DC" }));
    expect(await screen.findByRole("tab", { name: "Log", selected: true })).toBeInTheDocument();
  });

  it("deleting a finding reloads the attempts, which lose the link", async () => {
    const user = userEvent.setup();
    mount(SECTION, [attempt({ id: "a1", title: "Spray the VPN", findingId: "f1" })]);
    m.findingDelete.mockResolvedValue(null);
    await screen.findByText("Spray the VPN");
    const before = m.failedAttemptsList.mock.calls.length;
    await user.click(await screen.findByRole("button", { name: "Delete Shell upload" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete finding" }));
    await waitFor(() => expect(m.failedAttemptsList.mock.calls.length).toBeGreaterThan(before));
  });
});
