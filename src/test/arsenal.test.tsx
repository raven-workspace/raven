import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
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
vi.mock("../features/palette/generators", () => ({ GENERATORS: [{ id: "g-zz", title: "Zzgen reverse shell", category: "Shells-and-Transfers" }] }));
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
  useArsenalStore.setState({ open: false, cardId: null });
  useNotesStore.setState({ open: false });
  setImported({ commands: [PROBE, FETCH, FETCH2, BANNED, RAVEN, OTHER], cards: [CARD, CARD2] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
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
const scopeText = (chip: HTMLElement): string => [...chip.children].map((n) => n.textContent).join(" ");
const hostChip = (scope: { getByRole: typeof screen.getByRole }) => scope.getByRole("button", { name: /^Fill for host/ });

describe("Arsenal", () => {
  it("A opens the drawer filled for the host in view and Esc closes it", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const d = within(await drawer());
    expect(hostChip(d)).toHaveAccessibleName("Fill for host: dc01");
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    await user.click(await d.findByRole("option", { name: /Zzprobe the target/ }));
    expect(await block(d, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(d.getByText("Because probing.")).toBeInTheDocument();
    // Esc backs out of the card first, then closes.
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "From card Zz Card ↗" }));
    const d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(d.getByText("Field Manual")).toBeInTheDocument();
    expect(d.getByText("Initial foothold")).toBeInTheDocument();
    expect(d.getByText("Zz-Cat")).toBeInTheDocument();
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
    const also = within(await screen.findByRole("region", { name: "Also in Raven" }));
    expect(await block(also, "zzhelper 10.10.10.5")).toBeInTheDocument();
    expect(also.queryByText(/zzprobe/)).not.toBeInTheDocument();
  });

  it("browse filters by stage and category", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    const cards = within(await screen.findByRole("region", { name: "Cards" }));
    // Cards appear once the engagement's exam rules are known.
    expect(await cards.findByRole("button", { name: "Zz Card" })).toBeInTheDocument();
    expect(cards.getByRole("button", { name: "Zz Other" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reporting" }));
    expect(cards.queryByRole("button", { name: "Zz Card" })).not.toBeInTheDocument();
    expect(cards.getByRole("button", { name: "Zz Other" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reporting" }));
    await user.click(screen.getByRole("button", { name: "Zz-Cat" }));
    expect(cards.queryByRole("button", { name: "Zz Other" })).not.toBeInTheDocument();
    await user.click(cards.getByRole("button", { name: "Zz Card" }));
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
    await d.findByRole("option", { name: /Zz Card/ });
    expect(d.queryByRole("option", { name: /Zzbanned/ })).not.toBeInTheDocument();
    expect(d.queryByRole("option", { name: /Zzprobe/ })).not.toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Fill for host: dc01" });
    expect(screen.queryByText(/zzrelay/)).not.toBeInTheDocument();
    expect(screen.queryByText(/zzprobe/)).not.toBeInTheDocument();
    await act(async () => release(EXAM));
    expect(await block(screen, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(screen.queryByText(/zzrelay/)).not.toBeInTheDocument();
  });

  it("on the dashboard host tokens stay unfilled", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.click(screen.getByRole("button", { name: "Arsenal" }));
    const d = within(await drawer());
    expect(d.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    expect(within(d.getByRole("search", { name: "Search the Arsenal" })).getByText("for no host")).toBeInTheDocument();
    act(() => useArsenalStore.getState().openCard("zz-card"));
    expect(await block(d, "zzprobe {TARGET_IP} from 10.10.14.9")).toBeInTheDocument();
  });

  it("the drawer's search bar holds the host scope at its right edge", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const bar = within(within(await drawer()).getByRole("search", { name: "Search the Arsenal" }));
    expect(bar.getByRole("textbox", { name: "Search the Arsenal" })).toBeInTheDocument();
    expect(bar.getByText("⌕")).toBeInTheDocument();
    expect(scopeText(hostChip(bar))).toBe("for dc01 ⌄");
  });

  it("search is keyboard-first: arrows pick, Enter opens the selection or the top result", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    let d = within(await drawer());
    const box = d.getByRole("textbox", { name: "Search the Arsenal" });
    await user.type(box, "zz");
    expect(await d.findByRole("option", { name: /Zz Card/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(d.getByRole("option", { name: /Zz Other/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(await d.findByRole("heading", { name: "Zz Other" })).toBeInTheDocument();
    await user.type(box, "zz");
    await user.keyboard("{Enter}");
    d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("A opens a hostless drawer on the dashboard and is ignored while typing", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.keyboard("a");
    const d = within(await drawer());
    expect(d.queryByRole("button", { name: /^Fill for host/ })).not.toBeInTheDocument();
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "a");
    expect(screen.getByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
    expect(d.getByRole("textbox", { name: "Search the Arsenal" })).toHaveValue("a");
  });

  it("A on the browse screen focuses it instead of opening a drawer", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    await screen.findByRole("region", { name: "Cards" });
    await user.keyboard("a");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
    expect(useArsenalStore.getState().open).toBe(false);
  });

  it("a chip override never fills another host", async () => {
    const user = userEvent.setup();
    const H2: Host = { ...H1, id: "h2", name: "web02", ip: "10.10.10.6" };
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
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard());
    const d = within(await drawer());
    for (const c of perStage) expect(await d.findByRole("option", { name: new RegExp(c.title) })).toBeInTheDocument();
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

  it("browse lists every imported card under its stage", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    const cards = within(await screen.findByRole("region", { name: "Cards" }));
    const stage = within(screen.getByRole("region", { name: "Stage" }));
    for (const c of perStage) {
      await user.click(stage.getByRole("button", { name: STAGES.find(([id]) => id === c.stage)![1] }));
      expect(cards.getByRole("button", { name: c.title })).toBeInTheDocument();
    }
  });
});

describe("full-screen Arsenal uses the engagement you came from (B4)", () => {
  const E2: Engagement = { ...E1, id: "e2", name: "Client Beta", lastActivityAt: 1 };
  const NEWER: Engagement = { ...E1, id: "e1", name: "Mock exam A", lastActivityAt: 99 };
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
    await screen.findByRole("region", { name: "Cards" });
    await user.keyboard("{Meta>}k{/Meta}");
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(await within(screen.getByRole("dialog")).findByText(/Client Beta/)).toBeInTheDocument();
    await user.type(box, "qqnote");
    expect(await screen.findByRole("option", { name: /Qqnote about the portal/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "zzprobe");
    expect(await screen.findByText("zzprobe 10.20.0.9 from 10.10.14.9")).toBeInTheDocument();
  });

  it("a remembered engagement that no longer exists falls back to the most recently active one", async () => {
    useLastEngagementStore.setState({ engagementId: "gone", hostId: "hx" });
    mountAt("/arsenal");
    await userEvent.setup().click(await screen.findByRole("button", { name: /^Fill for host/ }));
    expect(await screen.findByRole("option", { name: /dc01/ })).toBeInTheDocument();
    expect(screen.getByText("Mock exam A")).toBeInTheDocument();
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
    const groups = d.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Shells & transfers", "Zz Cat", "Zz Other Cat"]);
    expect(d.getByRole("heading", { name: "Shells & transfers" })).toBeInTheDocument();
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

  it("with no query the list groups every card, built-in and imported", async () => {
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard());
    const d = within(await drawer());
    expect(within(d.getByRole("group", { name: "Zz Cat" })).getByRole("option", { name: /Zz Card/ })).toBeInTheDocument();
    const labels = d.getAllByRole("group").map((g) => g.getAttribute("aria-label")!);
    const cardLabels = labels.filter((l) => l !== "Commands");
    expect(cardLabels).toEqual([...cardLabels].sort((a, b) => a.localeCompare(b)));
    expect(labels.at(-1)).toBe("Commands");
  });
});

describe("browse sidebar selection state (U2)", () => {
  it("filters show which is selected, each group has All, and generators are links", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    await screen.findByRole("region", { name: "Cards" });
    const stage = within(screen.getByRole("region", { name: "Stage" }));
    const category = within(screen.getByRole("region", { name: "Category" }));
    expect(stage.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(category.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await user.click(stage.getByRole("button", { name: "Reporting" }));
    expect(stage.getByRole("button", { name: "Reporting" })).toHaveAttribute("aria-pressed", "true");
    expect(stage.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    await user.click(category.getByRole("button", { name: "Zz-Other-Cat" }));
    expect(category.getByRole("button", { name: "Zz-Other-Cat" })).toHaveAttribute("aria-pressed", "true");
    await user.click(stage.getByRole("button", { name: "All" }));
    expect(stage.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(stage.getByRole("button", { name: "Reporting" })).toHaveAttribute("aria-pressed", "false");
    await user.click(category.getByRole("button", { name: "All" }));
    const cards = within(screen.getByRole("region", { name: "Cards" }));
    await user.click(cards.getByRole("button", { name: "Zz Card" }));
    expect(cards.getByRole("button", { name: "Zz Card" })).toHaveAttribute("aria-current", "true");
    expect(cards.getByRole("button", { name: "Zz Other" })).not.toHaveAttribute("aria-current");
    expect(within(screen.getByRole("region", { name: "Generators" })).getByRole("link", { name: /Zzgen reverse shell/ })).toBeInTheDocument();
  });
});

describe("host picker in the drawer (U3)", () => {
  it("picking another host refills the card and clears chip edits", async () => {
    const user = userEvent.setup();
    const H2: Host = { ...H1, id: "h2", name: "web02", ip: "10.10.10.6" };
    m.hostsList.mockResolvedValue([H1, H2]);
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    await user.type(await d.findByRole("combobox", { name: "Value for FILE" }), "a.exe");
    expect(await block(d, "zzcopy a.exe C:\\Windows\\Temp")).toBeInTheDocument();
    await user.keyboard("{Alt>}h{/Alt}");
    expect(hostChip(d)).toHaveFocus();
    await user.click(d.getByRole("option", { name: /web02/ }));
    expect(await block(d, "zzprobe 10.10.10.6 from 10.10.14.9")).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: "Value for FILE" })).toHaveValue("");
    await user.keyboard("{Alt>}h{/Alt}");
    await user.click(d.getByRole("option", { name: "No host" }));
    expect(await block(d, "zzprobe {TARGET_IP} from 10.10.14.9")).toBeInTheDocument();
  });
});
