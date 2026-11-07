import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useCredPickStore } from "../features/checklist/credPick";
import { resetNotesStore, useNotesStore } from "../features/notes/useNotesStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem } from "../types/checklist";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.0.0.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (over: Partial<Host> = {}): Host => ({
  id: "h1", engagementId: "e1", name: "web01", ip: "10.0.0.5", os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none",
  createdAt: 1, updatedAt: 1, ...over,
});
const svc = (id: string, port: number, over: Partial<Service> = {}): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1, ...over,
});

function mount(opts: { hosts?: Host[]; services?: Service[]; path?: string } = {}) {
  m.hostsList.mockResolvedValue(opts.hosts ?? [host()]);
  m.servicesListEngagement.mockResolvedValue(opts.services ?? []);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[opts.path ?? "/e/e1/h/h1"]}>
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
  resetNotesStore();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.hostSyncBoard.mockResolvedValue(host());
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.notesGet.mockImplementation(async (_e, hostId) => ({ ownerId: hostId ?? "e1", engagementId: "e1", hostId, body: "", private: false, updatedAt: 0 }));
});

describe("stuck view", () => {
  it("H opens the stuck view and Esc closes it", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    expect(await screen.findByRole("complementary", { name: /Stuck on web01/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: /Stuck on web01/ })).not.toBeInTheDocument();
    // Esc closed the overlay only; the host view is still there.
    expect(screen.getByRole("region", { name: "Host" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Stuck\?/ }));
    expect(await screen.findByRole("complementary", { name: /Stuck on web01/ })).toBeInTheDocument();
    await user.keyboard("H");
    expect(screen.queryByRole("complementary", { name: /Stuck on web01/ })).not.toBeInTheDocument();
  });

  it("H while typing in an input does nothing", async () => {
    const user = userEvent.setup();
    mount();
    const header = await screen.findByRole("region", { name: "Host" });
    await user.click(within(header).getByRole("button", { name: "Edit" }));
    const name = await screen.findByLabelText(/^Name/);
    await user.click(name);
    await user.keyboard("h");
    expect(screen.queryByRole("complementary", { name: /Stuck on/ })).not.toBeInTheDocument();
  });

  it("opens on a bare host", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    const panel = await screen.findByRole("complementary", { name: /Stuck on web01/ });
    expect(within(panel).getByText("Before a foothold")).toBeInTheDocument();
    expect(await within(panel).findByText("Import a scan to see service steps")).toBeInTheDocument();
  });

  it("a failed checklist load shows an error, not an empty Skipped list", async () => {
    m.checklistList.mockRejectedValue(new Error("vault locked"));
    const user = userEvent.setup();
    mount();
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    const panel = await screen.findByRole("complementary", { name: /Stuck on web01/ });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("vault locked");
    expect(within(panel).queryByText("Before a foothold")).not.toBeInTheDocument();
  });

  it("a failed settings load shows an error, not commands filled with blank addresses", async () => {
    const user = userEvent.setup();
    mount();
    m.settingsGet.mockRejectedValue(new Error("settings unreadable"));
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    const panel = await screen.findByRole("complementary", { name: /Stuck on web01/ });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("settings unreadable");
  });

  it("before a foothold shows the nudges for a guessed service", async () => {
    const user = userEvent.setup();
    mount({ services: [svc("s1", 9999, { nmapService: "abyss?" })] });
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    const panel = await screen.findByRole("complementary", { name: /Stuck on web01/ });
    expect(await within(panel).findByText("nc -nv 10.0.0.5 9999")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy command: Talk to it (then type help)" })).toBeInTheDocument();
  });

  it("after a foothold shows todo privesc commands", async () => {
    const user = userEvent.setup();
    mount({ hosts: [host({ access: "user" })] });
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    const panel = await screen.findByRole("complementary", { name: /Stuck on web01/ });
    expect(within(panel).getByText("After a foothold")).toBeInTheDocument();
    expect(await within(panel).findByRole("heading", { name: "Commands to try" })).toBeInTheDocument();
    expect(within(panel).getAllByRole("button", { name: /^Copy command/ }).length).toBeGreaterThan(0);
  });

  it("the engagement stuck check lists dual-homed hosts without a tunnel", async () => {
    const user = userEvent.setup();
    mount({ hosts: [host({ dualHomed: true })], path: "/e/e1/s/checklist" });
    const toggle = await screen.findByRole("button", { name: /Stuck check/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/dual-homed, no tunnel recorded/)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText(/web01 — dual-homed, no tunnel recorded/)).toBeInTheDocument();
  });

  it("a skipped step opens the Checklist tab on that goal", async () => {
    const user = userEvent.setup();
    const na: ChecklistItem = { ownerId: "h1", goalId: "h-foot-arrived", status: "na", notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], updatedAt: 1 };
    m.checklistList.mockResolvedValue([na]);
    mount();
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    const panel = await screen.findByRole("complementary", { name: /Stuck on web01/ });
    const skipped = within(await within(panel).findByRole("region", { name: "Skipped steps" }));
    await user.click(skipped.getByRole("button"));
    expect(screen.queryByRole("complementary", { name: /Stuck on/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
    const row = document.querySelector('li[data-goal-id="h-foot-arrived"]')!;
    expect(within(row as HTMLElement).getByRole("button", { name: /^Collapse/ })).toBeInTheDocument();
  });

  it("n closes the stuck view and opens notes", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("h");
    await screen.findByRole("complementary", { name: /Stuck on web01/ });
    await user.keyboard("n");
    expect(await screen.findByRole("complementary", { name: /Notes/ })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /Stuck on/ })).not.toBeInTheDocument();
  });

  it("h closes notes and opens the stuck view", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("region", { name: "Host" });
    await user.keyboard("n");
    await screen.findByRole("complementary", { name: /Notes/ });
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("h");
    expect(await screen.findByRole("complementary", { name: /Stuck on web01/ })).toBeInTheDocument();
    expect(useNotesStore.getState().open).toBe(false);
  });

  it("the dual-homed line opens the Lateral movement section on that host's tunnel step", async () => {
    const user = userEvent.setup();
    mount({ hosts: [host({ dualHomed: true })], path: "/e/e1/s/checklist" });
    await user.click(await screen.findByRole("button", { name: /Stuck check/ }));
    await user.click(await screen.findByRole("button", { name: /dual-homed, no tunnel recorded/ }));
    expect(await screen.findByRole("button", { name: /Lateral movement/ })).toHaveAttribute("aria-expanded", "true");
    const row = document.querySelector('li[data-goal-id="h-pivot-tunnel"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByRole("button", { name: /^Collapse/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Host" })).not.toBeInTheDocument();
  });

  it("clicking the dual-homed line again re-opens a collapsed section on that host's tunnel step", async () => {
    const user = userEvent.setup();
    const a = host({ id: "h1", name: "web01", dualHomed: true });
    const b = host({ id: "h2", name: "web02", ip: "10.0.0.6", dualHomed: true });
    mount({ hosts: [a, b], path: "/e/e1/s/checklist" });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const toggle = await screen.findByRole("button", { name: /Lateral movement/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: /Stuck check/ }));
    await user.click(await screen.findByRole("button", { name: /web02 — dual-homed, no tunnel recorded/ }));
    expect(await screen.findByRole("button", { name: /Lateral movement/ })).toHaveAttribute("aria-expanded", "true");
    const rows = [...document.querySelectorAll('li[data-goal-id="h-pivot-tunnel"]')] as HTMLElement[];
    expect(rows).toHaveLength(2);
    // Rows are in host order: the second belongs to web02 and is the one scrolled to.
    expect(within(rows[1]!).getByRole("button", { name: /^Collapse/ })).toBeInTheDocument();
    await waitFor(() => expect(scroll.mock.contexts).toContain(rows[1]));
    expect(scroll.mock.contexts).not.toContain(rows[0]);
  });
});
