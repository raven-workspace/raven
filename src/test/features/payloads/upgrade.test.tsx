import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { buildPayload } from "../../../engines/payloads/build";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import { PayloadBlock } from "../../../features/payloads/PayloadView";
import { setImported } from "../../../engines/library/store";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { logCommand } from "../../../features/capture/logCommand";
import { useCaptureStore } from "../../../features/capture/useCaptureStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";

vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn() }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const LHOST = "192.0.2.10";
const LPORT = "443";
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const WEB = host("h3", "web01.example.test", "198.51.100.20");
const at = new Date(2026, 10, 9, 9, 5).getTime();
const LOGGED: LogEntry = {
  id: "l1", engagementId: "e1", kind: "command", title: "zz", titleEdited: false, ranOn: "Kali (VM)", hostIds: ["h3"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "command", blocks: [{ command: "zz", output: "zz" }] }, at, createdAt: at, updatedAt: at,
};

function mount(path: string) {
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: LHOST, listenerPort: LPORT, kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
  });
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
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: "e1", hostId: "h3" });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: {}, lhost: null, listenerPick: {} });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([WEB]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
  vi.mocked(logCommand).mockResolvedValue(LOGGED);
});
afterEach(() => setImported({ commands: [], cards: [] }));

const payloadText = (d: ReturnType<typeof within>) => d.getByLabelText("Command: Payload").textContent;
const step = (d: ReturnType<typeof within>, title: string) =>
  within(d.getByRole("listbox", { name: "Steps" })).getAllByRole("option").find((o) => o.querySelector("[data-fit-name]")?.textContent === title)!;

/** Opens the drawer on web01 at the Upgrade generator. */
async function openUpgrade() {
  const user = userEvent.setup();
  mount("/e/e1/h/h3");
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("p");
  const d = within(await screen.findByRole("complementary", { name: "Payloads" }));
  await d.findByRole("listbox", { name: "Fits" });
  await user.keyboard("{Alt>}6{/Alt}");
  await d.findByRole("listbox", { name: "Steps" });
  return { user, d };
}

describe("Upgrade steps", () => {
  it("each step says where it runs", async () => {
    const { user, d } = await openUpgrade();
    expect(d.getByRole("heading", { name: "Run on the target" })).toBeInTheDocument();
    await user.click(step(d, "3. Raw terminal, foreground"));
    expect(await d.findByRole("heading", { name: "Run in your terminal" })).toBeInTheDocument();
    await user.click(step(d, "4. Set TERM"));
    expect(await d.findByRole("heading", { name: "Run on the target" })).toBeInTheDocument();
  });

  it("Ctrl-Z is a key: no Copy, and ↵ does not copy it", async () => {
    const { user, d } = await openUpgrade();
    await user.click(step(d, "2. Background the shell"));
    expect(await d.findByRole("heading", { name: "Press in your terminal" })).toBeInTheDocument();
    expect(d.getByText("Ctrl-Z", { selector: "kbd" })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: "Copy payload" })).not.toBeInTheDocument();
    expect(d.queryByLabelText("Command: Payload")).not.toBeInTheDocument();
    await navigator.clipboard.writeText("untouched");
    d.getByText("Ctrl-Z", { selector: "kbd" }).closest("section")!.parentElement!.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(await navigator.clipboard.readText()).toBe("untouched");
    expect(logCommand).not.toHaveBeenCalled();
  });

  it("⇥ skips past Ctrl-Z", async () => {
    const { user, d } = await openUpgrade();
    await user.click(step(d, "1. Spawn a PTY (script)"));
    expect(payloadText(d)).toBe("script -qc /bin/bash /dev/null");
    const body = d.getByLabelText("Command: Payload").closest("[tabindex='-1']") as HTMLElement;
    body.focus();
    await user.keyboard("{Tab}");
    expect(payloadText(d)).toBe("stty raw -echo; fg");
    expect(step(d, "3. Raw terminal, foreground")).toHaveAttribute("aria-selected", "true");
  });

  it("⌘↵ on step 3 logs it as run on Kali; step 4 as run on the target", async () => {
    const { user, d } = await openUpgrade();
    await user.click(step(d, "3. Raw terminal, foreground"));
    d.getByLabelText("Command: Payload").focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(logCommand).toHaveBeenCalledTimes(1));
    expect(vi.mocked(logCommand).mock.calls[0]![1]).toEqual(expect.objectContaining({ ranOn: "Kali (VM)", payloadId: "upgrade-3-raw" }));
    await user.click(step(d, "4. Set TERM"));
    d.getByLabelText("Command: Payload").focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(logCommand).toHaveBeenCalledTimes(2));
    expect(vi.mocked(logCommand).mock.calls[1]![1]).toEqual(expect.objectContaining({ ranOn: "web01.example.test", payloadId: "upgrade-4-term" }));
  });
});

describe("What each part does: the base64 script", () => {
  it("lists a -e payload's decoded parts under their own heading", () => {
    const built = buildPayload(REVERSE_SHELLS.find((x) => x.id === "ps-b64")!, "cmd", { LHOST, LPORT });
    render(<PayloadBlock built={built} pasteLabel="Paste into cmd.exe" onCopy={async () => "copied"} onCopyListener={async () => "copied"} />);
    const inside = screen.getByRole("region", { name: "Inside the base64 script" });
    expect(within(inside).getByText('TCPClient("192.0.2.10",443)')).toBeInTheDocument();
    expect(within(inside).getByText("iex $data")).toBeInTheDocument();
    const outside = screen.getByRole("region", { name: "What each part does" });
    expect(within(outside).queryByText("iex $data")).not.toBeInTheDocument();
    expect(within(outside).getByText("-nop")).toBeInTheDocument();
  });
});
