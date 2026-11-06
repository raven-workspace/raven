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
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useArsenalStore.setState({ open: false, cardId: null });
  useNotesStore.setState({ open: false });
  setImported({ commands: [PROBE, FETCH, FETCH2, BANNED, RAVEN, OTHER], cards: [CARD, CARD2] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm",
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

describe("Arsenal", () => {
  it("A opens the drawer filled for the host in view and Esc closes it", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard("a");
    const d = within(await drawer());
    expect(d.getByText("for dc01")).toBeInTheDocument();
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzprobe");
    await user.click(await d.findByRole("option", { name: /Zzprobe the target/ }));
    expect(await block(d, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(d.getByText("Because probing.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("A does nothing while typing", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await user.click(await screen.findByRole("tab", { name: "Checklist" }));
    const notes = await screen.findByRole("textbox", { name: "Notes: Scan all 65,535 TCP ports" });
    await user.click(notes);
    await user.keyboard("a");
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
    expect(notes).toHaveValue("a");
  });

  it("opening the drawer closes Notes and Stuck", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
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
    await user.click(await screen.findByRole("tab", { name: "Checklist" }));
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
    await screen.findByRole("tab", { name: "Checklist" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    expect(await block(d, "zzfetch http://10.10.14.9/{FILE}")).toBeInTheDocument();
    await user.type(d.getByRole("textbox", { name: "Value for FILE" }), "a.exe");
    expect(await block(d, "zzfetch http://10.10.14.9/a.exe")).toBeInTheDocument();
    expect(await block(d, "zzcopy a.exe C:\\Windows\\Temp")).toBeInTheDocument();
    // The chips edit LHOST too.
    await user.type(d.getByRole("textbox", { name: "Value for LHOST" }), "10.9.9.9");
    expect(await block(d, "zzprobe 10.10.10.5 from 10.9.9.9")).toBeInTheDocument();
  });

  it("Also in Raven lists raven-source commands for the card's goals", async () => {
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const also = within(await screen.findByRole("region", { name: "Also in Raven" }));
    expect(await block(also, "zzhelper 10.10.10.5")).toBeInTheDocument();
    expect(also.queryByText(/zzprobe/)).not.toBeInTheDocument();
  });

  it("browse filters by stage and category", async () => {
    const user = userEvent.setup();
    mount("/arsenal");
    const cards = within(await screen.findByRole("region", { name: "Cards" }));
    expect(cards.getByRole("button", { name: "Zz Card" })).toBeInTheDocument();
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Host" }), "dc01");
    expect(await block(screen, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
  });

  it("banned commands are hidden in exam-sim", async () => {
    mount("/e/e1/h/h1", EXAM);
    await screen.findByRole("tab", { name: "Checklist" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    expect(await block(d, "zzprobe 10.10.10.5 from 10.10.14.9")).toBeInTheDocument();
    expect(d.queryByText(/zzrelay/)).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(d.getByRole("textbox", { name: "Search the Arsenal" }), "zzbanned");
    expect(d.queryByRole("option", { name: /Zzbanned/ })).not.toBeInTheDocument();
  });

  it("on the dashboard host tokens stay unfilled", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.click(screen.getByRole("button", { name: "Arsenal" }));
    const d = within(await drawer());
    expect(d.queryByText(/^for /)).not.toBeInTheDocument();
    act(() => useArsenalStore.getState().openCard("zz-card"));
    expect(await block(d, "zzprobe {TARGET_IP} from 10.10.14.9")).toBeInTheDocument();
  });

  it("search is keyboard-first: arrows pick, Enter opens the selection or the top result", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
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
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("A opens a hostless drawer on the dashboard and is ignored while typing", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByText("Mock exam A");
    await user.keyboard("a");
    const d = within(await drawer());
    expect(d.queryByText(/^for /)).not.toBeInTheDocument();
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
    await screen.findByRole("tab", { name: "Checklist" });
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await drawer());
    await user.type(await d.findByRole("textbox", { name: "Value for TARGET_IP" }), "1.1.1.1");
    expect(await block(d, "zzprobe 1.1.1.1 from 10.10.14.9")).toBeInTheDocument();
    act(() => nav.go("/e/e1/h/h2"));
    expect(await block(d, "zzprobe 10.10.10.6 from 10.10.14.9")).toBeInTheDocument();
  });

  it("→ in the palette opens the card in the drawer", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Checklist" });
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzprobe");
    await user.keyboard("{ArrowRight}");
    const d = within(await drawer());
    expect(await d.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
  });
});
