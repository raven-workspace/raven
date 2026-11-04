import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Hop, Tunnel } from "../types/network";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string, os: Host["os"]): Host => ({
  id, engagementId: "e1", name, ip, os, boardColumn: "enumerate", boardManual: false, dualHomed: false,
  boardDerived: null, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5", "windows");
const H2 = host("h2", "web02", "10.10.10.6", "linux");
const svc = (id: string, port: number): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1,
});
const AD = [svc("s88", 88), svc("s389", 389)];
const hop = (): Hop => ({ id: "hp1", engagementId: "e1", fromHostId: null, toHostId: "h1", via: "creds", logEntryId: null, at: 1, updatedAt: 1 });
const flagEntry: LogEntry = {
  id: "f1", engagementId: "e1", kind: "flag", title: "local flag", titleEdited: false, ranOn: null, hostIds: ["h2"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef" }, at: 1000, createdAt: 1000, updatedAt: 1000,
};

function mount(opts: { services?: Service[]; hops?: Hop[]; log?: LogEntry[]; tunnels?: Tunnel[] } = {}) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1, H2]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue(opts.services ?? []);
  m.hopsList.mockResolvedValue(opts.hops ?? []);
  m.tunnelsList.mockResolvedValue(opts.tunnels ?? []);
  m.logList.mockResolvedValue(opts.log ?? []);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/s/checklist"]}>
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
  m.checklistPut.mockResolvedValue([]);
  m.hostSyncBoard.mockResolvedValue(H1);
});

describe("engagement checklist", () => {
  it("clock sync shows only with an AD host", async () => {
    mount();
    expect(await screen.findByText("Add the /etc/hosts lines")).toBeInTheDocument();
    expect(screen.queryByText("Sync the clock to the DC")).not.toBeInTheDocument();
  });

  it("clock sync shows with an AD host", async () => {
    mount({ services: AD });
    expect((await screen.findAllByText("Sync the clock to the DC")).length).toBeGreaterThan(0);
  });

  it("no-credentials playbook opens with an AD host; the others say they open with credentials", async () => {
    const user = userEvent.setup();
    mount({ services: AD });
    expect(await screen.findByText("Try null, guest and anonymous SMB")).toBeInTheDocument();
    expect(screen.queryByText("RID cycle with the credential")).not.toBeInTheDocument();
    expect(screen.getAllByText("Opens automatically once credentials arrive (build step 4)")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /First domain user/ }));
    expect((await screen.findAllByText("RID cycle with the credential")).length).toBeGreaterThan(0);
  });

  it("no-credentials playbook stays closed without an AD host", async () => {
    mount();
    await screen.findByText("Add the /etc/hosts lines");
    expect(screen.queryByText("Try null, guest and anonymous SMB")).not.toBeInTheDocument();
  });

  it("adding a tunnel validates subnets and lists it", async () => {
    const user = userEvent.setup();
    const created: Tunnel = {
      id: "t1", engagementId: "e1", kind: "ligolo", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "10.10.14.9",
      status: "up", notes: null, createdAt: 1, updatedAt: 1,
    };
    m.tunnelCreate.mockResolvedValue(created);
    mount();
    await user.click(await screen.findByRole("button", { name: "Add tunnel" }));
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24, nonsense");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(await within(dialog).findByText(/Not a valid subnet: nonsense/)).toBeInTheDocument();
    expect(m.tunnelCreate).not.toHaveBeenCalled();

    m.tunnelsList.mockResolvedValue([created]);
    await user.clear(within(dialog).getByLabelText("Subnets"));
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24");
    await user.type(within(dialog).getByLabelText("Callback IP"), "10.10.14.9");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(m.tunnelCreate).toHaveBeenCalledWith("e1", {
      kind: "ligolo", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "10.10.14.9", status: "up",
    });
    expect(await screen.findByText("10.20.0.0/24")).toBeInTheDocument();
  });

  it("shows a server field error on the tunnel dialog", async () => {
    const user = userEvent.setup();
    m.tunnelCreate.mockRejectedValue(Object.assign(new Error("Not an IPv4 address"), { field: "callbackIp" }));
    mount();
    await user.click(await screen.findByRole("button", { name: "Add tunnel" }));
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(await within(dialog).findByText("Not an IPv4 address")).toBeInTheDocument();
  });

  it("a hop to the DC opens the Domain admin playbook", async () => {
    mount({ services: AD, hops: [hop()] });
    expect(await screen.findByText(/dc01.*creds|Kali.*dc01/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Domain admin/, expanded: true })).toBeInTheDocument();
  });

  it("Domain admin stays closed without a hop to the DC", async () => {
    mount({ services: AD });
    await screen.findByText("Try null, guest and anonymous SMB");
    expect(screen.getByRole("button", { name: /Domain admin/, expanded: false })).toBeInTheDocument();
  });

  it("Tick from log re-derives a tick that was missing and reports the count", async () => {
    const user = userEvent.setup();
    mount({ log: [flagEntry] });
    await user.click(await screen.findByRole("button", { name: "Tick from log" }));
    const section = screen.getByRole("region", { name: "Engagement checklist" });
    expect(await within(section).findByText("Updated 1 goal")).toBeInTheDocument();
    expect(m.checklistPut).toHaveBeenCalledWith("e1", [expect.objectContaining({ ownerId: "h2", goalId: "h-orient-proof", status: "done" })]);
  });
});
