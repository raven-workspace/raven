import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { GoalRow } from "../features/checklist/GoalRow";
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
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const svc = (id: string, port: number, nmapService: string): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});
const item = (goalId: string, status: ChecklistItem["status"]): ChecklistItem => ({
  ownerId: "h1", goalId, status, notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], updatedAt: 1,
});

const SMB = svc("s1", 445, "microsoft-ds");
const WEB = svc("s2", 80, "http");
const enumerateIds = (services: Service[], engagement = E1) =>
  applicableGoals(H1, engagement, [H1], new Map([["h1", services]])).find((a) => a.stage.id === "information-gathering")!.goals.map((g) => g.id);

/** A checklist store that behaves like the backend: puts persist, lists read them back. */
function mount(opts: { engagement?: Engagement; services?: Service[]; items?: ChecklistItem[]; host?: Host } = {}) {
  let store = opts.items ?? [];
  // The board column moves like the backend's: hostSyncBoard stores it, the host list reads it back.
  let current = opts.host ?? H1;
  m.engagementGet.mockResolvedValue(opts.engagement ?? E1);
  m.hostsList.mockImplementation(async () => [current]);
  m.hostSyncBoard.mockImplementation(async (_id, column) => {
    current = { ...current, boardColumn: column, boardDerived: column };
    return current;
  });
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
const next = async () => within(await screen.findByRole("tabpanel", { name: "Next" }));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm",
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

describe("Next tab", () => {
  it("is the default tab and lists the open steps of the first stage with open work, commands filled", async () => {
    mount({ items: [item("h-enum-full-tcp", "done")] });
    const tab = await next();
    expect(screen.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
    expect(await tab.findByRole("heading", { name: "Information gathering" })).toBeInTheDocument();
    expect(tab.getByText("Check SMB shares and null/guest access")).toBeInTheDocument();
    expect(tab.queryByText("Scan all 65,535 TCP ports")).not.toBeInTheDocument();
    expect(tab.queryByRole("heading", { name: "Vulnerability detection" })).not.toBeInTheDocument();
    // Each open step with its filled, ready-to-copy commands.
    expect(tab.getByRole("button", { name: "Copy command: Versions and default scripts on the open ports" })).toBeInTheDocument();
    expect(tab.getAllByText(/10\.10\.10\.5/).length).toBeGreaterThan(0);
  });

  it("marking the last open enumerate step done moves Next to Vulnerability detection and calls hostSyncBoard", async () => {
    const user = userEvent.setup();
    const ids = enumerateIds([SMB]);
    const last = ids[ids.length - 1];
    mount({ items: ids.slice(0, -1).map((id) => item(id, "done")) });
    const tab = await next();
    await tab.findByRole("heading", { name: "Information gathering" });
    await user.click(within(tab.getByRole("group", { name: /^Status: / })).getByRole("button", { name: "Done" }));
    expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ goalId: last, status: "done" })]);
    expect(await tab.findByRole("heading", { name: "Vulnerability detection" })).toBeInTheDocument();
    await waitFor(() => expect(m.hostSyncBoard).toHaveBeenCalledWith("h1", "vulnerability-detection"));
  });

  it("shows the first open host-view stage, never lateral-movement", async () => {
    const ids = applicableGoals(H1, E1, [H1], new Map([["h1", [SMB]]]))
      .filter((a) => a.stage.id !== "lateral-movement")
      .flatMap((a) => a.goals.map((g) => g.id));
    mount({ items: ids.map((id) => item(id, "done")) });
    const tab = await next();
    await tab.findByText("All stages done");
    expect(tab.queryByRole("heading", { name: "Lateral movement" })).not.toBeInTheDocument();
  });

  it("says All stages done when every applicable step is closed", async () => {
    const all = applicableGoals(H1, E1, [H1], new Map([["h1", [SMB]]])).flatMap((a) => a.goals);
    mount({ items: all.map((g) => item(g.id, "done")) });
    expect(await (await next()).findByText("All stages done")).toBeInTheDocument();
  });

  it("a step title is never truncated", async () => {
    mount({ items: [item("h-enum-full-tcp", "done")] });
    const title = await (await next()).findByText("Check SMB shares and null/guest access");
    expect(title.className).not.toMatch(/truncate/);
  });

  it("Doing sets in progress", async () => {
    const user = userEvent.setup();
    mount();
    const tab = await next();
    await tab.findByRole("heading", { name: "Information gathering" });
    await user.click(within(tab.getAllByRole("group", { name: /^Status: / })[0]).getByRole("button", { name: "Doing" }));
    await waitFor(() => expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ status: "in_progress" })]));
  });

  it("exam-sim never shows a banned command", async () => {
    const exam = { ...E1, kind: "exam-sim" as const };
    const ids = enumerateIds([WEB], exam);
    mount({ engagement: exam, services: [WEB], items: ids.map((id) => item(id, "done")), host: { ...H1, boardColumn: "vulnerability-detection" } });
    const tab = await next();
    expect(await tab.findByRole("heading", { name: "Vulnerability detection" })).toBeInTheDocument();
    expect(tab.getByText("Test the web app for injection and upload flaws")).toBeInTheDocument();
    expect(tab.queryByText(/sqlmap/)).not.toBeInTheDocument();
  });

  it("Full checklist expands every stage in place, done steps included, and folds back", async () => {
    const user = userEvent.setup();
    mount({ items: [item("h-enum-full-tcp", "done")] });
    const tab = await next();
    await tab.findByText("Check SMB shares and null/guest access");
    const toggle = screen.getByRole("button", { name: "Full checklist" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await tab.findByText("Scan all 65,535 TCP ports")).toBeInTheDocument();
    expect(tab.getByRole("heading", { name: "Vulnerability detection" })).toBeInTheDocument();
    // One row per step: the open steps are not listed twice.
    expect(tab.getAllByText("Check SMB shares and null/guest access")).toHaveLength(1);
    await user.click(toggle);
    expect(tab.queryByText("Scan all 65,535 TCP ports")).not.toBeInTheDocument();
  });
});

describe("Next follows the board column", () => {
  it("a host in Initial foothold with open Information gathering steps shows only Initial foothold steps", async () => {
    mount({ host: { ...H1, boardColumn: "initial-foothold", access: "user" } });
    const tab = await next();
    expect(await tab.findByRole("heading", { name: "Initial foothold" })).toBeInTheDocument();
    expect(tab.queryByRole("heading", { name: "Information gathering" })).not.toBeInTheDocument();
    expect(tab.queryByText("Scan all 65,535 TCP ports")).not.toBeInTheDocument();
    // The earlier stage's open steps are one click away.
    await userEvent.click(screen.getByRole("button", { name: "Full checklist" }));
    expect(await tab.findByText("Scan all 65,535 TCP ports")).toBeInTheDocument();
  });

  it("says so when the current stage has nothing open but an earlier one does", async () => {
    const vd = applicableGoals(H1, E1, [H1], new Map([["h1", [SMB]]])).find((a) => a.stage.id === "vulnerability-detection")!.goals;
    mount({ host: { ...H1, boardColumn: "vulnerability-detection" }, items: vd.map((g) => item(g.id, "done")) });
    expect(await (await next()).findByText("Nothing open in Vulnerability detection. Earlier steps are in the full checklist.")).toBeInTheDocument();
  });
});

describe("new credentials notice", () => {
  it("is one line, `12 new creds since done · re-check`, with the labels only in its disclosure", async () => {
    const labels = Array.from({ length: 12 }, (_, i) => `CORP\\user_${i}`);
    render(
      <ul>
        <GoalRow goal={{ id: "g", title: "Spray the domain" }} state={{ status: "done" }} commands={[]} evidence={[]} newCredLabels={labels} onStatus={vi.fn()} onNotes={vi.fn()} />
      </ul>,
    );
    const notice = screen.getByText(/12 new creds since done/);
    expect(notice).toHaveTextContent("12 new creds since done · re-check ▸");
    expect(notice.tagName).toBe("BUTTON");
    expect(notice.className).toMatch(/truncate/);
    expect(screen.queryByText("CORP\\user_0")).not.toBeInTheDocument();
    await userEvent.click(notice);
    expect(notice).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CORP\\user_0")).toBeInTheDocument();
    expect(screen.getByText("CORP\\user_11")).toBeInTheDocument();
  });
});
