import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { setImported } from "../../../engines/library/store";
import { useLogEntryStore } from "../../../features/capture/useLogEntryStore";
import { resetNotesStore } from "../../../features/notes/useNotesStore";
import { useEditorTabsStore } from "../../../features/workspace/useEditorTabsStore";
import { useExplorerStore } from "../../../features/workspace/useExplorerStore";
import { useTargetStore } from "../../../features/workspace/useTargetStore";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntryInput } from "../../../types/log";
import { filed } from "./filed";

vi.mock("../../../lib/api");
// The workspace shell, as `npm run tauri:overhaul` runs it.
vi.mock("../../../lib/shell", () => ({ WORKSPACE_SHELL: true, readWorkspaceShell: () => true }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: null, boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const WEB = host("h1", "zzweb01", "198.51.100.21");
const DB = host("h2", "zzdb02", "198.51.100.22");

const nav: { to: NavigateFunction; path: string } = { to: () => undefined, path: "" };
function GrabRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    nav.to = navigate;
    nav.path = `${location.pathname}${location.search}`;
  });
  return null;
}

async function mount(path: string) {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <GrabRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Search hosts, notes and commands" });
}

const go = (to: string) => act(() => void nav.to(to));
const tablist = () => screen.findByRole("tablist", { name: "Open editors" });
async function tabs(): Promise<string[]> {
  return within(await tablist()).getAllByRole("tab").map((t) => (t.getAttribute("aria-selected") === "true" ? `[${t.textContent}]` : t.textContent ?? ""));
}
const page = () => screen.findByRole("region", { name: "New log entry" });
const paste = async () => within(await page()).getByLabelText("Paste");
/** L from the page: the key reaches the window with nothing typed into. */
const pressL = (user: ReturnType<typeof userEvent.setup>) => {
  (document.activeElement as HTMLElement | null)?.blur();
  return user.keyboard("l");
};

function pngFile() {
  return new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:shot"), revokeObjectURL: vi.fn() });
  useEditorTabsStore.getState().reset();
  useTargetStore.getState().reset();
  useExplorerStore.getState().reset();
  useLogEntryStore.getState().reset();
  resetNotesStore();
  setImported({ commands: [], cards: [] });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "192.0.2.10", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
  });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([WEB, DB]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.checklistApplyEntryTicks.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
  m.findingsList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.ruledOutList.mockResolvedValue([]);
  m.extractionFile.mockResolvedValue(filed());
  m.logCreate.mockImplementation(async (_e, input: LogEntryInput) => ({
    id: "l1", engagementId: "e1", kind: input.content.kind, title: input.title, titleEdited: input.titleEdited ?? false,
    ranOn: input.ranOn, hostIds: input.hostIds, observations: input.observations, returnedNothing: input.returnedNothing,
    private: input.private, content: input.content, at: 1, createdAt: 1, updatedAt: 1,
  }));
});

describe("log entry tab (design §2.5)", () => {
  it("L opens it last in the strip with the paste area focused, Target linked and no Explorer row selected", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await go("/e/e1/s/log");
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "[Log]"]));
    await pressL(user);
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "Log", "[New log entry]"]));
    expect(nav.path).toBe("/e/e1/log-entry");
    await waitFor(async () => expect(await paste()).toHaveFocus());
    // Target (zzweb01, the last host picked) is linked to start, and stays Target.
    expect(within(await page()).getByRole("group", { name: "Hosts" })).toHaveTextContent("zzweb01");
    expect(useTargetStore.getState().byEngagement.e1).toBe("h1");
    const explorer = screen.getByRole("complementary", { name: "Explorer" });
    expect(within(explorer).getByRole("button", { name: /^zzweb01/ })).not.toHaveAttribute("aria-current");
    expect(explorer.querySelector("[aria-current], [aria-selected='true'], [data-selected='true']")).toBeNull();
  });

  it("is one tab: opening it again refocuses it with the draft kept, and ⌘W closes it keeping the draft", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await pressL(user);
    await user.click(await paste());
    await user.paste("remember the vhost");
    await go("/e/e1/h/h2");
    await pressL(user);
    // Its own tab comes back where it was, never a second one.
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "[New log entry]", "zzdb02"]));
    expect(await paste()).toHaveValue("remember the vhost");

    // ⌘W closes it; the draft survives, and the Explorer's Plus brings it back.
    await user.keyboard("{Meta>}w{/Meta}");
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "[zzdb02]"]));
    const logs = within(screen.getByRole("complementary", { name: "Explorer" })).getByRole("region", { name: /^Logs/ });
    await user.click(within(logs).getByRole("button", { name: "Add log entry" }));
    await waitFor(async () => expect(await paste()).toHaveValue("remember the vhost"));
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "zzdb02", "[New log entry]"]));
  });

  it("Esc does not close it", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await pressL(user);
    await waitFor(async () => expect(await paste()).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(nav.path).toBe("/e/e1/log-entry");
    expect(await tabs()).toEqual(["zzweb01", "[New log entry]"]);
  });

  it("Save writes the entry, closes the tab and returns focus to the tab that was active", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/s/log");
    await go("/e/e1/h/h1");
    await go("/e/e1/h/h2");
    await go("/e/e1/s/log");
    await waitFor(async () => expect(await tabs()).toEqual(["[Log]", "zzweb01", "zzdb02"]));
    await pressL(user);
    await user.click(await paste());
    await user.paste("check the vhost");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(m.logCreate).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await tabs()).toEqual(["[Log]", "zzweb01", "zzdb02"]));
    expect(nav.path).toBe("/e/e1/s/log");
    await waitFor(async () => expect(within(await tablist()).getByRole("tab", { name: "Log" })).toHaveFocus());
    // The draft went with the save.
    expect(useLogEntryStore.getState().drafts.e1).toBeUndefined();
  });

  it("Discard clears the draft and closes the tab", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await pressL(user);
    await user.click(await paste());
    await user.paste("throwaway");
    await user.click(within(await page()).getByRole("button", { name: "Discard" }));
    await waitFor(async () => expect(await tabs()).toEqual(["[zzweb01]"]));
    expect(m.logCreate).not.toHaveBeenCalled();
    await pressL(user);
    expect(await paste()).toHaveValue("");
  });

  it.each([
    { key: "1", kind: "command", text: "nmap -p- 198.51.100.21" },
    { key: "3", kind: "http", text: "GET / HTTP/1.1\nHost: zzweb01" },
    { key: "4", kind: "note", text: "remember the vhost" },
    { key: "5", kind: "flag", text: "0123456789abcdef0123456789abcdef" },
  ])("makes a $kind entry, the kind picked with ⌘$key", async ({ key, kind, text }) => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await pressL(user);
    await user.click(await paste());
    await user.paste(text);
    await user.keyboard(`{Meta>}${key}{/Meta}`);
    await user.click(within(await page()).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(m.logCreate).toHaveBeenCalledTimes(1));
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({ hostIds: ["h1"], content: { kind } });
  });

  it("makes a screenshot entry from a dropped image, and ⌘P marks it private", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await pressL(user);
    const file = pngFile();
    await act(async () => {
      fireEvent.drop(await paste(), { dataTransfer: { items: [{ kind: "file", type: file.type, getAsFile: () => file }], files: [file], types: ["Files"] } });
    });
    await waitFor(async () => expect(within(await page()).getByRole("img", { name: "Pasted screenshot" })).toHaveAttribute("src", "blob:shot"));
    await user.keyboard("{Meta>}p{/Meta}");
    expect(within(await page()).getByRole("button", { name: /^Private/ })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(m.logCreate).toHaveBeenCalledTimes(1));
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({ private: true, content: { kind: "screenshot" } });
    expect(m.logCreate.mock.calls[0]![1].attachment).toEqual({ mime: "image/png", dataBase64: "iVBORw==" });
  });
});
