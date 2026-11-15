import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { useManualStatus } from "../../../features/manual/useManualStatus";
import { useManualStore } from "../../../features/manual/useManualStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { logCommand } from "../../../features/capture/logCommand";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import { RavenError } from "../../../types/errors";
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
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
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
const user0 = () => userEvent.setup();
const openNote = (title: string) => screen.findByRole("article", { name: title });

/** Where Bb Basics' headings sit down the note, in px: jsdom lays nothing out, so [ ] and the bar read these. */
const HEADING_AT: Record<string, number> = { alpha: 100, beta: 300, "beta-two": 500, "table-1": 700 };
let undoLayout: (() => void) | null = null;
/**
 * A laid-out Bb Basics: the pane's top at 0, each heading at its spot less the pane's scroll, outline rows 28px apart
 * from 100, and scrollIntoView putting a heading on the pane's top (as far as the pane can scroll).
 */
function layOut() {
  const rect = Element.prototype.getBoundingClientRect;
  const into = Element.prototype.scrollIntoView;
  const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const row = this.getAttribute("data-index");
    if (row !== null) return new DOMRect(0, 100 + 28 * Number(row), 180, 28);
    if (this.querySelector(":scope > [data-testid=section-indicator]")) return new DOMRect(0, 100, 180, 112);
    if (this.getAttribute("aria-label") === "Note") return new DOMRect(0, 0, 600, 500);
    const note = this.closest<HTMLElement>("[aria-label=Note]");
    const y = HEADING_AT[this.id];
    if (note && y !== undefined) return new DOMRect(0, y - note.scrollTop, 600, 22);
    return rect.call(this);
  });
  Element.prototype.scrollIntoView = function (this: Element) {
    const note = this.closest<HTMLElement>("[aria-label=Note]");
    const y = HEADING_AT[this.id];
    if (!note || y === undefined) return;
    const max = note.scrollHeight - note.clientHeight;
    note.scrollTop = max > 0 ? Math.min(y, max) : y;
  };
  undoLayout = () => {
    rects.mockRestore();
    Element.prototype.scrollIntoView = into;
  };
}
afterEach(() => {
  undoLayout?.();
  undoLayout = null;
});

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
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
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
    layOut();
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    press("]");
    expect(outline.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "location");
    press("]");
    expect(outline.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-current", "location");
    const entries = outline.getAllByRole("button");
    expect(entries.map((b) => b.textContent)).toEqual(["Alpha", "Beta", "Beta Two", "Table 1Zz codes"]);
    const table = entries[3]!;
    expect(within(table).getByText("Table 1")).toBeInTheDocument();
    expect(within(table).getByText("Zz codes")).toBeInTheDocument();
    press("]");
    expect(outline.getByRole("button", { name: "Beta Two" })).toHaveAttribute("aria-current", "location");
    press("[");
    press("[");
    expect(outline.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "location");
  });

  it("outline shows h3s of the current section only", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    layOut();
    const outline = () => within(screen.getByRole("navigation", { name: "On this page" }));
    press("]");
    expect(outline().getAllByRole("button").map((b) => b.textContent)).toEqual(["Alpha", "Beta"]);
    press("]");
    expect(outline().getAllByRole("button").map((b) => b.textContent)).toEqual(["Alpha", "Beta", "Beta Two", "Table 1Zz codes"]);
    press("[");
    expect(outline().getAllByRole("button").map((b) => b.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("an older import's stale outline is re-derived from the body: a caption with trailing text shows", async () => {
    const body = "# Cc Caps\n## Intro\n**Table 1 — Zz codes** (zztool; prefixes `ZZ_`)\n| A |\n| - |\n| x |\n";
    const stale: ManualNote = { ...parseNote("04-Foundations/Cc Caps.md", body)!, outline: [{ id: "intro", text: "Intro", kind: "h2" }] };
    m.fieldManualLoad.mockResolvedValue(snapshot([stale]));
    mount([`/manual/${stale.id}`]);
    await openNote("Cc Caps");
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    expect(outline.getAllByRole("button").map((b) => b.textContent)).toEqual(["Intro", "Table 1Zz codes"]);
  });

  it("outline entries read as the note does: code in mono, no backticks or asterisks", async () => {
    const body = "# Cc Marks\n## Reading `zz route` *fast*\n**Table 2 — The **zz** `flags`** (more)\n";
    m.fieldManualLoad.mockResolvedValue(snapshot([parseNote("04-Foundations/Cc Marks.md", body)!]));
    mount(["/manual"]);
    await openNote("Cc Marks");
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    const [h, t] = outline.getAllByRole("button");
    expect(h).toHaveTextContent(/^Reading zz route fast$/);
    expect(within(h!).getByText("zz route").tagName).toBe("CODE");
    expect(t!.textContent).not.toMatch(/[`*]/);
    expect(t).toHaveTextContent("Table 2");
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

describe("Manual: On this page follows the reading", () => {
  /** The IntersectionObserver the scroll-spy makes; tests report headings entering and leaving the band. */
  let observer: { cb: IntersectionObserverCallback; root: Element | null; margin: string | undefined; seen: Element[] } | null = null;
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      observer = { cb, root: (opts?.root as Element | null) ?? null, margin: opts?.rootMargin, seen: [] };
    }
    observe(el: Element) { observer!.seen.push(el); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  const band = (visible: string[]) =>
    act(() => observer!.cb(
      observer!.seen.map((el) => ({ target: el, isIntersecting: visible.includes(el.id) }) as unknown as IntersectionObserverEntry),
      observer as unknown as IntersectionObserver,
    ));
  /** A 2000px note in a 500px pane, scrolled to `top`. */
  const scrollPane = (top: number) => {
    const p = pane();
    Object.defineProperty(p, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(p, "clientHeight", { configurable: true, value: 500 });
    act(() => {
      p.scrollTop = top;
      fireEvent.scroll(p);
    });
  };
  const outline = () => within(screen.getByRole("navigation", { name: "On this page" }));
  /** A jump's scroll has gone quiet: the owner's next scroll is theirs. */
  const settled = () => act(() => new Promise((r) => setTimeout(r, 200)));
  const currentEntry = () => outline().getAllByRole("button").find((b) => b.getAttribute("aria-current") === "location")?.textContent;

  beforeEach(() => {
    observer = null;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    delete (globalThis as Partial<typeof globalThis>).IntersectionObserver;
  });

  it("watches the note pane's band and marks the first heading inside it", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    expect(observer!.root).toBe(pane());
    expect(observer!.margin).toBe("-20px 0px -40% 0px");
    expect(observer!.seen.map((el) => el.id)).toEqual(["alpha", "beta", "beta-two", "table-1"]);
    scrollPane(600);
    band(["beta"]);
    expect(currentEntry()).toBe("Beta");
    band(["beta-two", "table-1"]);
    expect(currentEntry()).toBe("Beta Two");
  });

  it("pins the first entry at the top of the note and the last at its end", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    scrollPane(600);
    band(["beta"]);
    scrollPane(30);
    await waitFor(() => expect(currentEntry()).toBe("Alpha"));
    scrollPane(1470);
    await waitFor(() => expect(currentEntry()).toBe("Table 1Zz codes"));
  });

  it("a jump near the end keeps its entry current while the note sits at its end, and [ ] step on from it", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    layOut();
    scrollPane(1500);
    await waitFor(() => expect(currentEntry()).toBe("Table 1Zz codes"));
    press("[");
    expect(currentEntry()).toBe("Table 1Zz codes");
    press("[");
    expect(currentEntry()).toBe("Beta Two");
    scrollPane(1490);
    await new Promise((r) => setTimeout(r, 200));
    expect(currentEntry()).toBe("Beta Two");
  });

  it("the lime bar slides to the current entry", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    const bar = screen.getByTestId("section-indicator");
    expect(bar).not.toBeVisible();
    expect(bar).toHaveClass("bg-accent", "transition-[transform,height]", "motion-reduce:transition-none");
    layOut();
    press("]");
    expect(bar).toBeVisible();
    expect(bar.style.transform).toBe("translateY(0px)");
    expect(bar.style.height).toBe("28px");
    press("]");
    expect(currentEntry()).toBe("Beta");
    expect(bar.style.transform).toBe("translateY(28px)");
  });

  it("] goes to the first heading below the pane's top, never the section being read; [ to the start of the one being read", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    layOut();
    // Reading Beta: its heading is 50px above the top, Beta Two's 150px below.
    scrollPane(350);
    await waitFor(() => expect(currentEntry()).toBe("Beta"));
    press("]");
    expect(currentEntry()).toBe("Beta Two");
    expect(pane().scrollTop).toBe(500);
    await settled();
    scrollPane(350);
    await waitFor(() => expect(currentEntry()).toBe("Beta"));
    press("[");
    expect(currentEntry()).toBe("Beta");
    expect(pane().scrollTop).toBe(300);
    await settled();
    // Beta's heading on the top edge: ] skips it, [ goes to the one before.
    scrollPane(300);
    await settled();
    press("]");
    expect(currentEntry()).toBe("Beta Two");
    await settled();
    scrollPane(300);
    await settled();
    press("[");
    expect(currentEntry()).toBe("Alpha");
  });

  it("clicking an entry scrolls smoothly in place: no history entry, and Esc still leaves in one press", async () => {
    const user = userEvent.setup();
    const scrolls = vi.fn();
    const into = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolls;
    const pushState = vi.spyOn(window.history, "pushState");
    try {
    mount();
    await ready();
    press("m");
    await openNote("Bb Basics");
    const path = where();
    await user.click(outline().getByRole("button", { name: "Beta" }));
    expect(scrolls).toHaveBeenLastCalledWith({ block: "start", behavior: "smooth" });
    expect(screen.getByRole("heading", { name: "Beta" })).toHaveFocus();
    expect(currentEntry()).toBe("Beta");
    expect(pushState).not.toHaveBeenCalled();
    expect(where()).toBe(path);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    press("Escape");
    await waitFor(() => expect(where()).toBe("/"));
    } finally {
      pushState.mockRestore();
      Element.prototype.scrollIntoView = into;
    }
  });

  it("with reduced motion an entry jumps at once", async () => {
    const user = userEvent.setup();
    const scrolls = vi.fn();
    const into = Element.prototype.scrollIntoView;
    const media = window.matchMedia;
    Element.prototype.scrollIntoView = scrolls;
    window.matchMedia = ((q: string) => ({ ...media(q), matches: q.includes("prefers-reduced-motion") })) as typeof window.matchMedia;
    try {
      mount(["/manual"]);
      await openNote("Bb Basics");
      await user.click(outline().getByRole("button", { name: "Beta" }));
      expect(scrolls).toHaveBeenLastCalledWith({ block: "start", behavior: "auto" });
    } finally {
      window.matchMedia = media;
      Element.prototype.scrollIntoView = into;
    }
  });

  it("a note with the same headings as the last one is watched afresh", async () => {
    const body = (t: string) => `# ${t}\n## Install\ntext\n## Key Flags\ntext\n## Examples\ntext\n`;
    const one = parseNote("03-Tools/Zz One.md", body("Zz One"))!;
    const two = parseNote("03-Tools/Zz Two.md", body("Zz Two"))!;
    m.fieldManualLoad.mockResolvedValue(snapshot([one, two, BASICS]));
    const user = userEvent.setup();
    mount([`/manual/${one.id}`]);
    await openNote("Zz One");
    scrollPane(600);
    band(["key-flags"]);
    expect(currentEntry()).toBe("Key Flags");
    await user.click(rail().getByRole("button", { name: "Zz Two" }));
    const article = await openNote("Zz Two");
    // Nothing carries over: no entry current, and the observer watches the new note's own headings.
    expect(currentEntry()).toBeUndefined();
    expect(observer!.seen.map((el) => el.id)).toEqual(["install", "key-flags", "examples"]);
    expect(observer!.seen.every((el) => el.isConnected && article.contains(el))).toBe(true);
    scrollPane(600);
    band(["examples"]);
    expect(currentEntry()).toBe("Examples");
  });

  it("a scroll inside a jump's settle time ends the jump's hold", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    layOut();
    scrollPane(600);
    press("[");
    expect(currentEntry()).toBe("Beta Two");
    scrollPane(320);
    await settled();
    // The owner moved on to Beta's section: ] reads the pane again (Beta Two below the top), not Beta Two + 1.
    press("]");
    expect(currentEntry()).toBe("Beta Two");
  });

  it("[ above the first heading and ] in the last section do nothing", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    layOut();
    scrollPane(60);
    await settled();
    press("[");
    expect(pane().scrollTop).toBe(60);
    scrollPane(900);
    await settled();
    press("]");
    expect(pane().scrollTop).toBe(900);
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

  it("a failed load says so and offers Retry, rather than asking for an import", async () => {
    m.fieldManualLoad.mockRejectedValueOnce(new RavenError("io", "disk read failed"));
    mount(["/manual"]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Manual");
    expect(screen.queryByText(/Import your Field Manual/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await openNote("Bb Basics");
  });

  it("an import with no notes shows the empty state", async () => {
    m.fieldManualLoad.mockResolvedValue(snapshot([]));
    mount(["/manual"]);
    expect(await screen.findByText("The Manual holds your Field Manual's Tools, Foundations and Reporting notes.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Note" })).toBeNull();
  });
});

describe("Manual: loading and layout", () => {
  it("loading line after 300ms, never before", async () => {
    m.fieldManualLoad.mockReturnValue(new Promise(() => {}));
    mount(["/manual"]);
    await screen.findByRole("main", { name: "Manual" });
    expect(screen.queryByText("Opening the Manual…")).toBeNull();
    expect(await screen.findByText("Opening the Manual…", {}, { timeout: 1500 })).toHaveClass("text-muted");
  });

  it("the rail track narrows with the window", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    expect(screen.getByRole("main", { name: "Manual" }).querySelector("[class*='clamp(200px,20vw,260px)']")).not.toBeNull();
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
    expect(await screen.findByRole("button", { name: "Host zzweb01" })).toBeInTheDocument();
    expect(await pre("zzscan -t 198.51.100.21")).toBeInTheDocument();
  });

  it("switching the host refills the command, and ⌘↵ logs to the chosen host", async () => {
    const user = userEvent.setup();
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount([`/manual/${TOOL.id}`]);
    await pre("zzscan -t 198.51.100.21");
    await user.click(screen.getByRole("button", { name: "Host zzweb01" }));
    await user.click(await screen.findByRole("option", { name: /zzdb02/ }));
    expect(await pre("zzscan -t 198.51.100.22")).toBeInTheDocument();
    expect(screen.getByTestId("manual-host-ip")).toHaveTextContent("198.51.100.22");
    const group = await screen.findByRole("group", { name: "Note command: Usage: zzscan -t {TARGET_IP}" });
    act(() => group.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      engagementId: "e1", host: expect.objectContaining({ id: "h2" }), command: "zzscan -t 198.51.100.22",
    })));
  });

  it("the status slot clears when the host changes, and never squeezes the host's IP", async () => {
    const user = userEvent.setup();
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount([`/manual/${TOOL.id}`]);
    await pre("zzscan -t 198.51.100.21");
    act(() => useManualStatus.getState().set("Copied for zzweb01", "ok"));
    expect(await screen.findByText("Copied for zzweb01")).toBeInTheDocument();
    // The IP keeps its own track; the slot is the one that truncates.
    const row = screen.getByTestId("manual-host-ip").parentElement!;
    expect(row.className).toMatch(/grid-cols-\[max-content_max-content_minmax\(0,1fr\)\]/);
    expect(screen.getByTestId("manual-host-ip")).not.toHaveClass("truncate");
    expect(screen.getByText("Copied for zzweb01")).toHaveClass("truncate", "min-w-0");
    await user.click(screen.getByRole("button", { name: "Host zzweb01" }));
    await user.click(await screen.findByRole("option", { name: /zzdb02/ }));
    expect(await pre("zzscan -t 198.51.100.22")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Copied for zzweb01")).not.toBeInTheDocument());
    expect(useManualStatus.getState().text).toBeNull();
  });

  it("⌥H opens the host picker", async () => {
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount([`/manual/${TOOL.id}`]);
    await pre("zzscan -t 198.51.100.21");
    press("˙", { altKey: true, code: "KeyH" });
    expect(await screen.findByRole("option", { name: /zzdb02/ })).toBeInTheDocument();
  });

  it("⌥H with the Arsenal drawer open over the Manual opens the drawer's host picker, not the Manual's", async () => {
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount([`/manual/${TOOL.id}`]);
    await pre("zzscan -t 198.51.100.21");
    act(() => useArsenalStore.setState({ open: true }));
    const drawer = await screen.findByRole("complementary", { name: "Arsenal" });
    await within(drawer).findByRole("button", { name: /^(Host |No host)/ });
    press("˙", { altKey: true, code: "KeyH" });
    expect(await within(drawer).findByRole("listbox", { name: "Fill for host" })).toBeInTheDocument();
    expect(screen.getAllByRole("listbox", { name: "Fill for host" })).toHaveLength(1);
    const manualChip = within(screen.getByRole("main", { name: "Manual" })).getByRole("button", { name: /^(Host |No host)/ });
    expect(manualChip).not.toHaveAttribute("aria-expanded", "true");
  });

  it("no engagement: says so, and commands keep their placeholders", async () => {
    mount([`/manual/${TOOL.id}`]);
    expect(await screen.findByText("No active engagement")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Host |No host)/ })).toBeNull();
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
  });

  it("M from elsewhere puts focus in the note pane", async () => {
    mount();
    await ready();
    press("m");
    await openNote("Bb Basics");
    await waitFor(() => expect(pane()).toHaveFocus());
  });

  it("the title-bar button puts focus in the note pane", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await ready());
    await openNote("Bb Basics");
    await waitFor(() => expect(pane()).toHaveFocus());
  });

  it("↵ in the rail opens the note and keeps focus in the rail", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("/");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await openNote("Zz Errors");
    expect(rail().getByRole("button", { name: "Zz Errors" })).toHaveFocus();
  });

  it("] and an outline pick focus the section's heading, so Tab continues from it", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    layOut();
    press("]");
    const alpha = screen.getByRole("heading", { name: "Alpha" });
    expect(alpha).toHaveFocus();
    expect(alpha).toHaveAttribute("tabindex", "-1");
    const outline = within(screen.getByRole("navigation", { name: "On this page" }));
    press("]");
    await user.click(outline.getByRole("button", { name: /^Table 1/ }));
    expect(document.getElementById("table-1")).toHaveFocus();
  });

  it("a link to a heading in another note focuses that heading", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    await user.click(screen.getByRole("link", { name: "the errors" }));
    await openNote("Zz Errors");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Core Concept" })).toHaveFocus());
  });

  it("the hint line lists ⌘↵ copy and log with a host", async () => {
    withEngagement();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount(["/manual"]);
    await openNote("Bb Basics");
    await user0().click(rail().getByRole("button", { name: "Aa Tool" }));
    await openNote("Aa Tool");
    const hints = within(screen.getByRole("group", { name: "Manual shortcuts" }));
    expect(await hints.findByText("copy and log")).toBeInTheDocument();
    expect(hints.queryByText("log (no host)")).toBeNull();
  });

  it("with no engagement the ⌘↵ hint says there is no host to log to", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    await user0().click(rail().getByRole("button", { name: "Aa Tool" }));
    await openNote("Aa Tool");
    const hints = within(screen.getByRole("group", { name: "Manual shortcuts" }));
    expect(hints.getByText("log (no host)")).toBeInTheDocument();
    expect(hints.queryByText("copy and log")).toBeNull();
  });
});

const CARDY = parseNote("03-Tools/Cc Card.md", "# Cc Card\nSee [[Some-Card]].\n")!;
const INLINEY = parseNote("03-Tools/Dd Inline.md", "# Dd Inline\nRun `zzscan -t {TARGET_IP}` now.\n")!;

describe("Manual: focus follows intent, one Tab stop, hints", () => {
  it("filter Enter opens the first match and focuses the note", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("/");
    await user.keyboard("err{Enter}");
    await openNote("Zz Errors");
    await waitFor(() => expect(pane()).toHaveFocus());
  });

  it("filter Enter on the open note still focuses the note", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("/");
    await user.keyboard("bb{Enter}");
    await waitFor(() => expect(pane()).toHaveFocus());
  });

  it("the pane focus cue is the host row's hairline, not an inset frame", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    expect(pane().className).not.toMatch(/shadow-\[inset/);
    const row = document.querySelector("[data-host-row]") as HTMLElement;
    expect(row.className).toMatch(/data-\[pane-focused\]:border-accent/);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(row).not.toHaveAttribute("data-pane-focused");
    act(() => pane().focus());
    expect(row).toHaveAttribute("data-pane-focused");
    act(() => (screen.getByRole("searchbox", { name: "Filter the Manual" }) as HTMLElement).focus());
    expect(row).not.toHaveAttribute("data-pane-focused");
  });

  it("a card link's drawer closes on the first Esc, back on the note", async () => {
    const user = userEvent.setup();
    m.fieldManualLoad.mockResolvedValue({
      ...snapshot([...NOTES, CARDY]),
      cards: [{ id: "some-card", title: "Some Card", stage: "initial-foothold", category: "Active-Directory", os: "windows", file: "02-Cards/AD/Some-Card.md" }],
    } as FieldManualSnapshot);
    mount([`/manual/${CARDY.id}`]);
    await openNote("Cc Card");
    await user.click(screen.getByRole("button", { name: "Some Card" }));
    expect(useArsenalStore.getState()).toMatchObject({ open: true, cardId: "some-card" });
    press("Escape");
    expect(useArsenalStore.getState().open).toBe(false);
    expect(where()).toBe(`/manual/${CARDY.id}`);
  });

  it("a card opened from elsewhere still steps back inside the drawer first", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    act(() => useArsenalStore.getState().openCard("some-card"));
    press("Escape");
    expect(useArsenalStore.getState()).toMatchObject({ open: true, cardId: null });
  });

  it("a command block is one Tab stop: its Copy button is out of the order, ↵ still copies", async () => {
    const user = userEvent.setup();
    mount([`/manual/${TOOL.id}`]);
    const block = await screen.findByRole("group", { name: /Note command/ });
    const copy = within(block).getByRole("button", { name: /Copy command/ });
    expect(copy).toHaveAttribute("tabindex", "-1");
    act(() => block.focus());
    await user.tab();
    expect(copy).not.toHaveFocus();
    act(() => block.focus());
    const click = vi.fn();
    copy.addEventListener("click", click);
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalled();
  });

  it("⌘[ with no history says so in the status slot", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    press("[", { metaKey: true });
    expect(await screen.findByText("No previous note")).toBeInTheDocument();
    // A neutral aside, not the accent a copy's confirm uses.
    expect(screen.getByText("No previous note")).toHaveClass("text-muted");
    expect(screen.getByText("No previous note")).not.toHaveClass("text-accent");
  });

  it("the hint line keeps five; [ ] and ⌥H stay, / and ⌘[ wait in the ? list", async () => {
    const user = userEvent.setup();
    mount([`/manual/${TOOL.id}`]);
    await openNote("Aa Tool");
    const line = within(screen.getByRole("group", { name: "Manual shortcuts" }));
    for (const label of ["copy command", "log (no host)", "section", "host", "back"]) expect(line.getByText(label)).toBeInTheDocument();
    expect(line.queryByText("filter")).toBeNull();
    expect(line.queryByText("previous note")).toBeNull();
    await user.click(screen.getByRole("button", { name: "All shortcuts" }));
    const list = within((await screen.findByText("focus the note")).closest("[role=dialog]") as HTMLElement);
    expect(list.getByText("filter")).toBeInTheDocument();
    expect(list.getByText("previous note")).toBeInTheDocument();
  });

  it("a note with no commands drops the copy hints; / and ⌘[ take their slots", async () => {
    mount(["/manual"]);
    await openNote("Bb Basics");
    const hints = within(screen.getByRole("group", { name: "Manual shortcuts" }));
    for (const label of ["section", "host", "filter", "previous note", "back"]) expect(hints.getByText(label)).toBeInTheDocument();
    expect(hints.queryByText("copy command")).toBeNull();
    expect(hints.queryByText(/copy and log|log \(no host\)/)).toBeNull();
  });

  it("a note with a code block or an inline command keeps the copy hints", async () => {
    mount([`/manual/${TOOL.id}`]);
    await openNote("Aa Tool");
    let hints = within(screen.getByRole("group", { name: "Manual shortcuts" }));
    expect(hints.getByText("copy command")).toBeInTheDocument();
    cleanup();
    m.fieldManualLoad.mockResolvedValue(snapshot([...NOTES, INLINEY]));
    mount([`/manual/${INLINEY.id}`]);
    await openNote("Dd Inline");
    hints = within(screen.getByRole("group", { name: "Manual shortcuts" }));
    expect(hints.getByText("copy command")).toBeInTheDocument();
  });

  it("the ? list adds M and ⌥↓ ⌥↑, and single-character caps share one width", async () => {
    const user = userEvent.setup();
    mount(["/manual"]);
    await openNote("Bb Basics");
    await user.click(screen.getByRole("button", { name: "All shortcuts" }));
    const list = (await screen.findByText("focus the note")).closest("[role=dialog]") as HTMLElement;
    expect(within(list).getByText("M")).toBeInTheDocument();
    expect(within(list).getByText("next / previous match")).toBeInTheDocument();
    expect(within(list).getByText("⌥↓")).toBeInTheDocument();
    const caps = [...list.querySelectorAll("kbd")].filter((k) => (k.textContent ?? "").length === 1);
    expect(caps.length).toBeGreaterThan(2);
    for (const k of caps) {
      expect(k.className).toBe(caps[0]!.className);
      expect(k.className).not.toMatch(/w-full|stretch/);
    }
  });
});
