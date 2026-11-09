import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { setImported } from "../../../engines/library/store";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { useCaptureStore } from "../../../features/capture/useCaptureStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";

// The real copy-and-log path (logCommand, saveCapture, afterEntrySaved, lockMetasploit) over the fake API.
vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const LHOST = "192.0.2.10";
const LPORT = "443";
const EXAM: Engagement = {
  id: "e1", name: "Exam Zz", kind: "exam-sim", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const WS = host("h1", "ws01.example.test", "198.51.100.21");
const DC = host("h2", "dc01.example.test", "198.51.100.22");
const MET = "Windows x64 Meterpreter (staged)";

/** The engagement the fake API keeps: engagementSetMsfHost changes it. */
let engagement: Engagement = EXAM;
let logged: LogEntry[] = [];

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  engagement = EXAM;
  logged = [];
  m.engagementGet.mockImplementation(async () => engagement);
  m.engagementsList.mockImplementation(async () => [engagement]);
  m.engagementSetMsfHost.mockImplementation(async (_id, hostId) => (engagement = { ...engagement, msfHostId: hostId }));
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: LHOST, listenerPort: LPORT, kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "msfvenom", overrides: {}, lhost: null, listenerPick: {} });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([WS, DC]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockImplementation(async () => logged);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.extractionsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
  m.payloadBuildRecord.mockImplementation(async (input) => input);
  m.logCreate.mockImplementation(async (engagementId, input) => {
    const e = {
      id: `l${logged.length + 1}`, engagementId, kind: "command", title: input.title, titleEdited: input.titleEdited,
      ranOn: input.ranOn, hostIds: input.hostIds, observations: input.observations, returnedNothing: input.returnedNothing,
      private: input.private, content: input.content, payloadId: input.payloadId ?? null, at: 1, createdAt: 1, updatedAt: 1,
    } as LogEntry;
    logged = [...logged, e];
    return e;
  });
});
afterEach(() => setImported({ commands: [], cards: [] }));

const fitRow = (d: ReturnType<typeof within>, name: string) =>
  within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option").find((o) => o.querySelector("[data-fit-name]")?.textContent === name)!;

function mount(path: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openOn(hostId: string, fit: string) {
  const user = userEvent.setup();
  const view = mount(`/e/e1/h/${hostId}`);
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("p");
  const d = within(await screen.findByRole("complementary", { name: "Payloads" }));
  await d.findByRole("listbox", { name: "Fits" });
  await user.click(fitRow(d, fit));
  expect(await d.findByRole("heading", { name: fit })).toBeInTheDocument();
  return { user, d, view };
}

describe("Meterpreter copy and log sets the exam's Metasploit lock", () => {
  it("⌘↵ on a Meterpreter payload locks Metasploit to the target (not Kali); another host then shows the amber lock", async () => {
    const first = await openOn("h1", MET);
    expect(first.d.getByText("Using Meterpreter here makes this your Metasploit machine")).toHaveClass("text-muted");
    await first.user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.engagementSetMsfHost).toHaveBeenCalledWith("e1", "h1"));
    expect(m.logCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ ranOn: "Kali (VM)", hostIds: ["h1"], payloadId: "msf-win-x64-met-staged" }));
    await vi.waitFor(() => expect(first.d.queryByText(/your Metasploit machine/)).not.toBeInTheDocument());
    first.view.unmount();

    const second = await openOn("h2", MET);
    expect(second.d.getByText("Metasploit is locked to ws01.example.test")).toHaveClass("text-warn");
  });
});
