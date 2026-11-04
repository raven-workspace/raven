import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { applicableGoals } from "../engines/checklist";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem } from "../types/checklist";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "enumerate", boardManual: false,
  dualHomed: false, boardDerived: null, access: "none", createdAt: 1, updatedAt: 1,
};
const svc = (id: string, port: number, nmapService: string): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1,
});
const item = (goalId: string, status: ChecklistItem["status"]): ChecklistItem => ({
  ownerId: "h1", goalId, status, notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], updatedAt: 1,
});

const SMB = svc("s1", 445, "microsoft-ds");
const WEB = svc("s2", 80, "http");
const enumerateIds = (services: Service[], engagement = E1) =>
  applicableGoals(H1, engagement, [H1], new Map([["h1", services]])).find((a) => a.stage.id === "enumerate")!.goals.map((g) => g.id);

/** A checklist store that behaves like the backend: puts persist, lists read them back. */
function mount(opts: { engagement?: Engagement; services?: Service[]; items?: ChecklistItem[] } = {}) {
  let store = opts.items ?? [];
  m.engagementGet.mockResolvedValue(opts.engagement ?? E1);
  m.hostsList.mockResolvedValue([H1]);
  m.servicesListEngagement.mockResolvedValue(opts.services ?? [SMB]);
  m.checklistList.mockImplementation(async () => store);
  m.checklistPut.mockImplementation(async (_e, inputs) => {
    for (const i of inputs) {
      store = [...store.filter((x) => x.goalId !== i.goalId), { ...item(i.goalId, i.status), ...i, updatedAt: 2 } as ChecklistItem];
    }
    return store;
  });
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const now = async () => within(await screen.findByRole("region", { name: "Now" }));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444",
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.hostSyncBoard.mockResolvedValue(H1);
});

describe("Now panel", () => {
  it("now lists the open goals of the first stage with open work", async () => {
    mount({ items: [item("h-enum-full-tcp", "done")] });
    const panel = await now();
    expect(await panel.findByRole("heading", { name: "Enumerate" })).toBeInTheDocument();
    expect(panel.getByText("Check SMB shares and null/guest access")).toBeInTheDocument();
    expect(panel.queryByText("Scan all 65,535 TCP ports")).not.toBeInTheDocument();
    // The first open goal's first command, filled with the host IP, with Copy.
    expect(panel.getByRole("button", { name: "Copy command: Versions and default scripts on the open ports" })).toBeInTheDocument();
    expect(panel.getAllByText(/10\.10\.10\.5/).length).toBeGreaterThan(0);
  });

  it("marking the last open enumerate goal done moves Now to Foothold and calls hostSyncBoard with foothold", async () => {
    const user = userEvent.setup();
    const ids = enumerateIds([SMB]);
    const last = ids[ids.length - 1];
    mount({ items: ids.slice(0, -1).map((id) => item(id, "done")) });
    const panel = await now();
    await panel.findByRole("heading", { name: "Enumerate" });
    const group = panel.getByRole("group", { name: /^Now: / });
    await user.click(within(group).getByRole("button", { name: "Done" }));
    expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ goalId: last, status: "done" })]);
    expect(await panel.findByRole("heading", { name: "Foothold" })).toBeInTheDocument();
    await waitFor(() => expect(m.hostSyncBoard).toHaveBeenCalledWith("h1", "foothold"));
  });

  it("Doing toggles in progress", async () => {
    const user = userEvent.setup();
    mount();
    const panel = await now();
    await panel.findByRole("heading", { name: "Enumerate" });
    await user.click(within(panel.getAllByRole("group", { name: /^Now: / })[0]).getByRole("button", { name: "Doing" }));
    await waitFor(() => expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ status: "in_progress" })]));
  });

  it("says All stages done when every applicable goal is closed", async () => {
    const all = applicableGoals(H1, E1, [H1], new Map([["h1", [SMB]]])).flatMap((a) => a.goals);
    mount({ items: all.map((g) => item(g.id, "done")) });
    expect(await (await now()).findByText("All stages done")).toBeInTheDocument();
  });

  it("exam-sim Now never shows a banned command", async () => {
    const exam = { ...E1, kind: "exam-sim" as const };
    const ids = enumerateIds([WEB], exam);
    mount({ engagement: exam, services: [WEB], items: ids.map((id) => item(id, "done")) });
    const panel = await now();
    expect(await panel.findByRole("heading", { name: "Foothold" })).toBeInTheDocument();
    expect(panel.getByText("Test the web app for injection and upload flaws")).toBeInTheDocument();
    expect(panel.queryByText(/sqlmap/)).not.toBeInTheDocument();
  });

  it("clicking a goal opens the Checklist tab at it", async () => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    mount({ items: [item("h-enum-full-tcp", "done")] });
    const panel = await now();
    await user.click(await panel.findByRole("button", { name: "Check SMB shares and null/guest access" }));
    expect(screen.getByRole("tab", { name: "Checklist", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    const row = document.querySelector('[data-goal-id="h-enum-smb"]')!;
    expect(scroll.mock.contexts).toContain(row);
    scroll.mockRestore();
  });
});
