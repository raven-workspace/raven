import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
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
import type { PayloadBuild } from "../../../types/payloadBuild";

vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn() }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const LHOST = "192.0.2.10";
const NEW_LHOST = "192.0.2.20";
const LPORT = "443";
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const WS = host("h1", "ws01.example.test", "198.51.100.21");
const DC = host("h2", "dc01.example.test", "198.51.100.22");
const at = new Date(2026, 10, 9, 9, 5).getTime();
const LOGGED: LogEntry = {
  id: "l1", engagementId: "e1", kind: "command", title: "zz", titleEdited: false, ranOn: "Kali (VM)", hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "command", blocks: [{ command: "zz", output: "zz" }] }, at, createdAt: at, updatedAt: at,
};

/** The build memory the fake API keeps: a record replaces the one for the same host and payload. */
let builds: PayloadBuild[] = [];
const seed = (payloadId: string, lhost: string, hostId = "h1") => {
  builds = [{ engagementId: "e1", hostId, payloadId, lhost, lport: LPORT, at }];
};

function mount(path: string, engagement: Engagement = E1) {
  m.engagementGet.mockResolvedValue(engagement);
  m.engagementsList.mockResolvedValue([engagement]);
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
  builds = [];
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: { h1: { context: "powershell" } }, lhost: null, listenerPick: {} });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([WS, DC]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.payloadBuildsList.mockImplementation(async () => builds.map((b) => ({ ...b })));
  m.payloadBuildRecord.mockImplementation(async (input) => {
    builds = [...builds.filter((b) => !(b.hostId === input.hostId && b.payloadId === input.payloadId)), input];
    return input;
  });
  vi.mocked(logCommand).mockResolvedValue(LOGGED);
});
afterEach(() => setImported({ commands: [], cards: [] }));

const drawer = () => screen.findByRole("complementary", { name: "Payloads" });
const fitRow = (d: ReturnType<typeof within>, name: string) =>
  within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option").find((o) => o.querySelector("[data-fit-name]")?.textContent === name)!;

/** Opens the drawer on ws01 and picks the fit by name; focus ends on the fit list, so ↵ copies the payload. */
async function openOn(fit: string, engagement: Engagement = E1) {
  const user = userEvent.setup();
  mount("/e/e1/h/h1", engagement);
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("p");
  const d = within(await drawer());
  await d.findByRole("listbox", { name: "Fits" });
  await user.click(fitRow(d, fit));
  expect(await d.findByRole("heading", { name: fit })).toBeInTheDocument();
  return { user, d };
}
const recorded = (payloadId: string, lhost: string) =>
  expect.objectContaining({ engagementId: "e1", hostId: "h1", payloadId, lhost, lport: LPORT });
const REBUILD_LINE = `Rebuild first: built with ${LHOST}:${LPORT}, now ${NEW_LHOST}:${LPORT}`;
/** Whether `a` comes before `b` in the document. */
const before = (a: HTMLElement, b: HTMLElement) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("Payload build memory", () => {
  it("copying a build records it: ↵, the Copy button and ⌘↵ alike", async () => {
    usePayloadsStore.setState({ generator: "msfvenom" });
    const { user, d } = await openOn("Windows x64 exe");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledTimes(1));
    expect(m.payloadBuildRecord).toHaveBeenLastCalledWith(recorded("msf-win-x64-exe", LHOST));
    await user.click(d.getByRole("button", { name: "Copy payload" }));
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledTimes(2));
    expect(m.payloadBuildRecord).toHaveBeenLastCalledWith(recorded("msf-win-x64-exe", LHOST));
    await user.click(fitRow(d, "Windows x64 exe"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledTimes(3));
    expect(m.payloadBuildRecord).toHaveBeenLastCalledWith(recorded("msf-win-x64-exe", LHOST));
    expect(logCommand).toHaveBeenCalledTimes(1);
  });

  it("records LHOST trimmed, so a typed trailing space never reads as a rebuild", async () => {
    usePayloadsStore.setState({ generator: "msfvenom", lhost: `${NEW_LHOST} ` });
    const { user, d } = await openOn("Windows x64 exe");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledTimes(1));
    expect(m.payloadBuildRecord).toHaveBeenLastCalledWith(recorded("msf-win-x64-exe", NEW_LHOST));
    expect(d.queryByText(/Rebuild first/)).not.toBeInTheDocument();
  });

  it("a record failure shows in the status line and the copy stands", async () => {
    usePayloadsStore.setState({ generator: "msfvenom" });
    m.payloadBuildRecord.mockRejectedValue(new Error("vault is locked"));
    const { user, d } = await openOn("Windows x64 exe");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await d.findByRole("alert")).toHaveTextContent("vault is locked");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
  });

  it("a changed LHOST blocks the trigger until the build step is copied", async () => {
    seed("nishang-cradle", LHOST);
    usePayloadsStore.setState({ lhost: NEW_LHOST });
    const { user, d } = await openOn("Nishang cradle (served rev.ps1)");
    const line = await d.findByText(REBUILD_LINE);
    expect(line).toHaveClass("payload-block__stale");
    // The line sits right above the build step (the prepare block), which is the first step.
    expect(line.nextElementSibling).toHaveTextContent("Prepare on Kali");
    expect(before(d.getByLabelText("Command: Prepare on Kali"), d.getByLabelText("Command: Listener"))).toBe(true);

    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await d.findByText(`Built with ${LHOST}:${LPORT}; rebuild first. Press ↵ again to copy anyway`)).toHaveClass("payload-block__note--warn");
    expect(await navigator.clipboard.readText()).toBe("untouched");

    await user.click(d.getByRole("button", { name: "Copy prepare on Kali" }));
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledWith(recorded("nishang-cradle", NEW_LHOST)));
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Prepare on Kali").textContent);
    await vi.waitFor(() => expect(d.queryByText(REBUILD_LINE)).not.toBeInTheDocument());

    await user.click(fitRow(d, "Nishang cradle (served rev.ps1)"));
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
  });

  it("forcing past the block does not clear it", async () => {
    seed("nishang-cradle", LHOST);
    usePayloadsStore.setState({ lhost: NEW_LHOST });
    const { user, d } = await openOn("Nishang cradle (served rev.ps1)");
    await d.findByText(REBUILD_LINE);
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
    expect(m.payloadBuildRecord).not.toHaveBeenCalled();
    expect(d.getByText(REBUILD_LINE)).toBeInTheDocument();
  });

  it("a trigger copy with nothing stale records the build", async () => {
    const { user } = await openOn("Nishang cradle (served rev.ps1)");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledWith(recorded("nishang-cradle", LHOST)));
  });

  it("a stale msfvenom build moves the payload above the listener", async () => {
    seed("msf-win-x64-exe", LHOST);
    usePayloadsStore.setState({ generator: "msfvenom", lhost: NEW_LHOST });
    const { user, d } = await openOn("Windows x64 exe");
    const line = await d.findByText(REBUILD_LINE);
    expect(before(line, d.getByLabelText("Command: Payload"))).toBe(true);
    expect(before(d.getByLabelText("Command: Payload"), d.getByLabelText("Command: Listener"))).toBe(true);
    // The payload is the build step: no hold-back, and the copy records the new LHOST.
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledWith(recorded("msf-win-x64-exe", NEW_LHOST)));
    await vi.waitFor(() => expect(d.queryByText(REBUILD_LINE)).not.toBeInTheDocument());
  });

  it("while the build memory loads, a trigger copy is held once and never records", async () => {
    m.payloadBuildsList.mockReturnValue(new Promise(() => {}));
    const { user, d } = await openOn("Nishang cradle (served rev.ps1)");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    const hint = await d.findByText("Checking the last build. Press ↵ again to copy anyway");
    expect(hint).toHaveClass("payload-block__note");
    expect(hint).not.toHaveClass("payload-block__note--warn");
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
    expect(m.payloadBuildRecord).not.toHaveBeenCalled();
    // The build step still records: it is built with the current values.
    await user.click(d.getByRole("button", { name: "Copy prepare on Kali" }));
    await vi.waitFor(() => expect(m.payloadBuildRecord).toHaveBeenCalledWith(recorded("nishang-cradle", LHOST)));
  });

  it("a build memory that fails to load shows in the status line, and trigger copies do not record", async () => {
    m.payloadBuildsList.mockRejectedValue(new Error("payload builds unavailable"));
    const { user, d } = await openOn("Nishang cradle (served rev.ps1)");
    expect(await d.findByRole("alert")).toHaveTextContent("payload builds unavailable");
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
    expect(m.payloadBuildRecord).not.toHaveBeenCalled();
  });

  it("no host, no block", async () => {
    seed("nishang-cradle", LHOST);
    usePayloadsStore.setState({ lhost: NEW_LHOST, overrides: { "": { os: "windows", context: "powershell" } } });
    const { user, d } = await openOn("Nishang cradle (served rev.ps1)");
    await d.findByText(REBUILD_LINE);
    await user.click(d.getByRole("button", { name: /^Fill for host/ }));
    await user.click(d.getByRole("option", { name: /No host/ }));
    await vi.waitFor(() => expect(d.queryByText(REBUILD_LINE)).not.toBeInTheDocument());
    await user.click(fitRow(d, "Nishang cradle (served rev.ps1)"));
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
    await user.click(d.getByRole("button", { name: "Copy prepare on Kali" }));
    expect(m.payloadBuildRecord).not.toHaveBeenCalled();
  });
});

describe("Meterpreter lock", () => {
  const EXAM: Engagement = { ...E1, kind: "exam-sim" };
  const MET = "Windows x64 Meterpreter (staged)";
  beforeEach(() => usePayloadsStore.setState({ generator: "msfvenom" }));

  it("locked to another host: an amber line, and the first ↵ is held back with it", async () => {
    const { user, d } = await openOn(MET, { ...EXAM, msfHostId: "h2" });
    expect(d.getByText("Metasploit is locked to dc01.example.test")).toHaveClass("payload-block__lock--breach");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await d.findByText("Metasploit is locked to dc01.example.test. Press ↵ again to copy anyway")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
  });

  it("no lock yet: a muted line, and ↵ copies at once", async () => {
    const { user, d } = await openOn(MET, EXAM);
    expect(d.getByText("Using Metasploit here makes this your Metasploit machine")).not.toHaveClass("payload-block__lock--breach");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(d.getByLabelText("Command: Payload").textContent);
  });

  it("a plain shell payload shows no lock line", async () => {
    const { d } = await openOn("Windows x64 shell (staged)", { ...EXAM, msfHostId: "h2" });
    expect(d.queryByText(/Metasploit is locked|your Metasploit machine/)).not.toBeInTheDocument();
  });

  it("outside an exam sim there is no lock line", async () => {
    const { d } = await openOn(MET, { ...E1, msfHostId: "h2" });
    expect(d.queryByText(/Metasploit is locked|your Metasploit machine/)).not.toBeInTheDocument();
  });
});
