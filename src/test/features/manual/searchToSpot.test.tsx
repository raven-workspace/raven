import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import type { FieldManualSnapshot } from "../../../engines/fieldManual/merge";
import { setImported } from "../../../engines/library/store";
import type { LibraryCommand } from "../../../engines/library/types";
import { parseNote, type ManualNote } from "../../../engines/manual";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { useLogEntryStore } from "../../../features/capture/useLogEntryStore";
import { useManualStore } from "../../../features/manual/useManualStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { api } from "../../../lib/api";
import { copyPlain } from "../../../lib/clipboard";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";

vi.mock("../../../lib/api");
vi.mock("../../../lib/clipboard", () => ({ copyPlain: vi.fn(() => Promise.resolve()), copySecret: vi.fn(() => Promise.resolve()) }));
const m = vi.mocked(api, true);

// Synthetic fixtures only: invented note names and bodies.
const ERRORS = parseNote("04-Foundations/Zz-Errors.md", [
  "# Zz Errors",
  "## Core Concept",
  "An access denied error means the login worked.",
  "**Table 1 — Zz status codes**",
  "| Error | Means |",
  "| --- | --- |",
  "| `STATUS_ACCESS_DENIED` | Authenticated, not allowed |",
  "## Try",
  "```bash",
  "zzcheck --why access_denied",
  "```",
].join("\n"))!;
const OTHER = parseNote("04-Foundations/Aa Other.md", "# Aa Other\nNothing here.\n")!;
const LINKED = parseNote("04-Foundations/Zz Linked.md", "# Zz Linked\n## One\nplain words\n## Two\nUse [[Aa Other|zz roast]] here, zz roast again.\n")!;
const NOTES: ManualNote[] = [OTHER, ERRORS, LINKED];
const ZZCMD: LibraryCommand = {
  id: "zz-denied", title: "Zz access denied probe", tool: "zzprobe", template: "zzprobe {TARGET_IP}", os: "any", runFrom: "attacker", goals: [], source: "field-manual",
};

const snapshot = (notes: ManualNote[]): FieldManualSnapshot => ({
  importedAt: 1, cards: [], overlay: {}, added: [ZZCMD], playbook: [], toolkit: [], report: {} as FieldManualSnapshot["report"], notes,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function mount(entries: string[] = ["/"]) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId("where").textContent;
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });
const altDown = () => press("∂", { code: "ArrowDown", altKey: true });
const altUp = () => press("∂", { code: "ArrowUp", altKey: true });
const pane = () => screen.getByRole("region", { name: "Note" });
const marks = () => [...pane().querySelectorAll<HTMLElement>("mark[data-match]")];
const current = () => pane().querySelectorAll<HTMLElement>("mark[data-current]");
const cmdK = "{Meta>}k{/Meta}";

// RFC 5737 addresses, invented names.
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};

/** A stand-in for `document.fonts` (jsdom has none): the web fonts start and finish loading when the test says. */
function fakeFonts() {
  const set = Object.assign(new EventTarget(), { status: "loaded" as FontFaceSetLoadStatus });
  Object.defineProperty(document, "fonts", { value: set, configurable: true });
  const fire = (status: FontFaceSetLoadStatus, type: string) => act(() => {
    set.status = status;
    set.dispatchEvent(new Event(type));
  });
  return { loading: () => fire("loading", "loading"), done: () => fire("loaded", "loadingdone") };
}

let scrolled: Element[] = [];
const scrollSpy = vi.fn(function (this: Element) {
  scrolled.push(this);
});

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  scrolled = [];
  Element.prototype.scrollIntoView = scrollSpy as unknown as Element["scrollIntoView"];
  useManualStore.setState({ place: null, history: [] });
  useLogEntryStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null });
  usePayloadsStore.setState({ open: false });
  useNotesStore.setState({ open: false });
  setImported({ commands: [ZZCMD], cards: [] });
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
afterEach(() => {
  setImported({ commands: [], cards: [] });
  // jsdom has no scrollIntoView or document.fonts of its own.
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  delete (document as { fonts?: FontFaceSet }).fonts;
});

const ready = () => screen.findByRole("button", { name: "Manual" });

describe("⌘K finds Manual text", () => {
  it("Manual hits come after commands under a Manual label, with the matching line", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "access denied");
    const list = screen.getByRole("listbox", { name: "Results" });
    const manual = await within(list).findByRole("group", { name: "Manual" });
    const groups = within(list).getAllByRole("group");
    expect(groups.at(-1)).toBe(manual);
    expect(within(groups[0]!).getAllByRole("option")[0]).toHaveTextContent("Zz access denied probe");
    const [row] = within(manual).getAllByRole("option");
    expect(row).toHaveTextContent("Zz Errors");
    expect(row).toHaveTextContent("An access denied error means the login worked.");
  });

  it("↵ on a Manual hit opens the note with the query", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "STATUS_ACCESS");
    const manual = await screen.findByRole("group", { name: "Manual" });
    await user.click(within(manual).getAllByRole("option")[0]!);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    await screen.findByRole("article", { name: "Zz Errors" });
    expect(where()).toBe(`/manual/${ERRORS.id}?q=STATUS_ACCESS`);
    expect(copyPlain).not.toHaveBeenCalled();
  });

  it("an empty list is one line that says the Manual was searched too", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.keyboard(cmdK);
    const search = await screen.findByRole("combobox", { name: "Search" });
    await user.type(search, "zzprobe");
    expect(await screen.findByRole("option", { name: /Zz access denied probe/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Nothing matches/)).toBeNull();
    await user.clear(search);
    await user.type(search, "zz-nowhere-at-all");
    expect(await screen.findByText("Nothing matches, the Manual included")).toBeInTheDocument();
    expect(screen.queryByText("Nothing matches")).toBeNull();
    expect(screen.queryByText("No match in the Manual")).toBeNull();
    expect(screen.queryByRole("group", { name: "Manual" })).toBeNull();
  });

  it("on a Manual row the hints drop copy-and-log and in-card", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "STATUS_ACCESS");
    await screen.findByRole("group", { name: "Manual" });
    const hints = screen.getByLabelText("Search shortcuts");
    expect(hints).toHaveTextContent("open note");
    expect(hints).not.toHaveTextContent("copy and log");
    expect(hints).not.toHaveTextContent("in card");
  });

  it("a hit in a link label: ⌘K shows the label as the note does, and the note marks it current", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zz roast");
    const [row] = within(await screen.findByRole("group", { name: "Manual" })).getAllByRole("option");
    expect(row).toHaveTextContent("Use zz roast here, zz roast again.");
    await user.keyboard("{Enter}");
    await screen.findByRole("article", { name: "Zz Linked" });
    await waitFor(() => expect(current()).toHaveLength(1));
    expect(marks()).toHaveLength(2);
    expect(current()[0]!.closest("a")).not.toBeNull();
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent("match 1 of 2");
  });
});

describe("the note at the match", () => {
  const open = () => mount(["/", `/manual/${ERRORS.id}?q=access%20denied#table-1`]);

  it("the match in the table cell is current and scrolled into view; the others are marked quietly", async () => {
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(marks()).toHaveLength(3));
    const cur = current();
    expect(cur).toHaveLength(1);
    expect(cur[0]).toHaveTextContent("ACCESS_DENIED");
    expect(cur[0]!.closest("td")).not.toBeNull();
    expect(scrolled).toContain(cur[0]);
    const bar = screen.getByRole("status", { name: "Search in this note" });
    expect(bar).toHaveTextContent("access denied");
    expect(bar).toHaveTextContent("match 2 of 3");
  });

  it("match in a table lights its row", async () => {
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    const rows = () => [...pane().querySelectorAll("tr[data-current-row]")];
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toBe(current()[0]!.closest("tr"));
    expect(rows()[0]).toHaveAttribute("data-row", "0");
    expect(rows()[0]!.closest("[data-table]")).toHaveAttribute("data-table", "table-1");
    altDown();
    expect(rows()).toHaveLength(0);
    altUp();
    expect(rows()).toHaveLength(1);
  });

  it("highlights the displayed code without changing what copies", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(marks()).toHaveLength(3));
    const code = marks()[2]!;
    expect(code.closest("pre")).not.toBeNull();
    expect(code).toHaveTextContent("access_denied");
    await user.click(screen.getByRole("button", { name: /^Copy command/ }));
    await waitFor(() => expect(copyPlain).toHaveBeenCalledWith("zzcheck --why access_denied"));
  });

  it("⌥↓ and ⌥↑ move the current match and wrap", async () => {
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    const bar = screen.getByRole("status", { name: "Search in this note" });
    altDown();
    expect(bar).toHaveTextContent("match 3 of 3");
    expect(current()[0]).toBe(marks()[2]);
    expect(scrolled.at(-1)).toBe(marks()[2]);
    altDown();
    expect(bar).toHaveTextContent("match 1 of 3");
    altUp();
    expect(bar).toHaveTextContent("match 3 of 3");
  });

  it("the landing focuses the block holding the current match; ⌥↓ moves focus with the match", async () => {
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    const block = (el: Element) => el.closest("article > *");
    await waitFor(() => expect(document.activeElement).toBe(block(current()[0]!)));
    expect(document.activeElement?.querySelector("table")).not.toBeNull();
    altDown();
    expect(document.activeElement).toBe(block(marks()[2]!));
  });

  it("a ⌘K hit lands with focus on the match's block, not back where the palette opened", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "STATUS_ACCESS");
    await screen.findByRole("group", { name: "Manual" });
    await user.keyboard("{Enter}");
    const article = await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(current()[0]!.closest("article > *")));
    expect(article.contains(document.activeElement)).toBe(true);
  });

  it("⌥↓ with a drawer open does nothing", async () => {
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    useArsenalStore.setState({ open: true });
    altDown();
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent("match 2 of 3");
    useArsenalStore.setState({ open: false });
  });

  it("Esc clears the match bar first, then leaves", async () => {
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    press("Escape");
    await waitFor(() => expect(where()).toBe(`/manual/${ERRORS.id}`));
    expect(screen.queryByRole("status", { name: "Search in this note" })).toBeNull();
    expect(marks()).toHaveLength(0);
    press("Escape");
    await waitFor(() => expect(where()).toBe("/"));
  });

  // RAV-50: late layout moves the match after the landing centred it; the page centres it again once the note settles.
  it("web fonts that finish loading after the landing put the current match back in the middle", async () => {
    const fonts = fakeFonts();
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    fonts.loading();
    scrolled = [];
    fonts.done();
    expect(scrolled).toEqual([current()[0]]);
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent("match 2 of 3");
  });

  it("exam rules and fill data that arrive after the landing put the current match back in the middle", async () => {
    let release: (v: Engagement[]) => void = () => {};
    m.engagementsList.mockReturnValue(new Promise((r) => (release = r)));
    m.engagementGet.mockResolvedValue(E1);
    m.hostsList.mockResolvedValue([]);
    m.servicesListEngagement.mockResolvedValue([]);
    m.tunnelsList.mockResolvedValue([]);
    m.credentialsList.mockResolvedValue([]);
    m.credAttemptsList.mockResolvedValue([]);
    m.logList.mockResolvedValue([]);
    useLastEngagementStore.setState({ engagementId: "e1", hostId: null });
    open();
    await screen.findByRole("article", { name: "Zz Errors" });
    await waitFor(() => expect(current()).toHaveLength(1));
    scrolled = [];
    await act(async () => release([E1]));
    await waitFor(() => expect(scrolled).toContain(current()[0]));
  });

  it("no match in this note says so", async () => {
    mount(["/", `/manual/${OTHER.id}?q=access%20denied`]);
    await screen.findByRole("article", { name: "Aa Other" });
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent("No match in this note");
  });
});

describe("⌘K and the opened note agree (RAV-20)", () => {
  const SPLIT = parseNote("04-Foundations/Zz Split.md", [
    "# Zz Split",
    "## Gate",
    "The zzgate said zzaccess **zzdenied** twice.",
    "```bash",
    "zzscan --zzloud -t {ZZRHOST}",
    "```",
  ].join("\n"))!;
  beforeEach(() => m.fieldManualLoad.mockResolvedValue(snapshot([...NOTES, SPLIT])));

  const search = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
    mount();
    await ready();
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), query);
  };

  it("a phrase across bold is found, and the opened note marks it as one continuous match", async () => {
    const user = userEvent.setup();
    await search(user, "zzaccess zzdenied");
    const [row] = within(await screen.findByRole("group", { name: "Manual" })).getAllByRole("option");
    expect(row).toHaveTextContent("The zzgate said zzaccess zzdenied twice.");
    await user.keyboard("{Enter}");
    await screen.findByRole("article", { name: "Zz Split" });
    await waitFor(() => expect(current()).toHaveLength(2));
    expect(marks().map((el) => [el.textContent, el.dataset.match])).toEqual([["zzaccess ", "start"], ["zzdenied", "cont"]]);
    expect(marks()[1]!.closest("strong")).not.toBeNull();
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent("match 1 of 1");
  });

  it("a placeholder's name alone finds nothing; text beside it opens the note on a match", async () => {
    const user = userEvent.setup();
    await search(user, "zzrhost");
    expect(await screen.findByText("Nothing matches, the Manual included")).toBeInTheDocument();
    await user.clear(screen.getByRole("combobox", { name: "Search" }));
    await user.type(screen.getByRole("combobox", { name: "Search" }), "zzloud");
    const [row] = within(await screen.findByRole("group", { name: "Manual" })).getAllByRole("option");
    expect(row).toHaveTextContent("zzscan --zzloud -t {ZZRHOST}");
    await user.keyboard("{Enter}");
    await screen.findByRole("article", { name: "Zz Split" });
    await waitFor(() => expect(current()).toHaveLength(1));
    expect(screen.getByRole("status", { name: "Search in this note" })).not.toHaveTextContent("No match in this note");
  });
});
