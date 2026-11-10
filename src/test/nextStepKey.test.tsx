import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { usePayloadsStore } from "../features/payloads/usePayloadsStore";
import App from "../App";
import { applicableGoals } from "../engines/checklist";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem } from "../types/checklist";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const SMB: Service = {
  id: "s1", hostId: "h1", port: 445, protocol: "tcp", state: "open", nmapService: "microsoft-ds", nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
};
const item = (goalId: string, status: ChecklistItem["status"]): ChecklistItem => ({
  ownerId: "h1", goalId, status, notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], updatedAt: 1,
});
const stages = applicableGoals(H1, E1, [H1], new Map([["h1", [SMB]]]));
const enumIds = stages.find((a) => a.stage.id === "information-gathering")!.goals.map((g) => g.id);
const allIds = stages.flatMap((a) => a.goals.map((g) => g.id));
const done = (ids: string[]) => ids.map((id) => item(id, "done"));

function mount(items: ChecklistItem[], pending = false, slowServices = false) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  if (slowServices) m.servicesListEngagement.mockReturnValue(new Promise(() => {}));
  else m.servicesListEngagement.mockResolvedValue([SMB]);
  if (pending) m.checklistList.mockReturnValue(new Promise(() => {}));
  else m.checklistList.mockResolvedValue(items);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const row = (id: string) => document.querySelector(`li[data-goal-id="${id}"]`)!;

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
});

describe("J: next open step", () => {
  it("focuses the first step that is To do or Doing, in checklist order", async () => {
    const user = userEvent.setup();
    mount(done(enumIds.slice(0, 2)));
    await screen.findByRole("heading", { name: "Information gathering" });
    await user.keyboard("j");
    const target = row(enumIds[2]!);
    expect(target).toContainElement(document.activeElement as HTMLElement);
  });

  it("a Doing step ahead of a later To do wins; a Doing step behind an earlier To do does not", async () => {
    const user = userEvent.setup();
    mount([item(enumIds[0]!, "done"), item(enumIds[1]!, "in_progress")]);
    await screen.findByRole("heading", { name: "Information gathering" });
    await user.keyboard("J");
    expect(row(enumIds[1]!)).toContainElement(document.activeElement as HTMLElement);
  });

  it("switches to the Next tab from the Log tab", async () => {
    const user = userEvent.setup();
    mount([]);
    await user.click(await screen.findByRole("tab", { name: "Log" }));
    await user.keyboard("j");
    expect(screen.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(row(enumIds[0]!)).toContainElement(document.activeElement as HTMLElement));
  });

  it("opens the full checklist when the current stage has nothing open but a later one does", async () => {
    const user = userEvent.setup();
    mount(done(enumIds));
    await screen.findByText(/Nothing open in/);
    await user.keyboard("j");
    const later = allIds.find((id) => !enumIds.includes(id))!;
    await waitFor(() => expect(row(later)).toContainElement(document.activeElement as HTMLElement));
  });

  it("says every step is done and leaves focus alone when nothing is open", async () => {
    const user = userEvent.setup();
    mount(done(allIds));
    await screen.findByText("All stages done");
    const before = document.activeElement;
    await user.keyboard("j");
    expect(await screen.findByText("Every step is done")).toHaveAttribute("role", "status");
    expect(document.activeElement).toBe(before);
  });

  it("does nothing while typing in a field or with a dialog open", async () => {
    const user = userEvent.setup();
    mount([]);
    await screen.findByRole("heading", { name: "Information gathering" });
    await user.keyboard("l");
    const dialog = await screen.findByRole("dialog", { name: "Add to log" });
    await user.keyboard("j");
    expect(dialog).toBeInTheDocument();
    expect(document.querySelector("li[data-goal-id]")!.contains(document.activeElement)).toBe(false);
  });

  it("does nothing from a control inside an open Arsenal or Payloads drawer", async () => {
    const user = userEvent.setup();
    mount([]);
    await screen.findByRole("heading", { name: "Information gathering" });
    const first = row(enumIds[0]!);
    for (const store of [useArsenalStore, usePayloadsStore] as const) {
      (store.setState as (p: { open: boolean }) => void)({ open: true });
      const btn = screen.getByRole("tab", { name: "Log" });
      btn.focus();
      await user.keyboard("j");
      expect(first.contains(document.activeElement)).toBe(false);
      (store.setState as (p: { open: boolean }) => void)({ open: false });
    }
  });

  it("while the checklist is still loading, J does nothing and shows no all-done line", async () => {
    const user = userEvent.setup();
    mount([], true);
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("j");
    expect(screen.queryByText("Every step is done")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full checklist" })).toHaveAttribute("aria-expanded", "false");
  });

  it("J from the Log tab while the checklist loads says so", async () => {
    const user = userEvent.setup();
    mount([], true, true);
    await user.click(await screen.findByRole("tab", { name: "Log" }));
    await user.keyboard("j");
    expect(await screen.findByText("Checklist loading")).toBeInTheDocument();
    expect(screen.queryByText("Every step is done")).not.toBeInTheDocument();
  });

  it("after a genuine all-done J puts the Full checklist toggle back", async () => {
    const user = userEvent.setup();
    mount(done(allIds));
    await screen.findByText("All stages done");
    await user.keyboard("j");
    await screen.findByText("Every step is done");
    expect(screen.getByRole("button", { name: "Full checklist" })).toHaveAttribute("aria-expanded", "false");
  });

  it("is listed in the host page's shortcut list, which has no hint row of its own", async () => {
    const user = userEvent.setup();
    mount([]);
    const hints = await screen.findByLabelText("Host shortcuts");
    expect(hints).not.toHaveTextContent("next step");
    await user.click(within(hints).getByRole("button", { name: "All shortcuts" }));
    const list = await screen.findByRole("dialog");
    expect(list).toHaveTextContent("J");
    expect(list).toHaveTextContent("next step");
  });
});
