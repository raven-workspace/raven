import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { setImported } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { usePaletteStore } from "../features/palette/usePaletteStore";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../features/arsenal/useFillScope";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Credential } from "../types/credentials";
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
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
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

/** What the host scope shows (its visible text, without the hidden native select's options). */
const scopeText = (picker: HTMLElement): string =>
  [...(picker.closest("label")?.childNodes ?? [])].filter((n) => n.nodeName !== "SELECT").map((n) => n.textContent).join(" ");

describe("⌘K palette", () => {
  it("⌘K opens with the host chip and Enter copies the filled command", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(screen.getByRole("combobox", { name: "Fill for host" })).toHaveDisplayValue("dc01");
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
    expect(screen.queryByRole("combobox", { name: "Fill for host" })).not.toBeInTheDocument();
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzprobe {TARGET_IP} from 10.10.14.9");
    expect(m.logCreate).not.toHaveBeenCalled();
  });

  it("on the dashboard {DEST_DIR} follows the command's own OS, and stays unfilled for an any-OS command", async () => {
    setImported({
      commands: [
        { ...FETCH, id: "zz-cu", title: "Zzcertutil pull", template: "zzcertutil {DEST_DIR}\\x.exe", os: "windows" },
        { ...PROBE, id: "zz-any", title: "Zzanycopy drop", template: "zzanycopy {DEST_DIR}", os: "any" },
      ],
      cards: [],
    });
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzcertutil");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzcertutil C:\\Windows\\Temp\\x.exe");
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzanycopy");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzanycopy {DEST_DIR}");
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
    expect(screen.getByRole("combobox", { name: "Value for FILE" })).toHaveFocus();
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

describe("host picker in the palette (U3)", () => {
  const H2: Host = { ...H1, id: "h2", name: "web02", ip: "10.10.10.6" };

  it("the search bar is one field with a leading glyph and the host scope at its right edge", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    const bar = await screen.findByRole("search", { name: "Search" });
    const b = within(bar);
    expect(b.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
    expect(b.getByText("⌕")).toBeInTheDocument();
    const picker = b.getByRole("combobox", { name: "Fill for host" });
    expect(scopeText(picker)).toBe("for dc01 ⌄");
    // The menu lists each host with its IP, plus No host.
    const opts = within(picker).getAllByRole("option") as HTMLOptionElement[];
    expect(opts.map((o) => o.label)).toEqual(["No host", "dc01  10.10.10.5", "web02  10.10.10.6"]);
    await user.selectOptions(picker, "No host");
    expect(scopeText(picker)).toBe("for no host ⌄");
  });

  it("on the dashboard the bar reads for no host", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.keyboard(cmdK);
    const bar = await screen.findByRole("search", { name: "Search" });
    expect(within(bar).getByText("for no host")).toBeInTheDocument();
    expect(within(bar).queryByRole("combobox", { name: "Fill for host" })).not.toBeInTheDocument();
  });
  const preview = () => screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent!.startsWith("zz"));

  it("⌥H picks another host or No host; fills update and the palette stays open", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    expect((await preview()).textContent).toBe("zzprobe 10.10.10.5 from 10.10.14.9");
    await user.keyboard("{Alt>}h{/Alt}");
    const picker = screen.getByRole("combobox", { name: "Fill for host" });
    expect(picker).toHaveFocus();
    await user.selectOptions(picker, "web02");
    expect((await preview()).textContent).toBe("zzprobe 10.10.10.6 from 10.10.14.9");
    await user.selectOptions(picker, "No host");
    expect((await preview()).textContent).toBe("zzprobe {TARGET_IP} from 10.10.14.9");
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("changing host clears typed values", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzfetch");
    await user.type(await screen.findByRole("combobox", { name: "Value for FILE" }), "x.exe");
    expect((await preview()).textContent).toBe("zzfetch http://10.10.14.9/x.exe");
    await user.selectOptions(screen.getByRole("combobox", { name: "Fill for host" }), "web02");
    expect((await preview()).textContent).toBe("zzfetch http://10.10.14.9/{FILE}");
  });
});

describe("token suggestions (U4)", () => {
  const cred = (id: string, username: string, secret: string): Credential => ({
    id, engagementId: "e1", type: "password", username, domain: "CORP", secret, hashType: null, scope: "domain", localHostId: null,
    sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: 1, updatedAt: 1,
  });
  const USERCMD: LibraryCommand = { ...PROBE, id: "zz-user", title: "Zzuser login", template: "zzuser {USER}@{TARGET_IP}" };

  it("searching a credential's secret finds no log entry or note that contains it", async () => {
    const user = userEvent.setup();
    m.credentialsList.mockResolvedValue([
      cred("c1", "alice", "Winter2024!"),
      { ...cred("c2", "bob", "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0"), type: "hash", hashType: "pwdump" },
    ]);
    const entry = (id: string, title: string, command: string) => ({
      id, engagementId: "e1", kind: "command", title, hostIds: ["h1"], at: 1, createdAt: 1, updatedAt: 1,
      content: { kind: "command", blocks: [{ command, output: "", shell: "" }] },
    });
    m.logList.mockResolvedValue([
      entry("l1", "Zzspray alice", "nxc smb 10.10.10.5 -u alice -p 'Winter2024!'"),
      entry("l2", "Zzpth bob", "nxc smb 10.10.10.5 -u bob -H 31D6CFE0D16AE931B73C59D7E0C089C0"),
      { ...entry("l3", "Zznote", ""), kind: "note", content: { kind: "note", text: "alice uses Winter2024! everywhere" } },
    ] as never);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    const search = await screen.findByRole("combobox", { name: "Search" });
    const dlg = within(screen.getByRole("dialog", { name: "Search" }));
    // The entries are searchable by their other words.
    await user.type(search, "zz");
    expect(await dlg.findByText("Zzspray alice")).toBeInTheDocument();
    expect(dlg.getByText("Zzpth bob")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "everywhere");
    expect(await dlg.findByText("Zznote")).toBeInTheDocument();
    for (const q of ["winter2024", "31d6cfe0", "aad3b435"]) {
      await user.clear(search);
      await user.type(search, q);
      expect(dlg.queryByText("Zzspray alice")).not.toBeInTheDocument();
      expect(dlg.queryByText("Zzpth bob")).not.toBeInTheDocument();
      expect(dlg.queryByText("Zznote")).not.toBeInTheDocument();
    }
  });

  it("a USER token offers the engagement's usernames (never secrets) and picking one fills the command, palette open", async () => {
    const user = userEvent.setup();
    m.credentialsList.mockResolvedValue([cred("c1", "alice", "Winter2024!"), cred("c2", "bob", "Summer2025!")]);
    setImported({ commands: [USERCMD], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzuser");
    await user.keyboard("{Tab}");
    const field = screen.getByRole("combobox", { name: "Value for USER" });
    expect(field).toHaveFocus();
    const list = await screen.findByRole("listbox", { name: "Suggestions for USER" });
    expect(within(list).getAllByRole("option").map((o) => o.firstChild?.textContent)).toEqual(["alice", "bob"]);
    expect(screen.queryByText(/Winter2024!|Summer2025!/)).not.toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(field).toHaveValue("bob");
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzuser bob@10.10.10.5")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).not.toContain("zzuser");
    // Typing still works as free text.
    await user.clear(field);
    await user.type(field, "carol");
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzuser carol@10.10.10.5")).toBeInTheDocument();
  });

  it("Esc with the suggestion list open closes only the list; the next Esc closes the palette", async () => {
    const user = userEvent.setup();
    m.credentialsList.mockResolvedValue([cred("c1", "alice", "Winter2024!")]);
    setImported({ commands: [USERCMD], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "zzuser");
    await user.keyboard("{Tab}");
    await user.type(screen.getByRole("combobox", { name: "Value for USER" }), "a");
    expect(await screen.findByRole("listbox", { name: "Suggestions for USER" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Suggestions for USER" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(box).toHaveValue("zzuser");
    expect(screen.getByRole("combobox", { name: "Value for USER" })).toHaveValue("a");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
  });

  it("Esc with the suggestion list open in the drawer closes only the list; the next Esc goes back", async () => {
    const user = userEvent.setup();
    setImported({
      commands: [{ ...FETCH, cardId: "c-fetch", source: "field-manual" }],
      cards: [{ id: "c-fetch", title: "Fetch card", stage: "initial-foothold", category: "Shells", os: "any", file: "02-Cards/S/F.md" }],
      toolkit: [{ os: "windows", purpose: "Enumeration", file: "winPEASx64.exe", note: "", where: "", staged: true }],
    });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    act(() => useArsenalStore.getState().openCard("c-fetch"));
    const d = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await user.click(await d.findByRole("combobox", { name: "Value for FILE" }));
    expect(await d.findByRole("listbox", { name: "Suggestions for FILE" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(d.queryByRole("listbox", { name: "Suggestions for FILE" })).not.toBeInTheDocument();
    expect(d.getByRole("heading", { name: "Fetch card" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(d.queryByRole("heading", { name: "Fetch card" })).not.toBeInTheDocument();
    expect(d.getByRole("listbox", { name: "Arsenal results" })).toBeInTheDocument();
  });

  it("a FILE chip in the drawer offers Toolkit files, staged first", async () => {
    const user = userEvent.setup();
    setImported({
      commands: [{ ...FETCH, cardId: "c-fetch", source: "field-manual" }],
      cards: [{ id: "c-fetch", title: "Fetch card", stage: "initial-foothold", category: "Shells", os: "any", file: "02-Cards/S/F.md" }],
      toolkit: [
        { os: "windows", purpose: "Enumeration", file: "SharpHound.exe", note: "", where: "", staged: false },
        { os: "windows", purpose: "Enumeration", file: "winPEASx64.exe", note: "", where: "", staged: true },
      ],
    });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    act(() => useArsenalStore.getState().openCard("c-fetch"));
    const d = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await user.click(await d.findByRole("combobox", { name: "Value for FILE" }));
    const list = await d.findByRole("listbox", { name: "Suggestions for FILE" });
    expect(within(list).getAllByRole("option").map((o) => o.firstChild?.textContent)).toEqual(["winPEASx64.exe", "SharpHound.exe"]);
    await user.click(within(list).getAllByRole("option")[0]!);
    expect(await d.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzfetch http://10.10.14.9/winPEASx64.exe")).toBeInTheDocument();
  });
});
