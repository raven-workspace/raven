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
import type { Finding } from "../types/findings";
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
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "enumerate", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web01", "10.10.10.6");
const svc = (id: string, hostId: string, port: number, nmapService: string): Service => ({
  id, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1,
});
const S1 = svc("s1", "h1", 445, "microsoft-ds");
const S2 = svc("s2", "h2", 80, "http");

const finding = (o: Partial<Finding> & { id: string; title: string }): Finding => ({
  engagementId: "e1", severity: null, cvssVector: null, cvssScore: null, status: "draft", description: "", impact: "",
  remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [],
  createdAt: 1, updatedAt: 1, ...o,
});

const logEntry = (id: string): LogEntry => ({
  id, engagementId: "e1", kind: "note", title: `step ${id}`, titleEdited: false, ranOn: null, hostIds: ["h1"], observations: null,
  returnedNothing: false, private: false, content: { kind: "note", text: "x" }, at: 1, createdAt: 1, updatedAt: 1,
});

function mount(findings: Finding[] = []) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1, H2]);
  m.servicesListEngagement.mockResolvedValue([S1, S2]);
  m.checklistList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  if (!m.logList.getMockImplementation()) m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.findingsList.mockResolvedValue(findings);
  m.findingCreate.mockImplementation(async (_e, input) => finding({ id: "f9", ...input, title: input.title }));
  m.findingUpdate.mockImplementation(async (id, input) => finding({ id, ...input, title: input.title }));
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/s/findings"]}>
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

const VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";

async function openNew(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Add finding" }));
  return await screen.findByRole("dialog");
}

describe("findings section", () => {
  it("list sorts critical first then by score", async () => {
    mount([
      finding({ id: "a", title: "Low one", severity: "low", cvssScore: 3.1 }),
      finding({ id: "b", title: "High 7.5", severity: "high", cvssScore: 7.5, hostIds: ["h1"], status: "confirmed" }),
      finding({ id: "c", title: "Crit", severity: "critical", cvssScore: 9.1 }),
      finding({ id: "d", title: "High 8.8", severity: "high", cvssScore: 8.8 }),
    ]);
    await screen.findByText("Crit");
    const titles = screen.getAllByTestId("finding-title").map((e) => e.textContent);
    expect(titles).toEqual(["Crit", "High 8.8", "High 7.5", "Low one"]);
    const row = screen.getByText("High 7.5").closest("li")!;
    expect(within(row).getByText("high")).toHaveAttribute("data-variant", "warn");
    expect(within(row).getByText("dc01")).toBeInTheDocument();
    expect(within(row).getByText("confirmed")).toBeInTheDocument();
    expect(within(row).getByText("7.5")).toBeInTheDocument();
    expect(within(screen.getByText("Low one").closest("li")!).getByText("low")).toHaveAttribute("data-variant", "default");
  });

  it("a valid CVSS vector shows the score and suggests the severity; an invalid one shows an error and saves no score", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openNew(user);
    await user.type(within(dlg).getByLabelText("Title"), "SMB RCE");
    await user.type(within(dlg).getByLabelText("CVSS vector"), VECTOR);
    expect(within(dlg).getByText("9.8")).toBeInTheDocument();
    expect(within(dlg).getByText("Suggested: critical")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Use suggested" }));
    expect(within(dlg).queryByRole("button", { name: "Use suggested" })).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      title: "SMB RCE", severity: "critical", cvssVector: VECTOR, cvssScore: 9.8, status: "draft", stepEntryIds: [],
    })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const dlg2 = await openNew(user);
    await user.type(within(dlg2).getByLabelText("Title"), "Bad vector");
    await user.type(within(dlg2).getByLabelText("CVSS vector"), "AV:N/nonsense");
    expect(within(dlg2).getByText("Not a valid CVSS v3.1 base vector")).toBeInTheDocument();
    await user.click(within(dlg2).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledTimes(2));
    expect(m.findingCreate).toHaveBeenLastCalledWith("e1", expect.objectContaining({ title: "Bad vector", cvssScore: null }));
  });

  it("affected hosts and services round-trip", async () => {
    const user = userEvent.setup();
    m.logList.mockResolvedValue([logEntry("l1"), logEntry("l2")]);
    mount([finding({ id: "f1", title: "Open share", hostIds: ["h1"], serviceIds: ["s1"], refs: ["CVE-2017-0144", "https://example.test/adv"], stepEntryIds: ["l1", "l2"] })]);
    await user.click(await screen.findByRole("button", { name: "Edit Open share" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("button", { name: "dc01" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dlg).getByRole("button", { name: "web01" })).toHaveAttribute("aria-pressed", "false");
    expect(within(dlg).getByRole("button", { name: "445/tcp microsoft-ds" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dlg).getByRole("link", { name: "https://example.test/adv" })).toHaveAttribute("href", "https://example.test/adv");
    expect(within(dlg).getByText("CVE-2017-0144")).toBeInTheDocument();

    await user.click(within(dlg).getByRole("button", { name: "web01" }));
    await user.click(within(dlg).getByRole("button", { name: "80/tcp http" }));
    await user.click(within(dlg).getByRole("button", { name: "445/tcp microsoft-ds" }));
    await user.type(within(dlg).getByLabelText("Add reference"), "EDB-42315{Enter}");
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalledWith("f1", expect.objectContaining({
      hostIds: ["h1", "h2"], serviceIds: ["s2"], refs: ["CVE-2017-0144", "https://example.test/adv", "EDB-42315"],
      stepEntryIds: ["l1", "l2"], status: "draft",
    })));
  });

  it("lessons are marked private", async () => {
    const user = userEvent.setup();
    mount();
    const dlg = await openNew(user);
    const lessons = within(dlg).getByLabelText(/^Lessons/);
    expect(lessons.tagName).toBe("TEXTAREA");
    const label = dlg.querySelector(`label[for="${lessons.id}"]`)!;
    expect(within(label as HTMLElement).getByText("Private")).toBeInTheDocument();
  });

  it("closing with unsaved changes asks first; Command-Enter saves", async () => {
    const user = userEvent.setup();
    mount();
    let dlg = await openNew(user);
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    dlg = await openNew(user);
    await user.type(within(dlg).getByLabelText("Title"), "Draft idea");
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Draft idea");

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ title: "Draft idea" })));

    dlg = await openNew(user);
    await user.type(within(dlg).getByLabelText("Title"), "x");
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(m.findingCreate).toHaveBeenCalledTimes(1);
  });

  it("requires a title and deletes after confirming", async () => {
    const user = userEvent.setup();
    m.findingDelete.mockResolvedValue(null);
    mount([finding({ id: "f1", title: "Old" })]);
    const dlg = await openNew(user);
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("Give it a title")).toBeInTheDocument();
    expect(m.findingCreate).not.toHaveBeenCalled();
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Delete Old" }));
    await user.click(await screen.findByRole("button", { name: "Delete finding" }));
    await waitFor(() => expect(m.findingDelete).toHaveBeenCalledWith("f1"));
  });
});
