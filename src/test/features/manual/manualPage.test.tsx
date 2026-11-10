import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import type { FieldManualSnapshot } from "../../../engines/fieldManual/merge";
import { setImported } from "../../../engines/library/store";
import { parseNote, type ManualNote } from "../../../engines/manual";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { useCaptureStore } from "../../../features/capture/useCaptureStore";
import { useManualStore } from "../../../features/manual/useManualStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { logCommand } from "../../../features/capture/logCommand";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";

vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn() }));
const m = vi.mocked(api, true);

// Synthetic fixtures only: invented note names and bodies.
const BASICS = parseNote("04-Foundations/Bb-Basics.md", "# Bb Basics\nSee [[Zz-Errors#Core Concept|the errors]].\n## Alpha\ntext\n## Beta\ntext\n### Beta Two\n**Table 1 — Zz codes**\n| A | B |\n| - | - |\n| x | y |\n")!;
const ERRORS = parseNote("04-Foundations/Zz-Errors.md", "# Zz Errors\n## Core Concept\nWords.\n")!;
const TOOL = parseNote("03-Tools/Aa Tool.md", "# Aa Tool\n## Usage\n```bash title:\"Kali\"\nzzscan -t {TARGET_IP}\n```\n")!;
const REPORT = parseNote("05-Reporting/Report Structure.md", "# Report Structure\n## Sections\n")!;
const NOTES: ManualNote[] = [TOOL, ERRORS, REPORT, BASICS];

// RFC 5737 addresses, invented names.
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const WEB = host("h1", "zzweb01", "198.51.100.21");
const DB = host("h2", "zzdb02", "198.51.100.22");

/** An engagement with two hosts, enough for the host page and filling. */
function withEngagement() {
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([WEB, DB]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
}

const snapshot = (notes?: ManualNote[]): FieldManualSnapshot => ({
  importedAt: 1, cards: [], overlay: {}, added: [], playbook: [], toolkit: [], report: {} as FieldManualSnapshot["report"],
  ...(notes ? { notes } : {}),
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function mount(entries: string[] = ["/"]) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <App />
        <Where />
        <input aria-label="Zz field" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId("where").textContent;
const pane = () => screen.getByRole("region", { name: "Note" });
const rail = () => within(screen.getByRole("navigation", { name: "Manual notes" }));
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });
const openNote = (title: string) => screen.findByRole("article", { name: title });

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useManualStore.setState({ place: null, history: [] });
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null });
  usePayloadsStore.setState({ open: false });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "192.0.2.10", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  m.engagementsList.mockResolvedValue([]);
  m.engagementsProgress.mockResolvedValue({});
  m.fieldManualLoad.mockResolvedValue(snapshot(NOTES));
  m.fieldManualLatestMtime.mockResolvedValue(null);
});
afterEach(() => setImported({ commands: [], cards: [] }));

/** The dashboard is up once the title bar shows the unlocked controls. */
const ready = () => screen.findByRole("button", { name: "Manual" });

describe("Manual: opening", () => {
  it("the title bar shows Manual between Arsenal and Payloads", async () => {
    mount();
    await ready();
    const names = screen.getAllByRole("button").map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    const at = (n: string) => names.findIndex((t) => t?.startsWith(n));
    expect(at("Arsenal")).toBeGreaterThanOrEqual(0);
    expect(at("Manual")).toBe(at("Arsenal") + 1);
    expect(at("Payloads")).toBe(at("Manual") + 1);
  });

  it("M on the dashboard opens the remembered note at its scroll position", async () => {
    useManualStore.setState({ place: { noteId: ERRORS.id, scrollTop: 240 } });
    mount();
    await ready();
    press("m");
    expect(await openNote("Zz Errors")).toBeInTheDocument();
    expect(where()).toBe(`/manual/${ERRORS.id}`);
    await waitFor(() => expect(pane().scrollTop).toBe(240));
  });

  it("the first visit opens the first Foundations note", async () => {
    mount();
    await ready();
    press("M");
    expect(await openNote("Bb Basics")).toBeInTheDocument();
    expect(where()).toBe(`/manual/${BASICS.id}`);
  });

  it("a remembered note gone after a re-import opens the first Foundations note, without an error", async () => {
    useManualStore.setState({ place: { noteId: "zz-gone", scrollTop: 90 } });
    mount(["/manual"]);
    expect(await openNote("Bb Basics")).toBeInTheDocument();
    expect(pane().scrollTop).toBe(0);
    expect(screen.queryByText(/not found|couldn't/i)).toBeNull();
  });

  it("an unknown note in the address opens the first Foundations note", async () => {
    mount(["/manual/zz-unknown"]);
    expect(await openNote("Bb Basics")).toBeInTheDocument();
    expect(where()).toBe(`/manual/${BASICS.id}`);
  });

  it("M while typing in a field types the letter", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.type(screen.getByRole("textbox", { name: "Zz field" }), "m");
    expect(screen.getByRole("textbox", { name: "Zz field" })).toHaveValue("m");
    expect(where()).toBe("/");
  });

  it("M with the Arsenal, Payloads or Notes drawer open does nothing", async () => {
    mount();
    await ready();
    for (const open of [
      () => useArsenalStore.setState({ open: true }),
      () => usePayloadsStore.setState({ open: true }),
      () => useNotesStore.setState({ open: true }),
    ]) {
      act(open);
      press("m");
      expect(where()).toBe("/");
      act(() => {
        useArsenalStore.setState({ open: false });
        usePayloadsStore.setState({ open: false });
        useNotesStore.setState({ open: false });
      });
    }
  });
});

describe("Manual: the rail", () => {
  it("groups Foundations, Tools and Reporting, each alphabetical", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    const r = rail();
    const groups = r.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Foundations", "Tools", "Reporting"]);
    expect(within(r.getByRole("group", { name: "Foundations" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Bb Basics", "Zz Errors"]);
    expect(r.getByRole("button", { name: "Bb Basics" })).toHaveAttribute("aria-current", "page");
  });

  it("/ focuses the filter, which narrows the rail by title", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("/");
    const filter = rail().getByRole("searchbox", { name: "Filter the Manual" });
    expect(filter).toHaveFocus();
    await user.keyboard("err");
    expect(rail().getAllByRole("button").map((b) => b.textContent)).toEqual(["Zz Errors"]);
    expect(rail().queryByRole("group", { name: "Tools" })).toBeNull();
  });

  it("↓ from the filter moves into the list; ↵ opens a note and pushes the history; ⌘[ comes back to the same spot", async () => {
    const user = userEvent.setup();
    mount(["/", "/manual"]);
    await openNote("Bb Basics");
    act(() => {
      pane().scrollTop = 120;
      fireEvent.scroll(pane());
    });
    press("/");
    await user.keyboard("{ArrowDown}");
    expect(rail().getByRole("button", { name: "Bb Basics" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(rail().getByRole("button", { name: "Zz Errors" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await openNote("Zz Errors")).toBeInTheDocument();
    expect(useManualStore.getState().history).toEqual([{ noteId: BASICS.id, scrollTop: 120 }]);
    expect(pane().scrollTop).toBe(0);

    press("[", { metaKey: true });
    expect(await openNote("Bb Basics")).toBeInTheDocument();
    await waitFor(() => expect(pane().scrollTop).toBe(120));
    expect(useManualStore.getState().history).toEqual([]);
  });

  it("a link in a note opens the linked note in place and pushes the history", async () => {
    const user = userEvent.setup();
    mount(["/", "/manual"]);
    await openNote("Bb Basics");
    await user.click(screen.getByRole("link", { name: "the errors" }));
    expect(await openNote("Zz Errors")).toBeInTheDocument();
    expect(useManualStore.getState().history.map((h) => h.noteId)).toEqual([BASICS.id]);
  });
});

describe("Manual: leaving, sections and place", () => {
  it("Esc returns to the previous route, even after moving between notes", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    press("m");
    await openNote("Bb Basics");
    await user.click(rail().getByRole("button", { name: "Zz Errors" }));
    await openNote("Zz Errors");
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    press("Escape");
    await waitFor(() => expect(where()).toBe("/"));
  });

  it("Esc on a first entry goes home", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("Escape");
    await waitFor(() => expect(where()).toBe("/"));
  });

  it("] and [ step through the outline; a table entry shows its number and name apart", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    const entries = outline.getAllByRole("button");
    expect(entries.map((b) => b.textContent)).toEqual(["Alpha", "Beta", "Beta Two", "Table 1Zz codes"]);
    const table = entries[3]!;
    expect(within(table).getByText("Table 1")).toBeInTheDocument();
    expect(within(table).getByText("Zz codes")).toBeInTheDocument();
    press("]");
    expect(outline.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "location");
    press("]");
    expect(outline.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-current", "location");
    press("[");
    expect(outline.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "location");
  });

  it("] does nothing while typing in the filter", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("/");
    await user.keyboard("]");
    expect(rail().getByRole("searchbox", { name: "Filter the Manual" })).toHaveValue("]");
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    expect(outline.getAllByRole("button").some((b) => b.getAttribute("aria-current"))).toBe(false);
  });

  it("the reading place persists as the note id and scroll offset only", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    act(() => {
      pane().scrollTop = 80;
      fireEvent.scroll(pane());
    });
    await waitFor(() => expect(useManualStore.getState().place).toEqual({ noteId: BASICS.id, scrollTop: 80 }));
    const stored = JSON.parse(localStorage.getItem("raven.manual.place") ?? "null");
    expect(stored.state).toEqual({ place: { noteId: BASICS.id, scrollTop: 80 } });
  });

  it("the hint line lists the page's keys", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    const hints = screen.getByRole("group", { name: "Manual shortcuts" });
    for (const label of ["filter", "previous note", "back"]) expect(within(hints).getByText(label)).toBeInTheDocument();
  });
});

describe("Manual: empty states", () => {
  it("never imported: says what the Manual holds and links to Settings", async () => {
    m.fieldManualLoad.mockResolvedValue(null);
    mount(["/manual"]);
    expect(await screen.findByText("The Manual holds your Field Manual's Tools, Foundations and Reporting notes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /settings/ }));
    await waitFor(() => expect(where()).toBe("/settings"));
  });

  it("an import from before the Manual asks for a re-import", async () => {
    m.fieldManualLoad.mockResolvedValue(snapshot());
    mount(["/manual"]);
    expect(await screen.findByText(/import again/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/ })).toBeInTheDocument();
  });

  it("an import with no notes shows the empty state", async () => {
    m.fieldManualLoad.mockResolvedValue(snapshot([]));
    mount(["/manual"]);
    expect(await screen.findByText("The Manual holds your Field Manual's Tools, Foundations and Reporting notes.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Note" })).toBeNull();
  });
});

describe("Manual: the host commands fill for", () => {
  const pre = (text: string) => screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === text);

  it("arriving from a host page shows that host and fills for it", async () => {
    withEngagement();
    useManualStore.setState({ place: { noteId: TOOL.id, scrollTop: 0 } });
    mount(["/e/e1/h/h1"]);
    await screen.findByRole("tab", { name: "Next" });
    press("m");
    await openNote("Aa Tool");
    expect(await screen.findByRole("button", { name: "Fill for host: zzweb01" })).toBeInTheDocument();
    expect(await pre("zzscan -t 198.51.100.21")).toBeInTheDocument();
  });

  it("switching the host refills the command, and ⌘↵ logs to the chosen host", async () => {
    const user = userEvent.setup();
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount([`/manual/${TOOL.id}`]);
    await pre("zzscan -t 198.51.100.21");
    await user.click(screen.getByRole("button", { name: "Fill for host: zzweb01" }));
    await user.click(await screen.findByRole("option", { name: /zzdb02/ }));
    expect(await pre("zzscan -t 198.51.100.22")).toBeInTheDocument();
    expect(screen.getByTestId("manual-host-ip")).toHaveTextContent("198.51.100.22");
    const group = await screen.findByRole("group", { name: "Note command: Kali" });
    act(() => group.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      engagementId: "e1", host: expect.objectContaining({ id: "h2" }), command: "zzscan -t 198.51.100.22",
    })));
  });

  it("⌥H opens the host picker", async () => {
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount([`/manual/${TOOL.id}`]);
    await pre("zzscan -t 198.51.100.21");
    press("˙", { altKey: true, code: "KeyH" });
    expect(await screen.findByRole("option", { name: /zzdb02/ })).toBeInTheDocument();
  });

  it("no engagement: says so, and commands keep their placeholders", async () => {
    mount([`/manual/${TOOL.id}`]);
    expect(await screen.findByText("No active engagement")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fill for host/ })).toBeNull();
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && (el.textContent ?? "").includes("{TARGET_IP}"))).toBeInTheDocument();
  });

  it("the restored scroll is applied again once the exam rules have loaded", async () => {
    withEngagement();
    let release: (v: Engagement[]) => void = () => {};
    m.engagementsList.mockReturnValue(new Promise((r) => (release = r)));
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    useManualStore.setState({ place: { noteId: ERRORS.id, scrollTop: 240 } });
    mount(["/manual"]);
    await openNote("Zz Errors");
    await waitFor(() => expect(pane().scrollTop).toBe(240));
    act(() => {
      pane().scrollTop = 30; // late layout moved the spot
    });
    await act(async () => release([E1]));
    await waitFor(() => expect(pane().scrollTop).toBe(240));
  });
});

describe("Manual: title bar and focus", () => {
  it("the Manual button is current on the Manual only", async () => {
    mount();
    expect(await ready()).not.toHaveAttribute("aria-current");
    press("m");
    await openNote("Bb Basics");
    expect(screen.getByRole("button", { name: "Manual" })).toHaveAttribute("aria-current", "page");
  });

  it("M on the Manual focuses the note pane", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("m");
    expect(pane()).toHaveFocus();
    expect(pane().className).toMatch(/focus-visible:/);
  });

  it("the hint line lists ⌘↵ copy and log", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    expect(within(screen.getByRole("group", { name: "Manual shortcuts" })).getByText("copy and log")).toBeInTheDocument();
  });
});
