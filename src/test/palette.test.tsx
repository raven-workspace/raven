import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AUDIT_NOTE_IDS, AUDIT_NOTE_SOURCES } from "../audit/fixtures";
import type { FieldManualSnapshot } from "../engines/fieldManual/merge";
import { parseNote, type ManualNote } from "../engines/manual";
import { examScope } from "../engines/exam";
import { searchPalette } from "../features/palette/search";
import { setImported } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { useCredPickStore } from "../features/checklist/credPick";
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
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
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
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
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
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
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
const scopeText = (chip: HTMLElement): string => [...chip.children].map((n) => n.textContent).join(" ").trim();
const hostChip = (scope: { getByRole: typeof screen.getByRole }) => scope.getByRole("button", { name: /^Fill for host/ });

describe("⌘K palette", () => {
  it("⌘K opens with the host chip and Enter copies the filled command", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(hostChip(screen)).toHaveAccessibleName("Fill for host dc01");
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
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzdc");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzdc 10.10.10.5");
  });

  it("⌘↵ copies and logs an entry for the host", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
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
    await screen.findByText("Lab A");
    await user.keyboard(cmdK);
    expect(screen.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{Enter}");
    // The unfilled {TARGET_IP} holds the first Enter back; the second copies anyway.
    expect(await screen.findByText("{TARGET_IP} not filled. Press ↵ again to copy anyway")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await vi.waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzprobe {TARGET_IP} from 10.10.14.9"));
    expect(m.logCreate).not.toHaveBeenCalled();
  });

  it("hovering another row keeps the clicked row selected and its fill fields reachable", async () => {
    const user = userEvent.setup();
    setImported({ commands: [PROBE, { ...PROBE, id: "zz-plain", title: "Zzprobe plain", template: "zzprobe --version" }], cards: [] });
    mount("/");
    await screen.findByText("Lab A");
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    const target = await screen.findByRole("option", { name: /Zzprobe the target/ });
    const other = screen.getByRole("option", { name: /Zzprobe plain/ });
    await user.click(target);
    fireEvent.mouseMove(other);
    expect(target).toHaveAttribute("aria-selected", "true");
    expect(other).toHaveAttribute("aria-selected", "false");
    const field = screen.getByRole("combobox", { name: "Value for TARGET_IP" });
    await user.click(field);
    await user.type(field, "198.51.100.7");
    fireEvent.mouseMove(other);
    expect(screen.getByRole("combobox", { name: "Value for TARGET_IP" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toContain("198.51.100.7");
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
    await screen.findByText("Lab A");
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzcertutil");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzcertutil C:\\Windows\\Temp\\x.exe");
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzanycopy");
    await user.keyboard("{Enter}{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzanycopy {DEST_DIR}");
  });

  it("a staged toolkit file pre-fills FILE and Tab edits an unresolved token", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "fetch winpeas");
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzfetch http://10.10.14.9/winPEASx64.exe")).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "fetch");
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzfetch http://10.10.14.9/{FILE}")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Value for FILE" })).toHaveFocus();
    await user.keyboard("x.exe{Enter}");
    expect(await navigator.clipboard.readText()).toBe("zzfetch http://10.10.14.9/x.exe");
  });

  it("Escape closes and returns focus", async () => {
    const user = userEvent.setup();
    mount("/");
    const settings = await screen.findByRole("button", { name: "Settings" });
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
    await screen.findByText("Lab A");
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
  const H2: Host = { ...H1, id: "h2", name: "web07", ip: "10.10.10.6" };

  it("the search bar is one field with a leading glyph; the host chip sits on the row under it", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const bar = await screen.findByRole("search", { name: "Search" });
    const b = within(bar);
    expect(b.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
    // A leading search icon, decorative (hidden from assistive tech), before the field.
    const glyph = bar.querySelector('[aria-hidden="true"] svg');
    expect(glyph).not.toBeNull();
    expect(glyph!.compareDocumentPosition(b.getByRole("combobox", { name: "Search" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const chip = hostChip(screen);
    expect(bar).not.toContainElement(chip);
    expect(scopeText(chip)).toBe("Host dc01");
    // The menu lists each host with its IP, plus No host.
    await user.click(chip);
    const opts = within(screen.getByRole("listbox", { name: "Fill for host" })).getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual(["No host", "dc0110.10.10.5", "web0710.10.10.6"]);
    await user.click(opts[0]!);
    expect(scopeText(chip)).toBe("No host");
  });

  it("on the dashboard the bar reads for no host", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Lab A");
    await user.keyboard(cmdK);
    const bar = await screen.findByRole("search", { name: "Search" });
    expect(within(bar).getByText("for no host")).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
  });
  const preview = () => screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent!.startsWith("zz"));

  it("⌥H picks another host or No host; fills update and the palette stays open", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    expect((await preview()).textContent).toBe("zzprobe 10.10.10.5 from 10.10.14.9");
    await user.keyboard("{Alt>}h{/Alt}");
    expect(hostChip(screen)).toHaveFocus();
    await user.click(screen.getByRole("option", { name: /web07/ }));
    expect((await preview()).textContent).toBe("zzprobe 10.10.10.6 from 10.10.14.9");
    await user.keyboard("{Alt>}h{/Alt}");
    await user.click(screen.getByRole("option", { name: "No host" }));
    expect((await preview()).textContent).toBe("zzprobe {TARGET_IP} from 10.10.14.9");
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("changing host clears typed values", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzfetch");
    await user.type(await screen.findByRole("combobox", { name: "Value for FILE" }), "x.exe");
    expect((await preview()).textContent).toBe("zzfetch http://10.10.14.9/x.exe");
    await user.click(hostChip(screen));
    await user.click(screen.getByRole("option", { name: /web07/ }));
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
    await screen.findByRole("tab", { name: "Next" });
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
    await screen.findByRole("tab", { name: "Next" });
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

  it("⌥C opens the credential chip; picking a credential fills USER and PASS and is shared with the host", async () => {
    const user = userEvent.setup();
    m.credentialsList.mockResolvedValue([cred("c1", "alice", "Winter2024!"), cred("c2", "bob", "Summer2025!")]);
    setImported({ commands: [{ ...USERCMD, template: "zzuser {USER}@{TARGET_IP} {PASS}" }], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzuser");
    await user.keyboard("{Alt>}c{/Alt}");
    const chip = screen.getByRole("button", { name: /^Fill with credential/ });
    expect(chip).toHaveFocus();
    await user.click(screen.getByRole("option", { name: /bob/ }));
    expect(useCredPickStore.getState().picks.h1).toBe("c2");
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzuser bob@10.10.10.5 ••••••••")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Value for USER" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Value for PASS" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Summer2025!/)).not.toBeInTheDocument();
  });

  it("the ⇥ edit-a-value hint shows only while a value is missing", async () => {
    const user = userEvent.setup();
    m.credentialsList.mockResolvedValue([cred("c9", "carol", "Autumn2026!")]);
    setImported({ commands: [{ ...USERCMD, template: "zzuser {USER}@{TARGET_IP} {PASS}" }], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const dlg = within(await screen.findByRole("dialog", { name: "Search" }));
    await user.type(dlg.getByRole("combobox", { name: "Search" }), "zzuser");
    const allHints = async () => {
      await user.click(within(dlg.getByRole("group", { name: "Search shortcuts" })).getByRole("button", { name: "All shortcuts" }));
      const shown = screen.queryByText("edit a value") !== null;
      await user.keyboard("{Escape}");
      return shown;
    };
    expect(await allHints()).toBe(true);
    await user.keyboard("{Alt>}c{/Alt}");
    await user.click(screen.getByRole("option", { name: /carol/ }));
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzuser carol@10.10.10.5 ••••••••")).toBeInTheDocument();
    expect(await allHints()).toBe(false);
  });

  it("Tab with every value filled is never swallowed: it moves on to the host picker", async () => {
    const user = userEvent.setup();
    // An id no other test lists, so the shared credential pick it leaves behind fills nothing elsewhere.
    m.credentialsList.mockResolvedValue([cred("c9", "carol", "Autumn2026!")]);
    setImported({ commands: [{ ...USERCMD, template: "zzuser {USER}@{TARGET_IP} {PASS}" }], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "zzuser");
    await user.keyboard("{Alt>}c{/Alt}");
    await user.click(screen.getByRole("option", { name: /carol/ }));
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzuser carol@10.10.10.5 ••••••••")).toBeInTheDocument();
    box.focus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: /^Fill for host/ })).toHaveFocus();
  });

  it("Esc with the suggestion list open closes only the list; the next Esc closes the palette", async () => {
    const user = userEvent.setup();
    m.credentialsList.mockResolvedValue([cred("c1", "alice", "Winter2024!")]);
    setImported({ commands: [USERCMD], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
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
    await screen.findByRole("tab", { name: "Next" });
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
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("c-fetch"));
    const d = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await user.click(await d.findByRole("combobox", { name: "Value for FILE" }));
    const list = await d.findByRole("listbox", { name: "Suggestions for FILE" });
    expect(within(list).getAllByRole("option").map((o) => o.firstChild?.textContent)).toEqual(["winPEASx64.exe", "SharpHound.exe"]);
    await user.click(within(list).getAllByRole("option")[0]!);
    expect(await d.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzfetch http://10.10.14.9/winPEASx64.exe")).toBeInTheDocument();
  });
});

describe("⌘K groups, hosts and contained suggestions", () => {
  const H2: Host = { ...H1, id: "h2", name: "web07", ip: "10.10.10.66" };
  const CARD_CMD: LibraryCommand = { ...PROBE, id: "zz-card-cmd", title: "Zzcard step", cardId: "c-zz", source: "field-manual" };
  const ZZCARD = { id: "c-zz", title: "Zzcard", stage: "initial-foothold", category: "Shells", os: "any", file: "02-Cards/S/Z.md" } as const;

  it("finds a host by IP and Enter opens it", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "10.10.10.66");
    const list = screen.getByRole("listbox", { name: "Results" });
    expect(await within(list).findByRole("group", { name: "This engagement" })).toBeInTheDocument();
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["web07host"]);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /web07/ })).toBeInTheDocument();
  });

  it("Arsenal groups come first, then This engagement with hosts before log entries", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    m.logList.mockResolvedValue([{
      id: "l1", engagementId: "e1", kind: "command", title: "Zzprobe ran", hostIds: ["h1"], at: 1, createdAt: 1, updatedAt: 1,
      content: { kind: "command", blocks: [{ command: "zzprobe", output: "", shell: "" }] },
    }] as never);
    setImported({ commands: [PROBE], cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zz");
    const list = screen.getByRole("listbox", { name: "Results" });
    await within(list).findByRole("group", { name: "This engagement" });
    const groups = within(list).getAllByRole("group");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.at(-1)).toHaveAccessibleName("This engagement");
    expect(within(groups.at(-1)!).getAllByRole("option").map((o) => o.textContent)).toEqual(["Zzprobe ranlog"]);
    expect(within(groups[0]!).getAllByRole("option").map((o) => o.textContent)).toEqual(["Zzprobe the targetzzprobe"]);
    await user.clear(screen.getByRole("combobox", { name: "Search" }));
    await user.type(screen.getByRole("combobox", { name: "Search" }), "10");
    const eng = within(await screen.findByRole("group", { name: "This engagement" })).getAllByRole("option");
    expect(eng.map((o) => o.textContent)).toEqual(["dc01host", "web07host"]);
  });

  it("→ on a raven command opens the drawer solo view", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    const d = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    expect(await d.findByText("Zzprobe the target")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "← Back" })).toBeInTheDocument();
    expect(d.queryByRole("listbox", { name: "Arsenal results" })).not.toBeInTheDocument();
  });

  it("→ on a Field Manual command opens its card at that block", async () => {
    const user = userEvent.setup();
    setImported({ commands: [CARD_CMD], cards: [ZZCARD] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzcard step");
    await user.keyboard("{ArrowRight}");
    expect(useArsenalStore.getState()).toMatchObject({ open: true, cardId: "c-zz", blockId: "zz-card-cmd", solo: null });
  });

  it("results listbox contains no headings", async () => {
    const user = userEvent.setup();
    setImported({ commands: [PROBE, CARD_CMD], cards: [ZZCARD] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zz");
    const list = screen.getByRole("listbox", { name: "Results" });
    expect(list.querySelector("h1,h2,h3,h4,h5,h6,ul,li")).toBeNull();
    expect(within(list).queryAllByRole("heading")).toHaveLength(0);
    for (const g of within(list).getAllByRole("group")) expect(g).toHaveAccessibleName();
    expect(within(list).getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("the footer says → in card and lists ⌥C credential behind ?", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const dlg = within(await screen.findByRole("dialog", { name: "Search" }));
    const line = dlg.getByRole("group", { name: "Search shortcuts" });
    expect(within(line).getByText("in card")).toBeInTheDocument();
    expect(within(line).getByText("host")).toBeInTheDocument();
    expect(within(line).getByText("credential")).toBeInTheDocument();
    // Five show; the rest are one click away behind the "?" key.
    expect(within(line).queryByText("edit a value")).not.toBeInTheDocument();
    await user.click(within(line).getByRole("button", { name: "All shortcuts" }));
    expect(await screen.findByText("edit a value")).toBeInTheDocument();
  });

  it("palette footer is a HintLine", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const dlg = within(await screen.findByRole("dialog", { name: "Search" }));
    const line = dlg.getByRole("group", { name: "Search shortcuts" });
    expect(line).toHaveAttribute("data-hint-line");
    expect(line.closest("[data-hint-surface]")).not.toBeNull();
    expect(line.querySelectorAll("[data-hint]").length).toBeLessThanOrEqual(5);
  });

  it("the host and credential chips sit on their own row under the search field", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const bar = within(await screen.findByRole("search", { name: "Search" }));
    expect(bar.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    expect(hostChip(screen)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Fill with credential/ })).toBeInTheDocument();
  });

  it("Esc with the host chip list open closes only the list; the palette stays open", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await screen.findByRole("combobox", { name: "Search" });
    await user.keyboard("{Alt>}h{/Alt}");
    expect(await screen.findByRole("listbox", { name: "Fill for host" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Fill for host" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("changing host flashes the preview", async () => {
    const user = userEvent.setup();
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    const pre = await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent!.startsWith("zz"));
    expect(pre).not.toHaveAttribute("data-flash");
    await user.keyboard("{Alt>}h{/Alt}");
    await user.click(screen.getByRole("option", { name: /web07/ }));
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzprobe 10.10.10.66 from 10.10.14.9")).toHaveAttribute("data-flash");
  });

  describe("suggestion list placement", () => {
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    afterEach(() => vi.restoreAllMocks());

    /** Lays the dialog body out at 0-400, its hint line at 360-380 and the USER field at `field`; the list is 150 tall. */
    async function open(field: [number, number]) {
      const user = userEvent.setup();
      m.credentialsList.mockResolvedValue([{
        id: "c1", engagementId: "e1", type: "password", username: "alice", domain: "CORP", secret: "Winter2024!", hashType: null, scope: "domain", localHostId: null,
        sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: 1, updatedAt: 1,
      }]);
      setImported({ commands: [{ ...PROBE, id: "zz-user", title: "Zzuser login", template: "zzuser {USER}@{TARGET_IP}" }], cards: [] });
      mount("/e/e1/h/h1");
      await screen.findByRole("tab", { name: "Next" });
      await user.keyboard(cmdK);
      await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzuser");
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        if (this.hasAttribute("data-popup-bounds")) return rect(0, 400);
        if (this.hasAttribute("data-hint-line")) return rect(360, 380);
        // The field is the span around the input.
        if (this.tagName === "SPAN" && this.querySelector(":scope > input[aria-label='Value for USER']")) return rect(...field);
        return rect(0, 0);
      });
      await user.keyboard("{Tab}");
      await user.type(screen.getByRole("combobox", { name: "Value for USER" }), "a");
      return screen.findByRole("listbox", { name: "Suggestions for USER" });
    }

    it("flips above the field when the room below, down to the hint line, is too small", async () => {
      const list = await open([300, 330]);
      expect(list).toHaveAttribute("data-placement", "above");
      expect(list.style.maxHeight).toBe("224px");
    });

    it("stays below when the list fits above the hint line", async () => {
      const list = await open([100, 130]);
      expect(list).toHaveAttribute("data-placement", "below");
    });

    it("never grows past the room on the side it takes", async () => {
      const list = await open([200, 230]);
      // Below: 360 - 230 - 4 = 126 is short of 150; above: 200 - 4 = 196 holds it.
      expect(list).toHaveAttribute("data-placement", "above");
      expect(list.style.maxHeight).toBe("196px");
    });
  });
});

describe("⌘K cap and copy-guard arm", () => {
  const many = (n: number): LibraryCommand[] =>
    Array.from({ length: n }, (_, i) => ({ ...PROBE, id: `zz-many-${i}`, title: `Zzmany ${String(i).padStart(2, "0")}`, template: `zzmany${i} {TARGET_IP}` }));

  it("past the cap the last row says how many more there are, and Enter on it opens them in the Arsenal", async () => {
    const user = userEvent.setup();
    setImported({ commands: many(40), cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzmany");
    const options = within(screen.getByRole("listbox", { name: "Results" })).getAllByRole("option");
    expect(options).toHaveLength(31);
    expect(options[30]).toHaveTextContent("10 more, open in the Arsenal");
    await user.keyboard("{ArrowDown}".repeat(30));
    expect(options[30]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Search the Arsenal" })).toHaveValue("zzmany");
  });

  it("no extra row while everything fits", async () => {
    const user = userEvent.setup();
    setImported({ commands: many(30), cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzmany");
    expect(within(screen.getByRole("listbox", { name: "Results" })).getAllByRole("option")).toHaveLength(30);
  });

  it("a held-back copy does not stay armed after moving to another row and back", async () => {
    const user = userEvent.setup();
    const two = [
      { ...PROBE, id: "zz-ga", title: "Zzguard alpha", template: "zzga {FILE}" },
      { ...PROBE, id: "zz-gb", title: "Zzguard beta", template: "zzgb {FILE}" },
    ];
    setImported({ commands: two, cards: [] });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "zzguard");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/not filled. Press ↵ again to copy anyway/)).toBeInTheDocument();
    box.focus();
    await user.keyboard("{ArrowDown}{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/not filled. Press ↵ again to copy anyway/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
  });
});

describe("⌘K Lookup group", () => {
  // Synthetic fixtures only: the audit's invented lookup note.
  const LOOKUP: ManualNote = AUDIT_NOTE_SOURCES.flatMap(([p, t]) => (p.includes("Zz-Error-Lookup") ? [parseNote(p, t)!] : []))[0]!;
  const snapshot = (notes: ManualNote[]): FieldManualSnapshot => ({
    importedAt: 1, cards: [], overlay: {}, added: [], playbook: [], toolkit: [], report: {} as FieldManualSnapshot["report"], notes,
  });
  function Where() {
    const l = useLocation();
    return <p data-testid="where">{l.pathname + l.search + l.hash}</p>;
  }
  const mountAt = (path: string) =>
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <App />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const open = async (query: string) => {
    const user = userEvent.setup();
    mountAt("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), query);
    return user;
  };
  const lookupGroup = (key: string) => within(screen.getByRole("listbox", { name: "Results" })).findByRole("group", { name: new RegExp(`^${key}`) });

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element["scrollIntoView"];
    m.fieldManualLoad.mockResolvedValue(snapshot([LOOKUP]));
    m.fieldManualLatestMtime.mockResolvedValue(null);
    m.payloadBuildsList.mockResolvedValue([]);
    useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null });
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it("a key shows its group first: the lead names the key and means, then one option per command", async () => {
    await open("STATUS_ZZ_EXPIRED");
    const g = await lookupGroup("STATUS_ZZ_EXPIRED");
    expect(g).toHaveAccessibleName("STATUS_ZZ_EXPIRED The secret is right and has expired.");
    expect(within(g).getByText("STATUS_ZZ_EXPIRED")).toBeInTheDocument();
    expect(within(g).getByText("The secret is right and has expired.")).toBeInTheDocument();
    expect(within(g).getAllByRole("option").map((o) => o.textContent)).toEqual(["nxc smb {TARGET_IP} --pass-pol" + "nxc"]);
    // The lead is not an option, and the Lookup group comes before the rest (the Manual group still lists the note).
    const groups = within(screen.getByRole("listbox", { name: "Results" })).getAllByRole("group");
    expect(groups[0]).toBe(g);
    expect(groups.at(-1)).toHaveAccessibleName("Manual");
  });

  it("a row with four commands lists four options", async () => {
    await open("STATUS_ZZ_RELAY");
    const g = await lookupGroup("STATUS_ZZ_RELAY");
    expect(within(g).getAllByRole("option")).toHaveLength(4);
  });

  it("↵ on the first copies the filled command", async () => {
    const user = await open("STATUS_ZZ_EXPIRED");
    await lookupGroup("STATUS_ZZ_EXPIRED");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("nxc smb 10.10.10.5 --pass-pol");
  });

  it("⌘↵ logs under the table's name and the key", async () => {
    const user = await open("STATUS_ZZ_EXPIRED");
    await lookupGroup("STATUS_ZZ_EXPIRED");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({
      title: "Zz login errors: STATUS_ZZ_EXPIRED",
      content: { kind: "command", blocks: [{ command: "nxc smb 10.10.10.5 --pass-pol" }] },
    });
  });

  it("→ on a lookup command opens the note at its row", async () => {
    const user = await open("STATUS_ZZ_EXPIRED");
    await lookupGroup("STATUS_ZZ_EXPIRED");
    const line = within(screen.getByRole("dialog", { name: "Search" })).getByRole("group", { name: "Search shortcuts" });
    expect(within(line).getByText("open in Manual")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe(`/manual/${AUDIT_NOTE_IDS.lookup}?q=STATUS_ZZ_EXPIRED&row=2#table-1`));
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    expect(useArsenalStore.getState().open).toBe(false);
  });

  /** The Manual's answer card, once the landing has shown it. */
  const answer = () => screen.findByRole("region", { name: "Answer" });
  const answerRows = (c: HTMLElement) => within(c).queryAllByRole("group", { name: /^Answer command: / });

  it("→ on the second matching row's command lands on that row, not the first match after the caption", async () => {
    // "secret" is in STATUS_ZZ_LOGON's and STATUS_ZZ_EXPIRED's means: two groups, LOGON first.
    const user = await open("secret");
    await lookupGroup("STATUS_ZZ_EXPIRED");
    const groups = within(screen.getByRole("listbox", { name: "Results" })).getAllByRole("group");
    expect(groups[0]).toHaveAccessibleName(/^STATUS_ZZ_LOGON/);
    expect(groups[1]).toHaveAccessibleName(/^STATUS_ZZ_EXPIRED/);
    await user.keyboard("{ArrowDown}");
    expect(within(groups[1]!).getByRole("option")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe(`/manual/${AUDIT_NOTE_IDS.lookup}?q=secret&row=2#table-1`));
    const c = await answer();
    expect(within(c).getByText("STATUS_ZZ_EXPIRED")).toBeInTheDocument();
    await vi.waitFor(() => expect(answerRows(c)[0]).toHaveFocus());
    expect(answerRows(c)[0]).toHaveAccessibleName("Answer command: nxc smb 10.10.10.5 --pass-pol");
    // The lit row is the chosen one.
    expect(document.querySelector("[data-table='table-1'] tr[data-current-row]")).toHaveAttribute("data-row", "2");
  });

  it("→ lands on the chosen row when the query's first match after the anchor is in the caption", async () => {
    // "zz" is in the caption ("Zz login errors") before any row: the row, not the caption, is where → lands.
    const user = await open("zz");
    await lookupGroup("STATUS_ZZ_LOGON");
    await user.keyboard("{ArrowDown}{ArrowRight}");
    await vi.waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe(`/manual/${AUDIT_NOTE_IDS.lookup}?q=zz&row=1#table-1`));
    const c = await answer();
    expect(within(c).getByText("STATUS_ZZ_LOGON")).toBeInTheDocument();
    await vi.waitFor(() => expect(answerRows(c)[0]).toHaveFocus());
  });

  it("more than two matching rows: the Lookup group lists two (key matches in note order)", async () => {
    // Every row's key holds "ZZ_": seven rows with commands match.
    await open("ZZ_");
    await lookupGroup("STATUS_ZZ_DENIED");
    const keys = within(screen.getByRole("listbox", { name: "Results" })).getAllByRole("group")
      .flatMap((g) => within(g).queryAllByText(/^STATUS_ZZ_[A-Z]+$/).map((el) => el.textContent));
    expect(keys).toEqual(["STATUS_ZZ_DENIED", "STATUS_ZZ_LOGON"]);
  });

  it("exam rules hide a banned lookup command; pending rules offer only commands that need no verdict", () => {
    const BANNED = parseNote("04-Foundations/Zz-Banned.md", [
      "# Zz Banned",
      "**Table 1 — Zz web errors**",
      "| Error | Means | Do this |",
      "| - | - | - |",
      "| `ZZ_SQLERR` | The query broke. | `sqlmap -u {URL}` or `zzcurl {URL}` |",
    ].join("\n"))!;
    const base = { library: [], cards: [], generators: [], notes: [BANNED] };
    const titles = (r: ReturnType<typeof searchPalette>) => r.lookups.flatMap((g) => g.results.map((x) => x.title));
    expect(titles(searchPalette("ZZ_SQLERR", base))).toEqual(["sqlmap -u {URL}", "zzcurl {URL}"]);
    expect(titles(searchPalette("ZZ_SQLERR", { ...base, exam: examScope({ kind: "exam-sim", msfHostId: null }, "h1") }))).toEqual(["zzcurl {URL}"]);
    expect(titles(searchPalette("ZZ_SQLERR", { ...base, exam: examScope(undefined, "h1") }))).toEqual(["zzcurl {URL}"]);
    // The row's commands carry the Manual's one id scheme, the ids the answer card gives them.
    expect(searchPalette("ZZ_SQLERR", base).lookups[0]!.results.map((x) => x.id)).toEqual([
      `manual:${BANNED.id}:lookup:table-1:0:0`, `manual:${BANNED.id}:lookup:table-1:0:1`,
    ]);
  });

  it("in an exam sim, rows left with no command do not crowd out a later allowed row (RAV-20)", () => {
    const BANNED = parseNote("04-Foundations/Zz-Banned.md", [
      "# Zz Banned",
      "**Table 1 — Zz web errors**",
      "| Error | Means | Do this |",
      "| - | - | - |",
      "| `ZZ_WEB_ONE` | The query broke. | `sqlmap -u {URL}` |",
      "| `ZZ_WEB_TWO` | The query broke again. | `sqlmap -r {FILE}` |",
      "| `ZZ_WEB_THREE` | Still broken. | `zzcurl {URL}` |",
    ].join("\n"))!;
    const base = { library: [], cards: [], generators: [], notes: [BANNED] };
    const keys = (r: ReturnType<typeof searchPalette>) => r.lookups.map((g) => g.code);
    expect(keys(searchPalette("ZZ_WEB", base))).toEqual(["ZZ_WEB_ONE", "ZZ_WEB_TWO"]);
    expect(keys(searchPalette("ZZ_WEB", { ...base, exam: examScope({ kind: "exam-sim", msfHostId: null }, "h1") }))).toEqual(["ZZ_WEB_THREE"]);
  });
});
