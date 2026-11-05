import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem, ChecklistItemInput } from "../types/checklist";
import type { CredAttempt, Credential } from "../types/credentials";
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
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "enumerate", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const DC = host("dc", "dc01", "10.10.10.5");
const WS = host("ws", "ws01", "10.10.10.6");
const svc = (id: string, hostId: string, port: number, nmapService: string): Service => ({
  id, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1,
});
const SERVICES = [svc("s1", "dc", 88, "kerberos-sec"), svc("s2", "dc", 389, "ldap"), svc("s3", "dc", 445, "microsoft-ds"), svc("s4", "ws", 445, "microsoft-ds")];
const PW: Credential = {
  id: "c1", engagementId: "e1", type: "password", username: "jsmith", domain: "CORP", secret: "Winter2024!", hashType: null,
  scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 5, updatedAt: 5,
};
const ADMIN: CredAttempt = {
  id: "a1", engagementId: "e1", credId: "c1", usernameId: null, hostId: "dc", service: "smb", port: null, result: "admin",
  authMode: "domain", detail: null, logEntryId: null, at: 1000,
};

/** A stateful checklist store, so a resync reads what the last put wrote. */
let store: ChecklistItem[];
function mount(path: string, attempts: CredAttempt[], items: ChecklistItem[] = []) {
  store = items;
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([DC, WS]);
  m.checklistList.mockImplementation(async () => store);
  m.checklistPut.mockImplementation(async (_e: string, put: ChecklistItemInput[]) => {
    for (const p of put) {
      const row: ChecklistItem = { notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], ...p, updatedAt: 1 };
      store = [...store.filter((i) => !(i.ownerId === p.ownerId && i.goalId === p.goalId)), row];
    }
    return store;
  });
  m.servicesListEngagement.mockResolvedValue(SERVICES);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([PW]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue(attempts);
  m.credAttemptsUpsert.mockResolvedValue([]);
  m.hostSyncBoard.mockResolvedValue(undefined as never);
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
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
});

describe("domain admin cover", () => {
  it("setting an admin result on the DC marks WS01 privesc as covered", async () => {
    const user = userEvent.setup();
    mount("/e/e1/s/credentials", []);
    await user.click(await screen.findByRole("button", { name: "CORP\\jsmith on dc01 SMB: untested" }));
    const dlg = await screen.findByRole("dialog");
    // The store answers with the new result once it is saved.
    m.credAttemptsUpsert.mockImplementation(async () => {
      m.credAttemptsList.mockResolvedValue([ADMIN]);
      return [];
    });
    await user.click(within(dlg).getByRole("button", { name: "Set domain result: admin" }));
    await waitFor(() => {
      const wsPut = m.checklistPut.mock.calls.flatMap((c) => c[1]).filter((i) => i.ownerId === "ws");
      expect(wsPut.length).toBeGreaterThan(0);
      for (const i of wsPut) expect(i).toMatchObject({ status: "na", auto: true });
      expect(wsPut.map((i) => i.goalId)).toContain("h-pe-win-privs");
      expect(wsPut.map((i) => i.goalId)).not.toContain("h-pe-proof");
    });
  });

  it("the host row shows the label, and changing a covered item by hand drops it", async () => {
    const user = userEvent.setup();
    const covered: ChecklistItem = {
      ownerId: "ws", goalId: "h-pe-win-privs", status: "na", notes: null, completedAt: null, auto: true, autoFrom: null, evidence: [], updatedAt: 1,
    };
    mount("/e/e1/h/ws", [ADMIN], [covered]);
    await user.click(await screen.findByRole("tab", { name: "Checklist" }));
    const group = await screen.findByRole("group", { name: "Status: Check token privileges for potato attacks" });
    const row = group.closest("li") as HTMLElement;
    expect(within(row).getByText("Covered by domain admin")).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "To do" }));
    await waitFor(() => expect(within(row).queryByText("Covered by domain admin")).not.toBeInTheDocument());
    // Let the resync that follows the put run, then check it never covered the item again.
    await waitFor(() => expect(m.hostSyncBoard).toHaveBeenCalled());
    const puts = m.checklistPut.mock.calls.flatMap((c) => c[1]).filter((i) => i.ownerId === "ws" && i.goalId === "h-pe-win-privs");
    expect(puts[0]).toMatchObject({ ownerId: "ws", status: "todo", auto: false, statusManual: true });
    expect(puts.slice(1).filter((i) => i.status === "na")).toEqual([]);
    expect(store.find((i) => i.ownerId === "ws" && i.goalId === "h-pe-win-privs")).toMatchObject({ status: "todo", statusManual: true });
  });
});
