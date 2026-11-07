import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { resyncBoards } from "../features/checklist/ticks";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
vi.mock("../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../features/checklist/ticks")>()),
  resyncBoards: vi.fn(),
}));
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "exam-sim", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, over: Partial<Host> = {}): Host => ({
  id, engagementId: "e1", name, ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const VEGA = host("h1", "VEGA");
const WEB = host("h2", "web02", { os: "linux" });
const svc: Service = {
  id: "s1", hostId: "h1", port: 445, protocol: "tcp", state: "open", nmapService: "microsoft-ds", nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
};

function mount(path: string, eng: Engagement) {
  m.engagementGet.mockResolvedValue(eng);
  m.engagementsList.mockResolvedValue([eng]);
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
  vi.mocked(resyncBoards).mockResolvedValue(undefined);
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([VEGA, WEB]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([svc]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.notesGet.mockResolvedValue({ engagementId: "e1", hostId: null, body: "", updatedAt: 1 } as never);
  m.tunnelsList.mockResolvedValue([]);
});

describe("metasploit lock", () => {
  it("strip shows the msf lock only in exam sims", async () => {
    const view = mount("/e/e1", E1);
    expect(await screen.findByRole("button", { name: /Metasploit: unused/ })).toBeInTheDocument();
    view.unmount();
    mount("/e/e1", { ...E1, kind: "lab" });
    await screen.findByRole("status", { name: "Engagement status" });
    expect(screen.queryByText(/Metasploit/)).not.toBeInTheDocument();
  });

  it("shows the locked host name in warn", async () => {
    mount("/e/e1", { ...E1, msfHostId: "h1" });
    const btn = await screen.findByRole("button", { name: /Metasploit: VEGA/ });
    expect(within(btn).getByText("VEGA")).toHaveClass("text-warn");
  });

  it("shows locked, not unused, while the locked host's name is unresolved", async () => {
    m.hostsList.mockReturnValue(new Promise(() => {}));
    mount("/e/e1", { ...E1, msfHostId: "h1" });
    const btn = await screen.findByRole("button", { name: /Metasploit: locked/ });
    expect(within(btn).getByText("locked")).toHaveClass("text-warn");
  });

  it("locks a host from the dialog", async () => {
    const user = userEvent.setup();
    m.engagementSetMsfHost.mockResolvedValue({ ...E1, msfHostId: "h2" });
    mount("/e/e1", E1);
    await user.click(await screen.findByRole("button", { name: /Metasploit: unused/ }));
    const dialog = await screen.findByRole("dialog", { name: "Metasploit host" });
    await user.click(within(dialog).getByRole("button", { name: "web02" }));
    expect(m.engagementSetMsfHost).toHaveBeenCalledWith("e1", "h2");
  });

  it("release asks first and clears the lock", async () => {
    const user = userEvent.setup();
    m.engagementSetMsfHost.mockResolvedValue({ ...E1, msfHostId: null });
    mount("/e/e1", { ...E1, msfHostId: "h1" });
    await user.click(await screen.findByRole("button", { name: /Metasploit: VEGA/ }));
    await user.click(await screen.findByRole("button", { name: "Release lock" }));
    expect(m.engagementSetMsfHost).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: /Release the Metasploit lock/ });
    await user.click(within(confirm).getByRole("button", { name: "Release" }));
    await vi.waitFor(() => expect(m.engagementSetMsfHost).toHaveBeenCalledWith("e1", null));
  });
});

describe("dual-homed flag", () => {
  it("dual-homed toggle saves, and the pivot goals live on the engagement view, not the host", async () => {
    const user = userEvent.setup();
    const lab = { ...E1, kind: "lab" as const };
    let hosts = [VEGA, WEB];
    m.hostsList.mockImplementation(async () => hosts);
    m.hostUpdate.mockImplementation(async (_id, input) => {
      hosts = [{ ...VEGA, dualHomed: input.dualHomed ?? false }, WEB];
      return hosts[0]!;
    });
    mount("/e/e1/h/h1", lab);
    await user.click(await screen.findByRole("tab", { name: "Checklist" }));
    await within(await screen.findByRole("tabpanel")).findByText("Check SMB shares and null/guest access");
    expect(screen.queryByText("Tunnel into the next network")).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("region", { name: "Host" })).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit host" });
    await user.click(within(dialog).getByRole("button", { name: "Dual-homed (reaches another network)" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(m.hostUpdate).toHaveBeenCalledWith("h1", expect.objectContaining({ dualHomed: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit host" })).not.toBeInTheDocument());
    expect(screen.queryByText("Tunnel into the next network")).not.toBeInTheDocument();
    expect(screen.queryByText("Sweep the new network for hosts")).not.toBeInTheDocument();

    // Positive proof the flag took effect: the engagement checklist lists the pivot steps behind this host.
    await user.click(await screen.findByRole("link", { name: /Engagement checklist/ }));
    const section = within(await screen.findByRole("region", { name: "Lateral movement" }));
    expect(await section.findByRole("heading", { name: `Behind ${VEGA.name}` })).toBeInTheDocument();
    expect(document.querySelector('li[data-goal-id="h-pivot-tunnel"]')).not.toBeNull();
    expect(document.querySelector('li[data-goal-id="h-pivot-sweep"]')).not.toBeNull();
  });
});

describe("listener on the strip", () => {
  it("shows LHOST:LPORT from settings, and links to Settings", async () => {
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "172.31.45.160", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
    const user = userEvent.setup();
    mount("/e/e1", { ...E1, kind: "lab" });
    const link = await screen.findByRole("link", { name: /LHOST 192\.168\.45\.160:4444/ });
    await user.click(link);
    expect(await screen.findByLabelText("Your IP (tun0)")).toBeInTheDocument();
  });

  it("says LHOST is not set when the IP is blank, and shows the port alone when only it is set", async () => {
    const view = mount("/e/e1", E1);
    expect(await screen.findByRole("link", { name: /LHOST not set/ })).toBeInTheDocument();
    view.unmount();
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "", listenerPort: "443", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
    mount("/e/e1", E1);
    expect(await screen.findByRole("link", { name: /LHOST not set · LPORT 443/ })).toBeInTheDocument();
  });
});

