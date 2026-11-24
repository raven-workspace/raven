import { readFileSync } from "node:fs";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { setImported, type CardMeta } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useNotesStore } from "../features/notes/useNotesStore";
import { usePaletteStore } from "../features/palette/usePaletteStore";
import { useLastEngagementStore } from "../features/arsenal/useFillScope";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
vi.mock("../features/palette/generators", () => ({ GENERATORS: [{ id: "shell", title: "Zzgen reverse shell", category: "Shells-and-Transfers" }] }));
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
const EXAM: Engagement = { ...E1, kind: "exam-sim" };
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};

const GOAL = "h-enum-full-tcp";
const cmd = (id: string, over: Partial<LibraryCommand>): LibraryCommand => ({
  id, title: id, tool: "zz", template: "zz", os: "any", runFrom: "attacker", goals: [], source: "field-manual", cardId: "zz-card", ...over,
});
const PROBE = cmd("zz-probe", { title: "Zzprobe the target", template: "zzprobe {TARGET_IP} from {LHOST}", goals: [GOAL], why: "Because probing." });
const FETCH = cmd("zz-fetch", { title: "Zzfetch the file", template: "zzfetch http://{LHOST}/{FILE}", runFrom: "target", os: "windows" });
const FETCH2 = cmd("zz-fetch2", { title: "Zzfetch again", template: "zzcopy {FILE} {DEST_DIR}" });
const BANNED = cmd("zz-banned", { title: "Zzbanned relay", template: "zzrelay {TARGET_IP}", exam: "banned" });
const RAVEN = cmd("zz-raven", { title: "Zzraven helper", template: "zzhelper {TARGET_IP}", goals: [GOAL], source: "raven", cardId: undefined });
const CARD: CardMeta = { id: "zz-card", title: "Zz Card", stage: "initial-foothold", category: "Zz-Cat", os: "any", file: "02-Cards/Zz/Zz-Card.md" };
const CARD2: CardMeta = { id: "zz-card2", title: "Zz Other", stage: "reporting", category: "Zz-Other-Cat", os: "any", file: "02-Cards/Zz/Zz-Other.md" };
const OTHER = cmd("zz-other", { title: "Zzother cmd", cardId: "zz-card2" });

const nav: { go: (path: string) => void } = { go: () => {} };
function Nav() {
  const navigate = useNavigate();
  useEffect(() => {
    nav.go = (p) => void navigate(p);
  }, [navigate]);
  return null;
}

function mount(path: string, engagement = E1) {
  m.engagementGet.mockResolvedValue(engagement);
  m.engagementsList.mockResolvedValue([engagement]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
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
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  useNotesStore.setState({ open: false });
  setImported({ commands: [PROBE, FETCH, FETCH2, BANNED, RAVEN, OTHER], cards: [CARD, CARD2] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
  });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
});
afterEach(() => setImported({ commands: [], cards: [] }));

/** A command block by its exact text (unresolved tokens are marked, so the text is split across elements). */
const block = (root: { findByText: typeof screen.findByText }, text: string) =>
  root.findByText((_, el) => el?.tagName === "PRE" && el.textContent === text);

const drawer = () => screen.findByRole("complementary", { name: "Arsenal" });

/** What the host scope shows (its visible text, without the hidden native select's options). */
const scopeText = (chip: HTMLElement): string => [...chip.children].map((n) => n.textContent).join(" ").trim();
const hostChip = (scope: { getByRole: typeof screen.getByRole }) => scope.getByRole("button", { name: /^Fill for host/ });

describe("Arsenal", () => {
  it("hosts that fail to load: the drawer's picker says so, and Retry brings the picker back (RAV-22)", async () => {
    const user = userEvent.setup();
    m.hostsList.mockRejectedValue(new Error("vault busy"));
    mount("/e/e1");
    await screen.findByRole("navigation", { name: "Engagement" });
    await user.keyboard("a");
    const d = within(await drawer());
    expect(await d.findByText("Couldn't load hosts")).toBeInTheDocument();
    m.hostsList.mockResolvedValue([H1]);
    await user.click(d.getByRole("button", { name: "Retry" }));
    expect(await d.findByRole("button", { name: /^Fill for host/ })).toBeInTheDocument();
    expect(d.queryByText("Couldn't load hosts")).toBeNull();
  });

  it("A opens the drawer filled for the host in view and Esc closes it", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    expect(hostChip(d)).toHaveAccessibleName("Fill for host dc01");
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    await d.findByRole("option", { name: /Zzprobe the target/ });
    await user.keyboard("{ArrowRight}");
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(await block(d, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(d.getByText("Because probing.")).toBeInTheDocument();
    // Esc backs out of the card first, then closes.
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("Esc from the full-screen Arsenal goes back to the page it was opened from, not home", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await user.click(d.getByRole("button", { name: "Full screen" }));
    await screen.findByRole("textbox", { name: "Search the Arsenal" });
    expect(screen.queryByRole("tab", { name: "Next" })).not.toBeInTheDocument();
    await user.click(document.body);
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("tab", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Host" })).toBeInTheDocument();
  });

  it("A does nothing while typing", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await user.click(await screen.findByRole("button", { name: "Full checklist" }));
    const notes = await screen.findByRole("textbox", { name: "Notes: Scan all 65,535 TCP ports" });
    await user.click(notes);
    await user.keyboard("a");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
    expect(notes).toHaveValue("a");
  });

  it("opening the drawer closes Notes and Stuck", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useNotesStore.setState({ open: true }));
    act(() => useArsenalStore.getState().openCard());
    await drawer();
    expect(useNotesStore.getState().open).toBe(false);
    // Stuck replaces the drawer, and the drawer replaces Stuck.
    await user.click(screen.getByRole("button", { name: /Stuck\?/ }));
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
    expect(await screen.findByRole("complementary", { name: /stuck/i })).toBeInTheDocument();
    act(() => useArsenalStore.getState().openCard());
    await drawer();
    expect(screen.queryByRole("complementary", { name: /stuck/i })).not.toBeInTheDocument();
    // Notes replace the drawer.
    act(() => useNotesStore.setState({ open: true }));
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it('a step\'s "From card" link opens the drawer on that card', async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await user.click(await screen.findByRole("button", { name: "Full checklist" }));
    await user.click(await screen.findByRole("button", { name: "From card Zz Card" }));
    const d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(d.getByText("Zz Cat")).toBeInTheDocument();
    expect(d.getByText("any")).toBeInTheDocument();
  });

  it("a FILE chip edit refills every command on the card", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    expect(await block(d, "zzfetch http://10.10.14.9/{FILE}")).toBeInTheDocument();
    await user.type(d.getByRole("combobox", { name: "Value for FILE" }), "a.exe");
    expect(await block(d, "zzfetch http://10.10.14.9/a.exe")).toBeInTheDocument();
    expect(await block(d, "zzcopy a.exe C:\\Windows\\Temp")).toBeInTheDocument();
    // The chips edit LHOST too.
    await user.type(d.getByRole("combobox", { name: "Value for LHOST" }), "10.9.9.9");
    expect(await block(d, "zzprobe 10.10.10.5 from 10.9.9.9")).toBeInTheDocument();
  });

  it("Also in Raven lists raven-source commands for the card's goals", async () => {
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const toggle = await screen.findByRole("button", { name: /^Also in Raven/ });
    await userEvent.setup().click(toggle);
    const also = within(toggle.parentElement!);
    expect(await block(also, "zzhelper 10.10.10.5")).toBeInTheDocument();
    expect(also.queryByText(/zzprobe/)).not.toBeInTheDocument();
  });

  it("browse picks a category, opens its card, and fills for a host picked here", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    const cats = within(await screen.findByRole("navigation", { name: "Categories" }));
    await user.click(await cats.findByRole("tab", { name: /^Zz Cat/ }));
    const list = within(screen.getByRole("listbox", { name: "Arsenal results" }));
    expect(list.getAllByRole("option")).toHaveLength(1);
    expect(list.queryByRole("option", { name: /Zz Other/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    // No host until one is picked.
    expect(await block(screen, "zzprobe {TARGET_IP} from 10.10.14.9")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Fill for host/ }));
    await user.click(screen.getByRole("option", { name: /dc01/ }));
    expect(await block(screen, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
  });

  it("banned commands are hidden in exam-sim", async () => {
    mount("/e/e1/h/h1", EXAM);
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    expect(await block(d, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(d.queryByText(/zzrelay/)).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzbanned");
    expect(d.queryByRole("option", { name: /Zzbanned/ })).not.toBeInTheDocument();
  });

  it("exam filtering fails closed: no commands until the engagement kind is known", async () => {
    let release!: (e: Engagement) => void;
    const user = userEvent.setup();
    mount("/e/e1/h/h1", EXAM);
    m.engagementGet.mockImplementation(() => new Promise<Engagement>((r) => (release = r)));
    // Drawer.
    await user.keyboard("a");
    const d = within(await drawer());
    const search = d.getByRole("textbox", { name: "Search the Arsenal" });
    await user.type(search, "zz");
    expect(d.queryAllByRole("option")).toHaveLength(0);
    await user.keyboard("{Escape}");
    // Palette.
    await user.keyboard("{Meta>}k{/Meta}");
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "zzbanned");
    expect(screen.queryByRole("option", { name: /Zzbanned/ })).not.toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "zzprobe");
    expect(screen.queryByRole("option", { name: /Zzprobe/ })).not.toBeInTheDocument();
    // Once the kind is known, allowed commands appear and banned ones stay hidden.
    await act(async () => release(EXAM));
    expect(await screen.findByRole("option", { name: /Zzprobe the target/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "zzbanned");
    expect(screen.queryByRole("option", { name: /Zzbanned/ })).not.toBeInTheDocument();
  });

  it("browse shows no commands until the engagement kind is known", async () => {
    let release!: (e: Engagement) => void;
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    useArsenalStore.setState({ cardId: "zz-card" });
    mount("/arsenal", EXAM);
    m.engagementGet.mockImplementation(() => new Promise<Engagement>((r) => (release = r)));
    await screen.findByRole("button", { name: "Fill for host dc01" });
    // Not even categories or cards until the exam rules are known.
    expect(screen.queryByRole("heading", { name: "Zz Card" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Categories" })).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/zzrelay/)).not.toBeInTheDocument();
    expect(screen.queryByText(/zzprobe/)).not.toBeInTheDocument();
    await act(async () => release(EXAM));
    expect(await screen.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(await block(screen, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(screen.queryByText(/zzrelay/)).not.toBeInTheDocument();
  });

  it("on the dashboard host tokens stay unfilled", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Lab A");
    await user.click(screen.getByRole("button", { name: "Arsenal" }));
    const d = within(await drawer());
    expect(d.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    expect(within(d.getByRole("search", { name: "Search the Arsenal" })).getByText("for no host")).toBeInTheDocument();
    act(() => useArsenalStore.getState().openCard("zz-card"));
    expect(await block(d, "zzprobe {TARGET_IP} from 10.10.14.9")).toBeInTheDocument();
  });

  it("the header gives search, host chip, credential chip and full screen their own tracks", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    const barEl = d.getByRole("search", { name: "Search the Arsenal" });
    const bar = within(barEl);
    expect(bar.getByRole("textbox", { name: "Search the Arsenal" })).toBeInTheDocument();
    // A leading search icon, decorative (hidden from assistive tech).
    expect(barEl.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    // Focusing the text field rings the whole bar in the accent, like every other input.
    expect(barEl).toHaveClass("search-bar");
    expect(readFileSync("src/features/arsenal/SearchBar/SearchBar.scss", "utf8")).toMatch(/&:has\(input:focus-visible\) \{\s*outline: 1px solid var\(--accent\);/);
    expect(bar.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    expect(scopeText(hostChip(d))).toBe("Host dc01");
    const header = d.getByRole("banner");
    for (const el of [bar.getByRole("textbox"), hostChip(d), d.getByRole("button", { name: /^Fill with credential/ }), d.getByRole("button", { name: "Full screen" })]) {
      expect(header.contains(el)).toBe(true);
    }
  });

  it("search is keyboard-first: arrows pick, Enter opens the selected card", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    let d = within(await drawer());
    const box = d.getByRole("textbox", { name: "Search the Arsenal" });
    await user.type(box, "other cat");
    const card = await d.findByRole("option", { name: /^Zz Other/ });
    expect(card).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", card.id);
    await user.keyboard("{ArrowDown}");
    expect(d.getByRole("option", { name: /Zzother cmd/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(await d.findByRole("heading", { name: "Zz Other" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zz card");
    await user.keyboard("{Enter}");
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("with no host, the drawer's ⌘↵ hint reads copy and log, no host (RAV-32)", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Lab A");
    await user.keyboard("a");
    await drawer();
    const hints = within(screen.getByLabelText("Arsenal shortcuts"));
    expect(hints.getByText("copy and log, no host")).toBeInTheDocument();
    expect(hints.queryByText("log (no host)")).toBeNull();
  });

  it("A opens a hostless drawer on the dashboard and is ignored while typing", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Lab A");
    await user.keyboard("a");
    const d = within(await drawer());
    expect(d.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "a");
    expect(screen.getByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
    expect(d.getByRole("textbox", { name: "Search the Arsenal" })).toHaveValue("a");
  });

  it("A on the browse screen focuses the search instead of opening a drawer", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    await screen.findByRole("navigation", { name: "Categories" });
    await user.keyboard("a");
    expect(screen.getByRole("textbox", { name: "Search the Arsenal" })).toHaveFocus();
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
    expect(useArsenalStore.getState().open).toBe(false);
  });

  it("a chip override never fills another host", async () => {
    const user = userEvent.setup();
    const H2: Host = { ...H1, id: "h2", name: "web07", ip: "10.10.10.6" };
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    await user.type(await d.findByRole("combobox", { name: "Value for TARGET_IP" }), "1.1.1.1");
    expect(await block(d, "zzprobe 1.1.1.1 from 10.10.14.9")).toBeInTheDocument();
    act(() => nav.go("/e/e1/h/h2"));
    expect(await block(d, "zzprobe 10.10.10.6 from 10.10.14.9")).toBeInTheDocument();
  });

  it("→ in the palette opens the card in the drawer", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{ArrowRight}");
    const d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
  });
});

describe("Arsenal after a Field Manual import (B2)", () => {
  const STAGES = [
    ["information-gathering", "Information gathering"],
    ["vulnerability-detection", "Vulnerability detection"],
    ["initial-foothold", "Initial foothold"],
    ["privilege-escalation", "Privilege escalation"],
    ["post-exploitation", "Post-exploitation"],
    ["reporting", "Reporting"],
    ["lateral-movement", "Lateral movement"],
  ] as const;
  // One card per stage, filed under a folder that never names the stage, plus enough filler to pass a page of results.
  const perStage: CardMeta[] = STAGES.map(([id], i) => ({
    id: `st-${id}`, title: `Qq stage card ${i}`, stage: id, category: "Qq-Misc", os: "any", file: `02-Cards/Qq-Misc/Qq-${i}.md`,
  }));
  const filler: CardMeta[] = Array.from({ length: 45 }, (_, i) => ({
    id: `fill-${i}`, title: `Filler ${i}`, stage: "initial-foothold", category: "Aa-Filler", os: "any", file: `02-Cards/Aa/F-${i}.md`,
  }));
  const cmds = [...perStage, ...filler].map((c) => cmd(`${c.id}-cmd`, { title: `${c.title} cmd`, cardId: c.id }));

  beforeEach(() => setImported({ commands: cmds, cards: [...filler, ...perStage] }));

  it("every imported card is listed in the drawer", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard());
    const d = within(await drawer());
    // With no query: the categories, then Enter lists everything in one, uncapped.
    await user.click(await d.findByRole("option", { name: /^Qq Misc/ }));
    for (const c of perStage) expect(await d.findByRole("option", { name: new RegExp(`^${c.title}(?! cmd)`) })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(await d.findByRole("option", { name: /^Aa Filler/ }));
    expect(await d.findAllByRole("option")).toHaveLength(filler.length * 2);
  });

  it.each(STAGES)("searching the drawer for stage %s finds its card", async (id, title) => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard());
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), title);
    const card = perStage.find((c) => c.stage === id)!;
    expect(await d.findByRole("option", { name: new RegExp(card.title) })).toBeInTheDocument();
  });

  it("browse lists every imported card under its category", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    const cats = within(await screen.findByRole("navigation", { name: "Categories" }));
    await user.click(await cats.findByRole("tab", { name: /^Qq Misc/ }));
    for (const c of perStage) expect(within(screen.getByRole("listbox", { name: "Arsenal results" })).getByRole("option", { name: new RegExp(`^${c.title}`) })).toBeInTheDocument();
  });
});

describe("full-screen Arsenal uses the engagement you came from (B4)", () => {
  const E2: Engagement = { ...E1, id: "e2", name: "Client Beta", lastActivityAt: 1 };
  const NEWER: Engagement = { ...E1, id: "e1", name: "Lab A", lastActivityAt: 99 };
  const H9: Host = { ...H1, id: "h9", engagementId: "e2", name: "web09", ip: "10.20.0.9" };
  const NOTE = {
    id: "l9", engagementId: "e2", kind: "note" as const, title: "Qqnote about the portal", titleEdited: false, ranOn: null, hostIds: [],
    observations: null, returnedNothing: false, private: false, content: { kind: "note" as const, text: "creds in config" }, at: 1, createdAt: 1, updatedAt: 1,
  };

  beforeEach(() => {
    m.engagementGet.mockImplementation(async (id: string) => (id === "e2" ? E2 : NEWER));
    m.engagementsList.mockResolvedValue([NEWER, E2]);
    m.hostsList.mockImplementation(async (id: string) => (id === "e2" ? [H9] : [H1]));
    m.logList.mockImplementation(async (id: string) => (id === "e2" ? [NOTE] : []));
  });

  function mountAt(path: string) {
    return render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Nav />
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("⌘K on /arsenal searches and fills for the engagement and host you left", async () => {
    const user = userEvent.setup();
    mountAt("/e/e2/h/h9");
    await screen.findByRole("tab", { name: "Next" });
    act(() => nav.go("/arsenal"));
    await screen.findByRole("navigation", { name: "Categories" });
    await user.keyboard("{Meta>}k{/Meta}");
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(await within(screen.getByRole("dialog")).findByText(/Client Beta/)).toBeInTheDocument();
    await user.type(box, "qqnote");
    expect(await screen.findByRole("option", { name: /Qqnote about the portal/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "zzprobe");
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzprobe 10.20.0.9 from 10.10.14.9")).toBeInTheDocument();
  });

  it("a remembered engagement that no longer exists falls back to the most recently active one", async () => {
    useLastEngagementStore.setState({ engagementId: "gone", hostId: "hx" });
    mountAt("/arsenal");
    await userEvent.setup().click(await screen.findByRole("button", { name: /^Fill for host/ }));
    expect(await screen.findByRole("option", { name: /dc01/ })).toBeInTheDocument();
    expect(screen.getByText("Lab A")).toBeInTheDocument();
    expect(m.engagementGet).not.toHaveBeenCalledWith("gone");
  });

  it("locking forgets the remembered engagement", async () => {
    const user = userEvent.setup();
    mountAt("/e/e2/h/h9");
    await screen.findByRole("tab", { name: "Next" });
    expect(useLastEngagementStore.getState().engagementId).toBe("e2");
    m.vaultLock.mockResolvedValue(null);
    await user.keyboard("{Meta>}l{/Meta}");
    expect(useLastEngagementStore.getState()).toMatchObject({ engagementId: null, hostId: null });
  });

  it("browse fills for the engagement you came from", async () => {
    mountAt("/e/e2/h/h9");
    await screen.findByRole("tab", { name: "Next" });
    act(() => nav.go("/arsenal"));
    await userEvent.setup().click(await screen.findByRole("button", { name: /^Fill for host/ }));
    expect(await screen.findByRole("option", { name: /web09/ })).toBeInTheDocument();
  });
});

describe("backing out of a card in the drawer (B5)", () => {
  it("← Back returns from a card to the list", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "← Back" }));
    expect(d.queryByRole("heading", { name: "Zz Card" })).not.toBeInTheDocument();
    expect(d.getByRole("listbox", { name: "Arsenal results" })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: "← Back" })).not.toBeInTheDocument();
  });

  it("Esc on a card goes back to the list; Esc on the list closes the drawer", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(d.getByRole("listbox", { name: "Arsenal results" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });
});

describe("drawer list grouped by category (U1)", () => {
  it("cards sit under their category title, in a stable order, and arrows move across groups", async () => {
    const user = userEvent.setup();
    const qx = (id: string, title: string, category: string): CardMeta => ({ id, title, stage: "initial-foothold", category, os: "any", file: `02-Cards/Q/${id}.md` });
    const cards = [qx("q-b", "Qx beta", "Zz-Other-Cat"), qx("q-shell", "Qx shell", "Shells-and-Transfers"), qx("q-a", "Qx alpha", "Zz-Cat"), qx("q-a2", "Qx alpha two", "Zz-Cat")];
    setImported({ commands: cards.map((c) => cmd(`${c.id}-cmd`, { title: "Plain", cardId: c.id })), cards });
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard());
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "qx");
    const resultGroups = () => d.getAllByRole("group").filter((g) => g.hasAttribute("aria-labelledby"));
    expect(resultGroups().map((g) => g.getAttribute("aria-labelledby")).map((id) => document.getElementById(id!)?.textContent))
      .toEqual(["Shells & transfers", "Zz Cat", "Zz Other Cat"]);
    const zz = within(d.getByRole("group", { name: "Zz Cat" }));
    expect(zz.getAllByRole("option").map((o) => o.textContent)).toEqual(["Qx alphacard", "Qx alpha twocard"]);
    // ↓ crosses from one group into the next.
    expect(d.getByRole("option", { name: /Qx shell/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(d.getByRole("option", { name: /^Qx alpha(?! two)/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(d.getByRole("option", { name: /Qx beta/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(await d.findByRole("heading", { name: "Qx beta" })).toBeInTheDocument();
  });

  it("empty query lists categories with counts", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard());
    const d = within(await drawer());
    // Zz-Cat: the card and four commands on it; Zz-Other-Cat: its card and one command.
    const cat = await d.findByRole("option", { name: /^Zz Cat/ });
    expect(cat).toHaveTextContent(/Zz Cat\s*5$/);
    expect(d.getByRole("option", { name: /^Zz Other Cat/ })).toHaveTextContent(/Zz Other Cat\s*2$/);
    expect(d.queryByRole("option", { name: /^Zz Card/ })).not.toBeInTheDocument();
    // Enter lists that category's hits; Esc goes back to the categories (the drawer stays open).
    const box = d.getByRole("textbox", { name: "Search the Arsenal" });
    const arrowTo = async (el: HTMLElement) => {
      for (let i = 0; i < 40 && box.getAttribute("aria-activedescendant") !== el.id; i++) await user.keyboard("{ArrowDown}");
      expect(el).toHaveAttribute("aria-selected", "true");
    };
    await arrowTo(cat);
    await user.keyboard("{Enter}");
    expect(await d.findByRole("option", { name: /^Zz Card/ })).toBeInTheDocument();
    expect(d.queryByRole("option", { name: /^Zz Other/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(await d.findByRole("option", { name: /^Zz Other Cat/ })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
    // → does the same as Enter on a category.
    await arrowTo(d.getByRole("option", { name: /^Zz Other Cat/ }));
    await user.keyboard("{ArrowRight}");
    expect(await d.findByRole("option", { name: /^Zz Other/ })).toBeInTheDocument();
  });

  it("results are grouped by category with cards and commands together", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "other cat");
    const group = within(await d.findByRole("group", { name: "Zz Other Cat" }));
    expect(group.getAllByRole("option").map((o) => o.textContent)).toEqual(["Zz Othercard", "Zzother cmdzz"]);
    expect(d.getAllByRole("group").filter((g) => g.hasAttribute("aria-labelledby"))).toHaveLength(1);
  });

  it("listbox has no heading children", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zz");
    const box = await d.findByRole("listbox", { name: "Arsenal results" });
    expect(box.querySelectorAll("h3")).toHaveLength(0);
    expect(box.querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
  });

  it("Enter on a command copies the filled command and keeps the drawer open", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    // The selected command is previewed filled, under the list.
    expect(await block(d, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await d.findByRole("status")).toHaveTextContent("Copied for dc01");
    expect(await navigator.clipboard.readText()).toBe("zzprobe 10.10.10.5 from 10.10.14.9");
    expect(screen.getByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
    expect(d.getByRole("option", { name: /Zzprobe the target/ })).toBeInTheDocument();
    const hints = [...d.getByRole("group", { name: "Arsenal shortcuts" }).querySelectorAll("[data-hint]")].map((h) => h.textContent);
    expect(hints).toEqual(["↵copy", "⌘↵copy and log", "→in card", "⌥H⌥Chost, credential", "Escclose"]);
  });

  it("hovering another row keeps the clicked row selected and its fill fields reachable", async () => {
    const user = userEvent.setup();
    setImported({ commands: [PROBE, cmd("zz-plain", { title: "Zzprobe plain", template: "zzprobe --version", cardId: undefined, source: "raven" })], cards: [CARD] });
    mount("/");
    await screen.findByText("Lab A");
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    const target = await d.findByRole("option", { name: /Zzprobe the target/ });
    const other = d.getByRole("option", { name: /Zzprobe plain/ });
    await user.click(target);
    fireEvent.mouseMove(other);
    expect(target).toHaveAttribute("aria-selected", "true");
    expect(other).toHaveAttribute("aria-selected", "false");
    const field = d.getByRole("combobox", { name: "Value for TARGET_IP" });
    await user.click(field);
    await user.type(field, "198.51.100.7");
    fireEvent.mouseMove(other);
    expect(d.getByRole("combobox", { name: "Value for TARGET_IP" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toContain("198.51.100.7");
  });

  it("an unfilled field holds the copy back once, then Enter copies anyway", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzfetch the");
    await navigator.clipboard.writeText("untouched");
    await d.findByRole("option", { name: /Zzfetch the file/ });
    await user.keyboard("{Enter}");
    expect(await d.findByText("{FILE} not filled. Press ↵ again to copy anyway")).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: "Value for FILE" })).toHaveFocus();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await d.findByText("Copied for dc01. 1 placeholder left")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("zzfetch http://10.10.14.9/{FILE}");
  });

  it("a held-back copy does not stay armed after moving to another row and back", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    const search = d.getByRole("textbox", { name: "Search the Arsenal" });
    await user.type(search, "zzfetch");
    await navigator.clipboard.writeText("untouched");
    await d.findByRole("option", { name: /Zzfetch the file/ });
    await user.keyboard("{Enter}");
    expect(await d.findByText(/not filled. Press ↵ again to copy anyway/)).toBeInTheDocument();
    search.focus();
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(await d.findByText(/not filled. Press ↵ again to copy anyway/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
  });

  it("the card view's hint line lists the credential key too", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    await d.findByRole("option", { name: /Zzprobe the target/ });
    await user.keyboard("{ArrowRight}");
    await d.findByRole("heading", { name: "Zz Card" });
    const keys = within(d.getByRole("group", { name: "Arsenal shortcuts" }));
    expect(keys.getByText("back")).toBeInTheDocument();
    expect(keys.getByText("host, credential")).toBeInTheDocument();
  });

  it("arsenal drawer footer is a HintLine with at most 5 hints", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const aside = await drawer();
    expect(aside).toHaveAttribute("data-hint-surface");
    await within(aside).findByRole("listbox", { name: "Arsenal results" });
    const line = within(aside).getByRole("group", { name: "Arsenal shortcuts" });
    expect(line).toHaveAttribute("data-hint-line");
    const shown = line.querySelectorAll("[data-hint]").length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(5);
    expect(within(line).getByRole("button", { name: "All shortcuts" })).toBeInTheDocument();
  });

  it("drawer hints: ⌥H and ⌥C are one hint (shown or dropped together) and drop before →", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const aside = await drawer();
    await within(aside).findByRole("listbox", { name: "Arsenal results" });
    const units = [...within(aside).getByRole("group", { name: "Arsenal shortcuts" }).querySelectorAll("[data-hint]")];
    const pickers = units.filter((u) => /⌥/.test(u.textContent ?? ""));
    expect(pickers).toHaveLength(1);
    expect(pickers[0]!.querySelectorAll("kbd")).toHaveLength(2);
    expect(units.some((u) => u.textContent?.startsWith("→"))).toBe(true);
    expect(units.some((u) => u.textContent?.startsWith("Esc"))).toBe(true);
  });

  it("with only a hash on file the guard focuses the credential chip and a second Enter there copies", async () => {
    const user = userEvent.setup();
    setImported({ commands: [cmd("zz-pass", { title: "Zzpass login", template: "zzpass -p {PASS}", cardId: undefined, source: "raven" })], cards: [] });
    m.credentialsList.mockResolvedValue([{
      id: "c1", engagementId: "e1", type: "hash", username: "admin", domain: null, secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "NTLM",
      scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null,
      createdAt: 1, updatedAt: 1,
    }]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzpass");
    await d.findByRole("option", { name: /Zzpass login/ });
    await user.keyboard("{Enter}");
    const chip = await d.findByRole("button", { name: /^Fill with credential/ });
    expect(chip).toHaveFocus();
    expect(d.queryByRole("listbox", { name: "Fill with credential" })).not.toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await d.findByText(/^Copied for dc01/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("zzpass -p {PASS}");
    expect(d.queryByRole("listbox", { name: "Fill with credential" })).not.toBeInTheDocument();
  });

  it("on a card, c on a block with only a hash on file focuses the header credential chip and a second Enter there copies", async () => {
    const user = userEvent.setup();
    setImported({ commands: [cmd("zz-pass", { title: "Zzpass login", template: "zzpass -p {PASS}" })], cards: [CARD] });
    m.credentialsList.mockResolvedValue([{
      id: "c1", engagementId: "e1", type: "hash", username: "admin", domain: null, secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "NTLM",
      scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null,
      createdAt: 1, updatedAt: 1,
    }]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card", "zz-pass"));
    const d = within(await drawer());
    await block(d, "zzpass -p {PASS}");
    const chips = await d.findAllByRole("button", { name: /^Fill with credential/ });
    expect(chips).toHaveLength(1);
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("c");
    expect(chips[0]).toHaveFocus();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await d.findByText(/^Copied for dc01/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("zzpass -p {PASS}");
  });

  it("a picked credential supplies USER and DOMAIN, so they are not fields; with none they are", async () => {
    const user = userEvent.setup();
    setImported({ commands: [cmd("zz-login", { title: "Zzlogin as user", template: "zzlogin -u {USER} -d {DOMAIN} {TARGET_IP}", cardId: undefined, source: "raven" })], cards: [] });
    m.credentialsList.mockResolvedValue([{
      id: "c2", engagementId: "e1", type: "password", username: "svc", domain: "ACME", secret: "pw", hashType: null,
      scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null,
      createdAt: 1, updatedAt: 1,
    }]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzlogin");
    expect(await d.findByRole("combobox", { name: "Value for USER" })).toBeInTheDocument();
    await user.keyboard("{Alt>}c{/Alt}");
    await user.click(await d.findByRole("option", { name: /svc/ }));
    expect(await d.findByRole("combobox", { name: "Value for TARGET_IP" })).toBeInTheDocument();
    await vi.waitFor(() => expect(d.queryByRole("combobox", { name: "Value for USER" })).not.toBeInTheDocument());
    expect(d.queryByRole("combobox", { name: "Value for DOMAIN" })).not.toBeInTheDocument();
    await user.keyboard("{Alt>}c{/Alt}");
    await user.click(await d.findByRole("option", { name: /No credential/ }));
    expect(await d.findByRole("combobox", { name: "Value for USER" })).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: "Value for DOMAIN" })).toBeInTheDocument();
  });

  it("→ on a field-manual command opens its card at that block", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    await d.findByRole("option", { name: /Zzprobe the target/ });
    await user.keyboard("{ArrowRight}");
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(useArsenalStore.getState().cardId).toBe("zz-card");
    expect(useArsenalStore.getState().blockId).toBe("zz-probe");
  });

  it("→ on a built-in command opens it alone, and ← Back returns to the list", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzraven");
    await d.findByRole("option", { name: /Zzraven helper/ });
    await user.keyboard("{ArrowRight}");
    expect(await block(d, "zzhelper 10.10.10.5")).toBeInTheDocument();
    expect(useArsenalStore.getState().cardId).toBeNull();
    await user.click(d.getByRole("button", { name: "← Back" }));
    expect(d.getByRole("listbox", { name: "Arsenal results" })).toBeInTheDocument();
  });

  it("Enter on a generator opens it in the Payloads drawer", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzgen");
    await d.findByRole("option", { name: /Zzgen reverse shell/ });
    await user.keyboard("{Enter}");
    const p = within(await screen.findByRole("complementary", { name: "Payloads" }));
    expect(p.getByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("route host change resets chip and overrides", async () => {
    const user = userEvent.setup();
    const H2: Host = { ...H1, id: "h2", name: "web07", ip: "10.10.10.6" };
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    await user.type(await d.findByRole("combobox", { name: "Value for TARGET_IP" }), "1.1.1.1");
    const pre = await block(d, "zzprobe 1.1.1.1 from 10.10.14.9");
    expect(pre).not.toHaveAttribute("data-flash");
    act(() => nav.go("/e/e1/h/h2"));
    const after = await block(d, "zzprobe 10.10.10.6 from 10.10.14.9");
    expect(after).toHaveAttribute("data-flash");
    expect(d.getByRole("combobox", { name: "Value for TARGET_IP" })).toHaveValue("10.10.10.6");
    expect(hostChip(d)).toHaveAccessibleName("Fill for host web07");
  });

  it("Esc with the host list open closes only the list", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    await user.keyboard("{Alt>}h{/Alt}");
    expect(await d.findByRole("listbox", { name: /host/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(d.queryByRole("listbox", { name: /host/i })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
  });

  it("fails closed while the engagement loads", async () => {
    const user = userEvent.setup();
    m.engagementGet.mockImplementation(() => new Promise<Engagement>(() => {}));
    m.engagementsList.mockResolvedValue([EXAM]);
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.keyboard("a");
    const d = within(await drawer());
    expect(d.queryAllByRole("option")).toHaveLength(0);
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zz");
    expect(d.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("browse selection state (U2)", () => {
  it("the open category and the open row show which is selected, and generators are rows", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    const cats = within(await screen.findByRole("navigation", { name: "Categories" }));
    await user.click(await cats.findByRole("tab", { name: /^Zz Other Cat/ }));
    expect(cats.getByRole("tab", { name: /^Zz Other Cat/ })).toHaveAttribute("aria-selected", "true");
    expect(cats.getByRole("tab", { name: /^Zz Cat/ })).toHaveAttribute("aria-selected", "false");
    const results = within(screen.getByRole("listbox", { name: "Arsenal results" }));
    expect(await results.findByRole("option", { name: /Zz Other/ })).toHaveAttribute("aria-selected", "true");
    await user.click(cats.getByRole("tab", { name: /^Shells & transfers/ }));
    expect(await results.findByRole("option", { name: /Zzgen reverse shell/ })).toBeInTheDocument();
  });
});

describe("host picker in the drawer (U3)", () => {
  it("picking another host refills the card and clears chip edits", async () => {
    const user = userEvent.setup();
    const H2: Host = { ...H1, id: "h2", name: "web07", ip: "10.10.10.6" };
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    await user.type(await d.findByRole("combobox", { name: "Value for FILE" }), "a.exe");
    expect(await block(d, "zzcopy a.exe C:\\Windows\\Temp")).toBeInTheDocument();
    await user.keyboard("{Alt>}h{/Alt}");
    expect(hostChip(d)).toHaveFocus();
    await user.click(d.getByRole("option", { name: /web07/ }));
    expect(await block(d, "zzprobe 10.10.10.6 from 10.10.14.9")).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: "Value for FILE" })).toHaveValue("");
    await user.keyboard("{Alt>}h{/Alt}");
    await user.click(d.getByRole("option", { name: "No host" }));
    expect(await block(d, "zzprobe {TARGET_IP} from 10.10.14.9")).toBeInTheDocument();
  });
});
