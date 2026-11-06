import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { setImported } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { usePaletteStore } from "../features/palette/usePaletteStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntryInput } from "../types/log";

vi.mock("../lib/api");
vi.mock("../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
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
const PROBE: LibraryCommand = {
  id: "zz-probe", title: "Zzprobe the target", tool: "zzprobe", template: "zzprobe {TARGET_IP} from {LHOST}", os: "any", runFrom: "attacker",
  goals: [], source: "raven",
};
const FETCH: LibraryCommand = {
  id: "zz-fetch", title: "Fetch winpeas to the target", tool: "zzfetch", template: "zzfetch http://{LHOST}/{FILE}", os: "windows", runFrom: "target",
  goals: [], source: "raven",
};

function mount(path: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const cmdK = "{Meta>}k{/Meta}";

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  setImported({
    commands: [PROBE, FETCH],
    cards: [],
    toolkit: [{ os: "windows", purpose: "Enumeration", file: "winPEASx64.exe", note: "", where: "", staged: true }],
  });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm",
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.logCreate.mockImplementation(async (_e, input: LogEntryInput) => ({
    id: "l1", engagementId: "e1", kind: input.content.kind, title: input.title, titleEdited: false, ranOn: input.ranOn, hostIds: input.hostIds,
    observations: null, returnedNothing: false, private: false, content: input.content, at: 1, createdAt: 1, updatedAt: 1,
  }));
});
afterEach(() => setImported({ commands: [], cards: [] }));

describe("⌘K palette", () => {
  it("⌘K opens with the host chip and Enter copies the filled command", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(screen.getByText("for dc01")).toBeInTheDocument();
    await user.type(box, "zzprobe");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzprobe 10.10.10.5 from 10.10.14.9");
  });

  it("{DC_IP} fills from the engagement's DC even when its ports were never scanned", async () => {
    const user = userEvent.setup();
    const MS: Host = { ...H1, id: "h2", name: "ms01", ip: "10.10.10.6" };
    m.hostsList.mockResolvedValue([H1, MS]);
    setImported({ commands: [{ ...PROBE, id: "zz-dc", title: "Zzdc sync time", template: "zzdc {DC_IP}" }], cards: [] });
    mount("/e/e1/h/h2");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzdc");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzdc 10.10.10.5");
  });

  it("⌘↵ copies and logs an entry for the host", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![0]).toBe("e1");
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({
      hostIds: ["h1"],
      content: { kind: "command", blocks: [{ command: "zzprobe 10.10.10.5 from 10.10.14.9" }] },
    });
    expect(await navigator.clipboard.readText()).toBe("zzprobe 10.10.10.5 from 10.10.14.9");
  });

  it("on the dashboard host tokens stay unfilled", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.keyboard(cmdK);
    expect(screen.queryByText(/^for /)).not.toBeInTheDocument();
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzprobe {TARGET_IP} from 10.10.14.9");
    expect(m.logCreate).not.toHaveBeenCalled();
  });

  it("a staged toolkit file pre-fills FILE and Tab edits an unresolved token", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "fetch winpeas");
    expect(await screen.findByText("zzfetch http://10.10.14.9/winPEASx64.exe")).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "fetch");
    expect(await screen.findByText("zzfetch http://10.10.14.9/{FILE}")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Value for FILE" })).toHaveFocus();
    await user.keyboard("x.exe{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzfetch http://10.10.14.9/x.exe");
  });

  it("Escape closes and returns focus", async () => {
    const user = userEvent.setup();
    mount("/");
    const settings = await screen.findByRole("link", { name: "Settings" });
    settings.focus();
    await user.keyboard(cmdK);
    await screen.findByRole("combobox", { name: "Search" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Search" })).not.toBeInTheDocument();
    expect(settings).toHaveFocus();
  });

  it("typing in an input does not open on K alone", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await user.keyboard("k");
    await user.keyboard("K");
    input.blur();
    await user.keyboard("k");
    expect(screen.queryByRole("combobox", { name: "Search" })).not.toBeInTheDocument();
    input.remove();
  });
});
