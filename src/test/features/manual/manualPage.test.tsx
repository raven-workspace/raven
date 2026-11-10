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
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";

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
const TOOL = parseNote("03-Tools/Aa Tool.md", "# Aa Tool\n## Usage\n")!;
const REPORT = parseNote("05-Reporting/Report Structure.md", "# Report Structure\n## Sections\n")!;
const NOTES: ManualNote[] = [TOOL, ERRORS, REPORT, BASICS];

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
