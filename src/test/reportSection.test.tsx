import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api, resetAuditState } from "../audit/fakeApi";
import { ReportSectionView } from "../features/report/ReportSection";
import { pruneRemoved } from "../features/report/queries";
import { DRAFT_LAYOUT } from "../engines/report";
import { discardReports } from "../features/report/saveQueue";
import { ReportTabs, type TabItem } from "../features/report/ReportTabs";
import { CheckList, TodoPanel } from "../features/report/TodoPanel";
import { makeQueryClient } from "../lib/queryClient";
import type { LogContent, LogEntryInput } from "../types/log";
import type { ReportDoc } from "../types/report";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

// The real editor, with a handle on its instance so a test can type into the page.
const editors: Editor[] = [];
vi.mock("../features/report/editor/ReportEditor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../features/report/editor/ReportEditor")>();
  return {
    ...real,
    ReportEditor: (props: ComponentProps<typeof real.ReportEditor>) => (
      <real.ReportEditor
        {...props}
        onReady={(e) => {
          editors.push(e);
          props.onReady(e);
        }}
      />
    ),
  };
});

// The audit fixture's report holds two owner-written pages; these tests start from a report without them.
beforeEach(async () => {
  for (const s of await api.reportSectionsList("rep-exam")) if (s.kind === "page") await api.reportSectionDelete("rep-exam", s.id);
});

afterEach(() => {
  discardReports();
  vi.restoreAllMocks();
  vi.useRealTimers();
  editors.length = 0;
  resetAuditState();
});

function mount(eid = "e-exam", qc: QueryClient = makeQueryClient()) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[`/e/${eid}/s/report`]}>
          <Routes>
            <Route path="/e/:id/s/:section" element={<ReportSectionView />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

const tabRow = () => screen.getByRole("tablist", { name: "Report pages" });
const tabEls = () => within(tabRow()).getAllByRole("tab");
const labelOf = (t: HTMLElement) => t.querySelector("[data-tab-label]")?.textContent ?? "";
const tabLabels = () => tabEls().map(labelOf);
/** The target tabs, numbered in grading order ("1 lnx02", "5 AD set"). */
const targetRows = () => tabEls().filter((t) => /^\d+ /.test(labelOf(t)));
const targetLabels = () => targetRows().map(labelOf);
const tab = (label: string) => tabEls().find((t) => labelOf(t) === label)!;
const rowFor = (name: string) => targetRows().find((t) => labelOf(t).replace(/^\d+ /, "") === name)!;
/** Opens a part of Front matter or Closing: the tab, then the part in its segmented row. */
const openPart = (group: "Front matter" | "Closing", part: RegExp) => {
  fireEvent.click(tab(group));
  fireEvent.click(within(screen.getByRole("tablist", { name: `${group} parts` })).getByRole("tab", { name: part }));
};
const TARGETS = ["1 lnx02", "2 ms01", "3 web01", "4 xfer03", "5 AD set"];
/** Opens the To do panel from the strip (unless it is open) and returns its checks. */
const openTodo = () => {
  if (!screen.queryByRole("region", { name: "To do" })) fireEvent.click(screen.getByRole("button", { name: /^To do/ }));
  return within(screen.getByRole("region", { name: "To do" })).getByRole("list", { name: "Checks" });
};

async function ready() {
  await waitFor(() => expect(targetRows().length).toBeGreaterThan(0));
}

const LNX_ID = "h-exam-lnx";
type UpsertInput = { targetKey: string | null; draftBuiltAt: number | null };
const draftUpserts = (spy: { mock: { calls: unknown[][] } }, targetKey: string) =>
  spy.mock.calls.filter((call) => {
    const input = call[1] as UpsertInput;
    return input.targetKey === targetKey && input.draftBuiltAt !== null;
  });

describe("Report view", () => {
  it("lists the targets in grading order with the AD set last, and names the file from the OSID", async () => {
    mount();
    await ready();
    await waitFor(() => expect(targetLabels()).toEqual(TARGETS));
    expect(screen.getByRole("group", { name: "Report OSCP-OS-48213-Exam-Report.pdf" })).toBeInTheDocument();

    openPart("Front matter", /Details/);
    const osid = await screen.findByLabelText("OSID");
    fireEvent.change(osid, { target: { value: "os-1" } });
    fireEvent.blur(osid);
    expect(await screen.findByRole("group", { name: "Report OSCP-OS-?????-Exam-Report.pdf" })).toBeInTheDocument();
  });

  it("shows a tab row in grading order: Front matter first, the targets, then Closing", async () => {
    mount();
    await ready();
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "Closing"]));
    // The first target is open, and only it is in the tab order (roving tabindex).
    expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true");
    expect(tabEls().filter((t) => t.tabIndex === 0)).toEqual([rowFor("lnx02")]);
    // Each tab says where it stands; a target with failing checks shows its count.
    const stateOf = (t: HTMLElement) => t.querySelector("[data-tab-state]")?.textContent;
    expect(stateOf(tab("Front matter"))).toBe("ready");
    expect(stateOf(rowFor("lnx02"))).toBe("not started");
    expect(stateOf(rowFor("ms01"))).toBe("ready");
    // + Page sits after the tabs, outside the tablist.
    expect(screen.getByRole("button", { name: "+ Page" })).toBeInTheDocument();
    expect(tabRow()).not.toContainElement(screen.getByRole("button", { name: "+ Page" }));
  });

  it("the selected tab is scrolled into view", async () => {
    const into = vi.spyOn(Element.prototype, "scrollIntoView");
    mount();
    await ready();
    into.mockClear();
    fireEvent.click(rowFor("AD set"));
    await waitFor(() => expect(into.mock.contexts).toContain(rowFor("AD set")));
    const call = into.mock.calls[into.mock.contexts.indexOf(rowFor("AD set"))];
    expect(call[0]).toEqual({ block: "nearest", inline: "nearest" });
  });

  it("←/→ move focus along the tab row and ↵ opens the focused tab", async () => {
    mount();
    await ready();
    rowFor("lnx02").focus();
    fireEvent.keyDown(rowFor("lnx02"), { key: "ArrowRight", code: "ArrowRight" });
    expect(document.activeElement).toBe(rowFor("ms01"));
    expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(rowFor("ms01"), { key: "Enter", code: "Enter" });
    await waitFor(() => expect(rowFor("ms01")).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(rowFor("ms01"), { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("Front matter"));
  });

  it("clicking '3 to do' opens the To do panel with that target's checks; a check click focuses its block", async () => {
    // lnx02 has a long scan on its page and none of its flags: failing checks to do.
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(editors.length).toBe(2));
    expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
    const state = rowFor("lnx02").querySelector<HTMLElement>("[data-tab-state]")!;
    expect(state.textContent).toMatch(/^\d+ to do$/);
    expect(state).toHaveClass("text-warn");
    fireEvent.click(state);
    const panel = await screen.findByRole("region", { name: "To do" });
    await waitFor(() => expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true"));
    const checks = within(panel).getByRole("list", { name: "Checks" });
    expect(within(checks).getByText("2 flags are not on the page")).toBeInTheDocument();
    // lnx02's expected flags are set in the panel too.
    expect(within(panel).getByRole("group", { name: "Expected flags" })).toBeInTheDocument();
    await waitFor(() => expect(editors.length).toBe(3));
    fireEvent.click(within(checks).getByText("Long block (80 lines of output)"));
    await waitFor(() => expect(pageEditor().state.selection instanceof NodeSelection).toBe(true));
    expect(pageEditor().view.hasFocus() || pageEditor().view.dom.contains(document.activeElement)).toBe(true);
    // Esc in the panel closes it.
    fireEvent.keyDown(within(panel).getByRole("button", { name: "Close To do" }), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "To do" })).toBeNull());
  });

  it("the strip's To do opens the panel with focus in it; Esc and Close To do hand focus back to the button", async () => {
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    const button = screen.getByRole("button", { name: /^To do/ });
    // Keyboard activation: focus the button, then press it.
    button.focus();
    fireEvent.click(button);
    const panel = await screen.findByRole("region", { name: "To do" });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    // Its first check has focus, so the arrows and Esc work at once.
    expect(within(panel).getByRole("list", { name: "Checks" }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "To do" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^To do/ }));

    fireEvent.click(screen.getByRole("button", { name: /^To do/ }));
    const again = await screen.findByRole("region", { name: "To do" });
    fireEvent.click(within(again).getByRole("button", { name: "Close To do" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "To do" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^To do/ }));
  });

  it("closing the panel opened from a tab's N to do hands focus back to that tab", async () => {
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    fireEvent.click(rowFor("lnx02").querySelector<HTMLElement>("[data-tab-state]")!);
    const panel = await screen.findByRole("region", { name: "To do" });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "To do" })).toBeNull());
    expect(document.activeElement).toBe(rowFor("lnx02"));
  });

  it("an empty To do panel takes focus itself, so Esc still closes it", async () => {
    mount();
    await ready();
    fireEvent.click(tab("Closing"));
    const button = screen.getByRole("button", { name: /^To do/ });
    button.focus();
    fireEvent.click(button);
    const panel = await screen.findByRole("region", { name: "To do" });
    expect(within(panel).getByText("Nothing to do on this tab")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(panel));
    fireEvent.keyDown(panel, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "To do" })).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("the strip's To do on a tab with nothing to do lists the tabs that still have checks; each opens its tab", async () => {
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(tab("Closing")).toBeDefined());
    fireEvent.click(tab("Closing"));
    const strip = screen.getByRole("button", { name: /^To do/ });
    expect(strip.textContent).toMatch(/[1-9]/);
    fireEvent.click(strip);
    const panel = await screen.findByRole("region", { name: "To do" });
    expect(within(panel).getByText("Nothing to do on this tab")).toBeInTheDocument();
    expect(within(panel).queryByText("No gaps")).toBeNull();
    const others = within(panel).getByRole("list", { name: "Tabs with checks" });
    const go = within(others).getByRole("button", { name: /lnx02/ });
    expect(go.tagName).toBe("BUTTON");
    // Keyboard reachable: a real button, in tab order.
    expect(go).not.toHaveAttribute("tabindex", "-1");
    fireEvent.click(go);
    await waitFor(() => expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true"));
    // The panel stays open on that tab's own checks, with focus in it so Esc still closes it.
    const checks = within(screen.getByRole("region", { name: "To do" })).getByRole("list", { name: "Checks" });
    await waitFor(() => expect(within(checks).getByText("2 flags are not on the page")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("region", { name: "To do" }).contains(document.activeElement)).toBe(true));
  });

  it("an open tab with no checks and no to do anywhere says only that", () => {
    render(<TodoPanel checks={[]} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Nothing to do on this tab")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tabs with checks" })).toBeNull();
  });

  it("Front matter's segmented row switches between Details, Introduction, Summary, Considerations, Methodology", async () => {
    mount();
    await ready();
    fireEvent.click(tab("Front matter"));
    const parts = () => within(screen.getByRole("tablist", { name: "Front matter parts" })).getAllByRole("tab");
    expect(parts().map((p) => p.textContent)).toEqual(["Details", "1 Introduction", "2 Summary", "Testing considerations", "3 Methodology"]);
    expect(parts()[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("OSID")).toBeInTheDocument();
    fireEvent.click(parts()[1]);
    const h1 = () => within(document.querySelector<HTMLElement>(".report-page")!).queryByRole("heading", { level: 1 })?.textContent;
    await waitFor(() => expect(h1()).toBe("1OffSec Certified Professional Exam Report"));
    expect(parts()[1]).toHaveAttribute("aria-selected", "true");
    expect(tab("Front matter")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(parts()[4]);
    await waitFor(() => expect(h1()).toBe("3Methodologies"));
    // Away and back, Front matter opens on the part last shown.
    fireEvent.click(rowFor("lnx02"));
    fireEvent.click(tab("Front matter"));
    await waitFor(() => expect(h1()).toBe("3Methodologies"));
    // Closing holds Further information, References and the engagement's Also tested.
    fireEvent.click(tab("Closing"));
    expect(within(screen.getByRole("tablist", { name: "Closing parts" })).getAllByRole("tab").map((p) => p.textContent)).toEqual([
      "Further information",
      "References",
      // The engagement's Also tested is numbered after the targets (§5.7).
      "6 Also tested",
    ]);
  });

  it("a layout-3 target page and a layout-3 summary page both rebuild and offer Restore your previous page", async () => {
    const report = await api.reportGetOrCreate("e-exam");
    const old = (text: string) => ({ type: "doc", content: [{ type: "slot", attrs: { hint: "x" }, content: [{ type: "text", text }] }] });
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX_ID, position: 0, doc: old("Old lnx02 page") as unknown as ReportDoc, meta: { layout: 3 }, draftBuiltAt: 1 });
    await api.reportSectionUpsert(report.id, { kind: "summary", targetKey: null, position: 0, doc: old("Old summary page") as unknown as ReportDoc, meta: { layout: 3 }, draftBuiltAt: 1 });
    mount();
    await ready();
    const paper = () => document.querySelector<HTMLElement>(".report-page")!;
    await waitFor(() => expect(screen.getByText("This page was rebuilt for a new layout.")).toBeInTheDocument());
    expect(paper().textContent).not.toContain("Old lnx02 page");
    fireEvent.click(screen.getByRole("button", { name: "Restore your previous page" }));
    await waitFor(() => expect(paper().textContent).toContain("Old lnx02 page"));

    openPart("Front matter", /Summary/);
    await waitFor(() => expect(screen.getByText("This page was rebuilt for a new layout.")).toBeInTheDocument());
    await waitFor(() => expect(paper().textContent).not.toContain("Old summary page"));
    fireEvent.click(screen.getByRole("button", { name: "Restore your previous page" }));
    await waitFor(() => expect(paper().textContent).toContain("Old summary page"));
  });

  it("builds a target's draft once, on its first open", async () => {
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    mount();
    await ready();
    // The first target opens by default and gets its draft.
    await waitFor(() => expect(draftUpserts(upsert, "h-exam-lnx")).toHaveLength(1));
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));

    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(draftUpserts(upsert, "h-exam-ms01")).toHaveLength(1));
    fireEvent.click(rowFor("lnx02"));
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(editors.length).toBeGreaterThanOrEqual(3));
    expect(draftUpserts(upsert, "h-exam-lnx")).toHaveLength(1);
    expect(draftUpserts(upsert, "h-exam-ms01")).toHaveLength(1);
  });

  it("saves typed text when switching targets and when leaving mid-debounce", async () => {
    const save = vi.spyOn(api, "reportSectionSave");
    const { unmount } = mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));

    const type = (text: string) =>
      act(() => {
        const view = editors[editors.length - 1].view;
        let at = 1;
        view.state.doc.descendants((n, p) => {
          if (n.type.name === "slot" && at === 1) at = p + 1;
          return at === 1;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).insertText(text));
      });
    const savedText = () => save.mock.calls.map(([, doc]) => JSON.stringify(doc as ReportDoc));

    type("Port 22 was the way in");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(rowFor("ms01"));
    expect(savedText().some((t) => t.includes("Port 22 was the way in"))).toBe(true);

    await waitFor(() => expect(editors.length).toBe(2));
    type("Second page text");
    unmount();
    expect(savedText().some((t) => t.includes("Second page text"))).toBe(true);
  });

  it("hides a deleted host's target without errors and adds a new host's", async () => {
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    const { qc } = mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));

    await act(async () => {
      await api.hostDelete("h-exam-web");
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(targetLabels()).toEqual(["1 lnx02", "2 ms01", "3 xfer03", "4 AD set"]));

    let created = "";
    await act(async () => {
      created = (await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never)).id;
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(rowFor("files03")).toBeTruthy());
    await waitFor(() => expect(upsert.mock.calls.some(([, i]) => (i as { targetKey: string | null }).targetKey === created)).toBe(true));
    fireEvent.click(rowFor("files03"));
    await waitFor(() => expect(draftUpserts(upsert, created)).toHaveLength(1));
  });

  it("keeps a failed save queued per section and retries it until it is written", async () => {
    const real = api.reportSectionSave;
    let failA = true;
    let aId = "";
    const save = vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
      if (id === aId && failA) throw new Error("disk full");
      return real(id, doc, meta);
    });
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    aId = rowFor("lnx02").dataset.id!;
    const type = (text: string) =>
      act(() => {
        const view = editors[editors.length - 1].view;
        view.dispatch(view.state.tr.insertText(text, 1));
      });
    const warning = () => screen.queryByText(/Some typing isn't saved yet/);
    const writesOf = (id: string) => save.mock.calls.filter(([sid]) => sid === id);

    type("A text");
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(warning()).toBeInTheDocument());
    expect(writesOf(aId)).toHaveLength(1);

    // B saves fine, A is tried again and still fails: the warning stays.
    await waitFor(() => expect(editors.length).toBe(2));
    const bId = rowFor("ms01").dataset.id!;
    type("B text");
    fireEvent.click(rowFor("web01"));
    await waitFor(() => expect(writesOf(aId)).toHaveLength(2));
    expect(writesOf(bId).some(([, doc]) => JSON.stringify(doc).includes("B text"))).toBe(true);
    await act(async () => {});
    expect(warning()).toBeInTheDocument();

    // Once A's write goes through, the warning clears.
    failA = false;
    await waitFor(() => expect(editors.length).toBe(3));
    type("C text");
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(writesOf(aId).length).toBeGreaterThanOrEqual(3));
    expect(JSON.stringify(writesOf(aId).at(-1)![1])).toContain("A text");
    await waitFor(() => expect(warning()).not.toBeInTheDocument());
  });

  it("never sends a section's newer write while an older one is on its way", async () => {
    const real = api.reportSectionSave;
    let release: () => void = () => {};
    let aId = "";
    let hold = true;
    const save = vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
      if (id === aId && hold) {
        hold = false;
        await new Promise<void>((r) => (release = r));
      }
      return real(id, doc, meta);
    });
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    aId = rowFor("lnx02").dataset.id!;
    const type = (text: string) => act(() => editors[0].view.dispatch(editors[0].view.state.tr.insertText(text, 1)));
    const writesOfA = () => save.mock.calls.filter(([sid]) => sid === aId);

    type("older");
    await waitFor(() => expect(writesOfA()).toHaveLength(1));
    type("newer");
    // Switching flushes: the newer write must wait for the older one to settle.
    fireEvent.click(rowFor("ms01"));
    await act(async () => {});
    expect(writesOfA()).toHaveLength(1);

    await act(async () => release());
    await waitFor(() => expect(writesOfA()).toHaveLength(2));
    expect(JSON.stringify(writesOfA()[1][1])).toContain("newer");
  });

  it("retries a failed write after leaving the view, and warns on the Report view until it lands", async () => {
    const real = api.reportSectionSave;
    let fail = true;
    let aId = "";
    const save = vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
      if (id === aId && fail) throw new Error("disk full");
      return real(id, doc, meta);
    });
    const first = mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    aId = rowFor("lnx02").dataset.id!;
    act(() => editors[0].view.dispatch(editors[0].view.state.tr.insertText("kept text", 1)));
    const writesOfA = () => save.mock.calls.filter(([sid]) => sid === aId);
    const warning = () => screen.queryByText(/Some typing isn't saved yet/);

    // Leaving flushes; the write fails.
    first.unmount();
    await waitFor(() => expect(writesOfA()).toHaveLength(1));

    // Back on the Report view the warning still shows.
    mount();
    await ready();
    await waitFor(() => expect(warning()).toBeInTheDocument());

    // With no further typing the write is retried on its own, lands, and the warning clears.
    fail = false;
    await waitFor(() => expect(warning()).not.toBeInTheDocument(), { timeout: 4000 });
    expect(JSON.stringify(writesOfA().at(-1)![1])).toContain("kept text");
  });

  it("a draft landing after a reorder keeps the new order", async () => {
    const real = api.reportSectionUpsert;
    let release: () => void = () => {};
    vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
      if (input.targetKey === "h-exam-lnx" && input.draftBuiltAt !== null) await new Promise<void>((r) => (release = r));
      return real(rid, input);
    });
    mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));
    const first = rowFor("lnx02");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight", code: "ArrowRight", altKey: true });
    const order = ["1 ms01", "2 lnx02", "3 web01", "4 xfer03", "5 AD set"];
    await waitFor(() => expect(targetLabels()).toEqual(order));
    await act(async () => release());
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    expect(targetLabels()).toEqual(order);
  });

  it("a slower earlier report-details save never overwrites a later one", async () => {
    const real = api.reportUpdate;
    let release: () => void = () => {};
    let calls = 0;
    vi.spyOn(api, "reportUpdate").mockImplementation(async (id, patch) => {
      const saved = await real(id, patch);
      if (++calls === 1) await new Promise<void>((r) => (release = r));
      return saved;
    });
    const { qc } = mount();
    await ready();
    openPart("Front matter", /Details/);
    const osid = await screen.findByLabelText("OSID");
    fireEvent.change(osid, { target: { value: "OS-11111" } });
    fireEvent.blur(osid);
    fireEvent.change(osid, { target: { value: "OS-22222" } });
    fireEvent.blur(osid);
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    await act(async () => release());
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => {});
    expect((qc.getQueryData(["report", "e-exam"]) as { osid: string }).osid).toBe("OS-22222");
  });

  it("shows a failed section setup with Retry, keeping the tabs", async () => {
    const real = api.reportSectionUpsert;
    let fail = false;
    vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
      if (fail && input.draftBuiltAt === null) throw new Error("db busy");
      return real(rid, input);
    });
    const { qc } = mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));

    fail = true;
    await act(async () => {
      await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never);
      await qc.invalidateQueries();
    });
    expect(await screen.findByText(/Couldn't add the report's new sections/)).toBeInTheDocument();
    expect(targetRows()).toHaveLength(5);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry setting up sections" }));
    await waitFor(() => expect(rowFor("files03")).toBeTruthy());
    expect(screen.queryByText(/Couldn't add the report's new sections/)).not.toBeInTheDocument();
  });

  it("names the draft's Retry apart from the section setup's", async () => {
    const real = api.reportSectionUpsert;
    let fail = true;
    vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
      if (fail && input.draftBuiltAt !== null) throw new Error("db busy");
      return real(rid, input);
    });
    mount();
    await ready();
    expect(await screen.findByText(/Couldn't build this page's draft/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry setting up sections" })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry building the draft" }));
    await waitFor(() => expect(screen.queryByText(/Couldn't build this page's draft/)).not.toBeInTheDocument());
  });

  it("shows a placeholder for client engagements", async () => {
    mount("e-old");
    expect(await screen.findByText("Client reports come after the exam")).toBeInTheDocument();
  });

  it("⌥→ on a target tab moves it later in grading order", async () => {
    const reorder = vi.spyOn(api, "reportSectionsReorder");
    mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));
    const first = rowFor("lnx02");
    const lnxId = first.dataset.id!;
    const msId = rowFor("ms01").dataset.id!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight", code: "ArrowRight", altKey: true });
    await waitFor(() => expect(targetLabels()).toEqual(["1 ms01", "2 lnx02", "3 web01", "4 xfer03", "5 AD set"]));
    expect(reorder).toHaveBeenCalledTimes(1);
    const ids = reorder.mock.calls[0][1];
    expect(ids.indexOf(msId)).toBeLessThan(ids.indexOf(lnxId));
    expect(document.activeElement).toBe(rowFor("lnx02"));
  });
});

const LNX = "h-exam-lnx";
const logInput = (title: string, content: LogContent, at: number): LogEntryInput => ({
  title,
  ranOn: null,
  hostIds: [LNX],
  observations: null,
  returnedNothing: false,
  private: false,
  content,
  at,
});
const evNode = (entryId: string) => ({ type: "evidence", attrs: { entryId, block: 0, keep: null, emphasis: [], appendix: "inline" } });

/** lnx02's page, stored at the current layout: a foothold heading, a slot, a scan with `outputLines` lines of output, the post heading.
 *  `stepped` puts the slot and the scan in a steps list as one step, as drafts do. */
async function seedLnx(outputLines = 3, meta: Record<string, unknown> = {}, stepped = false) {
  const output = Array.from({ length: outputLines }, (_, i) => `line ${i}`).join("\n");
  const scan = await api.logCreate("e-exam", logInput("nmap scan", { kind: "command", blocks: [{ command: "nmap -sV 10.10.30.21", output }] }, 1_000));
  const report = await api.reportGetOrCreate("e-exam");
  const doc = {
    type: "doc",
    content: [
      { type: "phase", attrs: { phase: "foothold", hostId: LNX } },
      ...(stepped
        ? [{ type: "steps", content: [{ type: "step", attrs: { entryId: scan.id }, content: [{ type: "slot", attrs: { hint: "What you do next" } }, evNode(scan.id)] }] }]
        : [{ type: "slot", attrs: { hint: "What you do next" } }, evNode(scan.id)]),
      { type: "phase", attrs: { phase: "post", hostId: LNX } },
      { type: "slot", attrs: { hint: "Proof" } },
    ],
  };
  await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc as unknown as ReportDoc, meta: { layout: DRAFT_LAYOUT, ...meta }, draftBuiltAt: Date.now() });
  return scan;
}

const pageEditor = () => editors[editors.length - 1];
const evidenceIds = () => {
  const ids: string[] = [];
  pageEditor().state.doc.descendants((n) => {
    if (n.type.name === "evidence") ids.push(n.attrs.entryId as string);
  });
  return ids;
};
const appendixTab = (label: string) => within(tabRow()).findByRole("tab", { name: new RegExp(`^${label}`) });

describe("Report view: appendices and new evidence", () => {
  // Skipped by the plain-page rollout (Task 4): pages move nothing to an appendix any more, so a target has no appendix tab. Rewritten or removed with the Report view (Tasks 6 to 10).
  it.skip("Move to appendix adds an Appendix A tab; its page lists the moved block and links back", async () => {
    await seedLnx();
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    // The scan is the page's third block.
    const view = pageEditor().view;
    fireEvent.pointerDown(view.dom);
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize))));
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    expect(await screen.findByText("Full output: Appendix A.1, nmap scan")).toBeInTheDocument();
    const appendixRow = await appendixTab("Appendix A");
    expect(appendixRow).toHaveTextContent("lnx02");
    expect(appendixRow).toHaveTextContent("1 item");

    fireEvent.click(appendixRow);
    expect(await screen.findByRole("heading", { name: "Appendix A: lnx02" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A.1 nmap scan" })).toBeInTheDocument();
    expect(screen.getByText("line 2")).toBeInTheDocument();

    const before = editors.length;
    fireEvent.click(screen.getByRole("button", { name: "Referenced from lnx02" }));
    await waitFor(() => expect(editors.length).toBe(before + 1));
    expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      const sel = pageEditor().state.selection;
      expect(sel instanceof NodeSelection && sel.node.type.name === "evidence").toBe(true);
    });
  });

  // Skipped by the plain-page rollout (Task 4): the move suggestion reads long code blocks, and a page moves nothing to an appendix. Rewritten or removed with the Report view (Tasks 6 to 10).
  it.skip("a long block's soft check offers Move to appendix, which moves it", async () => {
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    const checks = openTodo();
    // The fix is offered for the picked check only.
    expect(within(checks).queryByRole("button", { name: "Move to appendix" })).toBeNull();
    fireEvent.click(within(checks).getByText("Long block (80 lines of output)"));
    // Picked, the check reads in full under its row.
    expect(within(checks).getByText(/This block is long \(80 lines of output\)/)).toBeInTheDocument();
    fireEvent.click(within(checks).getByRole("button", { name: "Move to appendix" }));
    await waitFor(() => expect(pageEditor().state.doc.child(2).attrs.appendix).toBe("moved"));
    expect(await appendixTab("Appendix A")).toBeInTheDocument();
  });

  // Skipped by the plain-page rollout (Task 4): legibility reads plain figures, which this Report view cannot render yet. Rewritten or removed with the Report view (Tasks 6 to 10).
  it.skip("flags a screenshot too narrow to print legibly once its image loads", async () => {
    const shot = await api.logCreate("e-exam", {
      ...logInput("Login page", { kind: "screenshot", attachmentId: "", caption: "Login page", fileName: "x.png" }, 500),
      attachment: { mime: "image/png", dataBase64: "AAAA" },
    } as LogEntryInput);
    await seedLnx();
    const report = await api.reportGetOrCreate("e-exam");
    const sections = await api.reportSectionsList(report.id);
    const lnx = sections.find((s) => s.targetKey === LNX)!;
    const doc = lnx.doc as unknown as { content: unknown[] };
    await api.reportSectionSave(lnx.id, { ...doc, content: [...doc.content, { ...evNode(shot.id), attrs: { ...evNode(shot.id).attrs, block: null } }] } as unknown as ReportDoc, { layout: DRAFT_LAYOUT });
    const { container } = mount();
    await ready();
    await waitFor(() => expect(container.querySelector(".report-figure img")).toBeTruthy());
    const img = container.querySelector<HTMLImageElement>(".report-figure img")!;
    Object.defineProperty(img, "naturalWidth", { value: 480 });
    fireEvent.load(img);
    const checks = openTodo();
    fireEvent.click(await within(checks).findByText("Screenshot too narrow to print"));
    expect(within(checks).getByText('The screenshot "Login page" is narrower than would print legibly. Retake it larger or crop it tighter.')).toBeInTheDocument();
  });

  it("Add new evidence appends a newly proving entry, skips removed ones, and Undo takes it off again", async () => {
    const removedFlag = await api.logCreate("e-exam", logInput("proof flag", { kind: "flag", flagKind: "proof", value: "p".repeat(32) }, 3_000));
    const scan = await seedLnx(3, { removedEntryIds: [removedFlag.id] }, true);
    const localFlag = await api.logCreate("e-exam", logInput("local flag", { kind: "flag", flagKind: "local", value: "l".repeat(32) }, 2_000));
    const save = vi.spyOn(api, "reportSectionSave");
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    expect(evidenceIds()).toEqual([scan.id]);

    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Added 1 entry")).toBeInTheDocument();
    expect(evidenceIds()).toEqual([scan.id, localFlag.id]);
    // The flag is a new step at the end of the foothold's steps list, not a block beside it.
    expect(pageEditor().state.doc.child(1).type.name).toBe("steps");
    expect(pageEditor().state.doc.child(1).childCount).toBe(2);
    await waitFor(() => expect(save.mock.calls.some(([, doc]) => JSON.stringify(doc).includes(localFlag.id))).toBe(true));

    const writes = save.mock.calls.length;
    // The notice's Undo, not the formatting toolbar's.
    fireEvent.click(within(screen.getByText("Added 1 entry").closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(evidenceIds()).toEqual([scan.id]));
    expect(pageEditor().state.doc.child(1).childCount).toBe(1);
    await waitFor(() => expect(save.mock.calls.length).toBeGreaterThan(writes));
    expect(JSON.stringify(save.mock.calls.at(-1)![1])).not.toContain(localFlag.id);
    expect(screen.queryByText("Added 1 entry")).not.toBeInTheDocument();
  });

  it("offers no Move to appendix on a report-level page", async () => {
    mount();
    await ready();
    openPart("Front matter", /Methodology/);
    await waitFor(() => expect(editors.length).toBeGreaterThan(1));
    const view = pageEditor().view;
    let pos = -1;
    view.state.doc.forEach((n, offset) => {
      if (pos === -1 && n.type.name === "generated") pos = offset;
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    fireEvent.pointerDown(view.dom);
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Move to appendix" })).toBeNull();
  });

  describe("deleting steps is remembered, so Add new evidence never brings them back", () => {
    /** lnx02 with two flag steps in one steps list, each with a written sentence. */
    async function seedSteps() {
      const local = await api.logCreate("e-exam", logInput("local flag", { kind: "flag", flagKind: "local", value: "l".repeat(32) }, 2_000));
      const proof = await api.logCreate("e-exam", logInput("proof flag", { kind: "flag", flagKind: "proof", value: "p".repeat(32) }, 3_000));
      const report = await api.reportGetOrCreate("e-exam");
      const step = (id: string, text: string) => ({ type: "step", attrs: { entryId: id }, content: [{ type: "slot", attrs: { hint: "Where" }, content: [{ type: "text", text }] }, evNode(id)] });
      const doc = {
        type: "doc",
        content: [
          { type: "phase", attrs: { phase: "foothold", hostId: LNX } },
          { type: "steps", content: [step(local.id, "Read the local flag"), step(proof.id, "Read the proof flag")] },
          { type: "phase", attrs: { phase: "post", hostId: LNX } },
          { type: "slot", attrs: { hint: "Proof" } },
        ],
      };
      await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc as unknown as ReportDoc, meta: { layout: DRAFT_LAYOUT }, draftBuiltAt: Date.now() });
      mount();
      await ready();
      await waitFor(() => expect(editors.length).toBeGreaterThan(0));
      await waitFor(() => expect(evidenceIds()).toEqual([local.id, proof.id]));
      return { local, proof };
    }
    const stepAt = (index: number) => {
      const steps: { node: import("prosekit/pm/model").Node; pos: number }[] = [];
      pageEditor().state.doc.descendants((node, pos) => {
        if (node.type.name === "step") steps.push({ node, pos });
        return true;
      });
      return steps[index];
    };
    const addNew = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
      expect(await screen.findByText("Nothing new to add")).toBeInTheDocument();
    };

    it("a step deleted from the block menu", async () => {
      const { local, proof } = await seedSteps();
      const root = document.querySelector("prosekit-block-handle-root")!;
      act(() => void root.dispatchEvent(Object.assign(new Event("stateChange"), { detail: stepAt(0) })));
      fireEvent.click(screen.getByRole("button", { name: "Block actions", hidden: true }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
      await waitFor(() => expect(evidenceIds()).toEqual([proof.id]));
      await addNew();
      expect(evidenceIds()).not.toContain(local.id);
    });

    it("a selected step removed with Backspace", async () => {
      const { local, proof } = await seedSteps();
      const view = pageEditor().view;
      fireEvent.pointerDown(view.dom);
      act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, stepAt(1).pos))));
      act(() => void fireEvent.keyDown(view.dom, { key: "Backspace", code: "Backspace", keyCode: 8 }));
      await waitFor(() => expect(evidenceIds()).toEqual([local.id]));
      await addNew();
      expect(evidenceIds()).not.toContain(proof.id);
    });

    it("a text selection across two steps removed with Backspace", async () => {
      const { local } = await seedSteps();
      const view = pageEditor().view;
      const first = stepAt(0).pos + 3; // inside the first step's sentence
      const second = stepAt(1).pos + 3; // inside the second step's sentence
      fireEvent.pointerDown(view.dom);
      act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, first, second))));
      act(() => void fireEvent.keyDown(view.dom, { key: "Backspace", code: "Backspace", keyCode: 8 }));
      await waitFor(() => expect(evidenceIds()).not.toContain(local.id));
      await addNew();
      expect(evidenceIds()).not.toContain(local.id);
    });
  });

  it("Add new evidence says when there is nothing new", async () => {
    await seedLnx();
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    // One bar above the page: Add new evidence sits at the right end of the formatting bar, not on a row of its own.
    const formatting = screen.getByRole("toolbar", { name: "Formatting" });
    expect(screen.getByRole("button", { name: "Add new evidence" }).parentElement).toBe(formatting.parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    const notice = (await screen.findByText("Nothing new to add")).closest<HTMLElement>("[role=status]")!;
    expect(within(notice).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

describe("Report view: the result", () => {
  const paper = () => document.querySelector<HTMLElement>(".report-page")!;

  it("has one strip: the report's, in place of the engagement's", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/e/e-exam/s/report"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("group", { name: "Report status" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Engagement status" })).toBeNull();
  });

  it("⌘L right after typing saves the page before the vault locks", async () => {
    const save = vi.spyOn(api, "reportSectionSave");
    const lock = vi.spyOn(api, "vaultLock");
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/e/e-exam/s/report"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(editors.length).toBeGreaterThan(0), { timeout: 5000 });
    act(() => {
      const view = pageEditor().view;
      view.dispatch(view.state.tr.insertText("typed just before locking", 1));
    });
    fireEvent.keyDown(document, { key: "l", code: "KeyL", metaKey: true });
    await waitFor(() => expect(lock).toHaveBeenCalled());
    const typed = save.mock.calls.findIndex(([, doc]) => JSON.stringify(doc).includes("typed just before locking"));
    expect(typed).not.toBe(-1);
    expect(save.mock.invocationCallOrder[typed]).toBeLessThan(lock.mock.invocationCallOrder[0]);
  });

  it("numbers the pages as OffSec's sample does, titles at the top of the paper", async () => {
    mount();
    await ready();
    const h1 = () => within(paper()).queryByRole("heading", { level: 1 })?.textContent;
    openPart("Front matter", /Introduction/);
    await waitFor(() => expect(h1()).toBe("1OffSec Certified Professional Exam Report"));
    expect(paper().firstElementChild?.tagName).toBe("H1");
    // Section 1's parts number under it, from the page's number.
    await waitFor(() =>
      expect(within(paper()).getAllByRole("heading", { level: 2 }).map((h) => [h.getAttribute("data-number"), h.textContent])).toEqual([
        ["1.1", "Introduction"],
        ["1.2", "Objective"],
        ["1.3", "Requirements"],
        ["1.4", "Scope"],
      ]),
    );
    openPart("Front matter", /Summary/);
    await waitFor(() => expect(h1()).toBe("2High-Level Summary"));
    openPart("Front matter", /Methodology/);
    await waitFor(() => expect(h1()).toBe("3Methodologies"));
    openPart("Front matter", /Testing considerations/);
    await waitFor(() => expect(h1()).toBe("Testing Considerations"));
    // The first target opens the Independent Challenges chapter; the next carries only its own heading.
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(h1()).toBe("4Independent Challenges"));
    expect(within(paper()).getByRole("heading", { level: 2, name: "4.1Target #1 – 10.10.30.21" })).toBeInTheDocument();
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(within(paper()).getByRole("heading", { level: 2, name: "4.2Target #2 – 10.10.30.5" })).toBeInTheDocument());
    expect(h1()).toBeUndefined();
    const subs = within(paper()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(subs[0]).toBe("4.2.1Service Enumeration");
    expect(subs[1]).toMatch(/^4\.2\.2Initial Access – /);
    expect(subs[2]).toMatch(/^4\.2\.3Privilege Escalation/);
    expect(subs).toContain("4.2.4Post-Exploitation");
    fireEvent.click(rowFor("AD set"));
    await waitFor(() => expect(h1()).toBe("5Active Directory Set"));
  });

  it("lists no generated appendices in the tab row", async () => {
    mount();
    await ready();
    expect(within(tabRow()).queryByRole("tab", { name: /Proof table|Tools and payloads|Metasploit usage|House cleaning|Appendix/ })).toBeNull();
    openPart("Closing", /Further information/);
    await waitFor(() => expect(within(paper()).queryByRole("heading", { level: 1 })?.textContent).toBe("Further Information"));
  });

  it("prints a flag inline: Local.txt value: closes Initial Access, Proof.txt value: opens Post-Exploitation", async () => {
    mount();
    await ready();
    fireEvent.click(rowFor("ms01"));
    // Flags in a step are chips in the editor (§10.2): open them all to see the blocks as they print.
    fireEvent.click(await screen.findByRole("button", { name: "Open all evidence" }));
    await waitFor(() => expect(within(paper()).getByText("Proof.txt value:")).toBeInTheDocument());
    const order = [...paper().querySelectorAll("h3, .report-flag strong")].map((el) => el.textContent ?? "");
    const at = (pred: (t: string) => boolean) => order.findIndex(pred);
    expect(at((t) => t === "Local.txt value:")).toBeGreaterThan(at((t) => t.includes("Initial Access")));
    expect(at((t) => t === "Local.txt value:")).toBeLessThan(at((t) => t.includes("Privilege Escalation")));
    expect(at((t) => t === "Proof.txt value:")).toBe(at((t) => t.includes("Post-Exploitation")) + 1);
  });

  it("prints the port table at the top of Service Enumeration, with a Notes cell per port", async () => {
    mount();
    await ready();
    await waitFor(() => expect(paper().querySelector(".report-table")).toBeTruthy());
    const table = paper().querySelector(".report-table")!;
    expect([...table.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Port", "Service", "Version", "Notes"]);
    expect([...table.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent)).toEqual(["22/tcp", "8080/tcp"]);
    expect(within(table as HTMLElement).getByRole("textbox", { name: "Notes for 22/tcp" })).toBeInTheDocument();
    // Enumeration's heading comes first, the table under it.
    const order = [...paper().querySelectorAll("h3, .report-table")].map((el) => el.tagName);
    expect(order.slice(0, 2)).toEqual(["H3", "TABLE"]);
    expect(paper().querySelector(".report-facts")).toBeNull();
  });

  /** A drafted machine page shows: its numbered sub-section headings (the old page in these tests has none). */
  const rebuilt = () => paper().querySelector("h3");

  it("rebuilds a page saved with an older layout from scratch, once", async () => {
    const report = await api.reportGetOrCreate("e-exam");
    const old = { type: "doc", content: [{ type: "slot", attrs: { hint: "x" }, content: [{ type: "text", text: "Written under the old layout" }] }] };
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old as unknown as ReportDoc, meta: { removedEntryIds: ["l-x"] }, draftBuiltAt: 1 });
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    mount();
    await ready();
    await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
    const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: unknown; doc: unknown }];
    // The page written before is kept in the meta, never dropped.
    expect(input.meta).toEqual({ layout: 4, previousDoc: old, previousLayout: null, previousAt: expect.any(Number) });
    expect(JSON.stringify(input.doc)).not.toContain("Written under the old layout");
    await waitFor(() => expect(rebuilt()).toBeTruthy());
    expect(paper().textContent).not.toContain("Written under the old layout");
    // Opened again, the rebuilt page stays.
    fireEvent.click(rowFor("ms01"));
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(within(paper()).getByRole("heading", { level: 2, name: "4.1Target #1 – 10.10.30.21" })).toBeInTheDocument());
    expect(draftUpserts(upsert, LNX)).toHaveLength(1);
  });

  it("a page rebuilt for a new layout offers the previous one back, and the swap undoes", async () => {
    const report = await api.reportGetOrCreate("e-exam");
    const old = { type: "doc", content: [{ type: "slot", attrs: { hint: "x" }, content: [{ type: "text", text: "Written under the old layout" }] }] };
    const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old as unknown as ReportDoc, meta: { layout: 2 }, draftBuiltAt: 1 });
    const save = vi.spyOn(api, "reportSectionSave");
    mount();
    await ready();
    await waitFor(() => expect(rebuilt()).toBeTruthy());
    expect(screen.getByText("This page was rebuilt for a new layout.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore your previous page" }));
    await waitFor(() => expect(paper().textContent).toContain("Written under the old layout"));
    expect(rebuilt()).toBeNull();
    // Stored as the current layout, the rebuilt page kept for the swap back.
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [id, doc, meta] = save.mock.calls[save.mock.calls.length - 1] as [string, ReportDoc, Record<string, unknown>];
    expect(id).toBe(section.id);
    expect(JSON.stringify(doc)).toContain("Written under the old layout");
    expect(meta).toMatchObject({ layout: 4, previousLayout: 2, restored: true });
    expect(JSON.stringify(meta.previousDoc)).toContain('"generated"');
    // The second swap brings the rebuilt page back.
    fireEvent.click(screen.getByRole("button", { name: "Use the rebuilt page" }));
    await waitFor(() => expect(rebuilt()).toBeTruthy());
    expect(paper().textContent).not.toContain("Written under the old layout");
    expect(screen.getByRole("button", { name: "Restore your previous page" })).toBeInTheDocument();
    // Restored again and typed into, the page keeps the typing when it is opened again.
    fireEvent.click(screen.getByRole("button", { name: "Restore your previous page" }));
    await waitFor(() => expect(paper().textContent).toContain("Written under the old layout"));
    act(() => {
      const view = pageEditor().view;
      view.dispatch(view.state.tr.insertText(" and more", 1 + "Written under the old layout".length));
    });
    expect(paper().textContent).toContain("Written under the old layout and more");
    fireEvent.click(rowFor("ms01"));
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(paper().textContent).toContain("Written under the old layout and more"));
  });

  it("keeps typing across a quick switch away and back: the page mounts on the latest document", async () => {
    await seedLnx();
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    act(() => {
      const view = pageEditor().view;
      view.dispatch(view.state.tr.insertText("typed words", 2 + view.state.doc.child(0).nodeSize - 1));
    });
    expect(paper().textContent).toContain("typed words");
    fireEvent.click(rowFor("ms01"));
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(paper().textContent).toContain("typed words"));
  });

  it("text copied from a now-private entry fails in amber until the owner keeps it as their own", async () => {
    const note = await api.logCreate("e-exam", { ...logInput("my note", { kind: "note", text: "creds in the share" }, 1_000), private: true });
    const report = await api.reportGetOrCreate("e-exam");
    const doc = { type: "doc", content: [{ type: "paragraph", attrs: { fromEntry: note.id, source: `entry:${note.id}:note` }, content: [{ type: "text", text: "creds in the share" }] }] };
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc as unknown as ReportDoc, meta: { layout: DRAFT_LAYOUT }, draftBuiltAt: 1 });
    mount();
    await ready();
    await waitFor(() => expect(paper().querySelector('[data-source-gone="private"]')).toBeTruthy());
    const checks = openTodo();
    fireEvent.click(within(checks).getByText("Block from a now-private entry"));
    fireEvent.click(within(checks).getByRole("button", { name: "Keep the text" }));
    await waitFor(() => expect(paper().querySelector("[data-source-gone]")).toBeNull());
    expect(paper().textContent).toContain("creds in the share");
    expect(within(checks).queryByText("Block from a now-private entry")).toBeNull();
  });

  it("guards DRAFT_LAYOUT: a bump rebuilds every stored page, so it must keep each one in previousDoc", () => {
    // Bumping it is a data-safety change: the rebuild test above must still see the old page in `previousDoc`.
    expect(DRAFT_LAYOUT).toBe(4);
  });

  it("groups checks of one kind into one row and cycles through them; the fix sits in a disclosure for the picked one", async () => {
    mount();
    await ready();
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(editors.length).toBeGreaterThan(1));
    await waitFor(() => expect(openTodo()).toHaveTextContent(/steps have no explanation/));
    const checks = openTodo();
    const explain = within(checks).getByText(/^\d+ steps have no explanation$/);
    expect(within(checks).queryAllByText("A step has no explanation before it.")).toHaveLength(0);
    const total = Number(explain.textContent!.split(" ")[0]);
    expect(total).toBeGreaterThan(1);
    const selectedPos = () => {
      const sel = pageEditor().state.selection;
      return sel instanceof NodeSelection ? sel.from : null;
    };
    fireEvent.click(explain);
    await waitFor(() => expect(selectedPos()).not.toBeNull());
    expect(within(checks).getByText(`1 of ${total}`)).toBeInTheDocument();
    const first = selectedPos();
    fireEvent.click(explain);
    await waitFor(() => expect(within(checks).getByText(`2 of ${total}`)).toBeInTheDocument());
    expect(selectedPos()).not.toBe(first);
    // No fix one-liners show until a check that has one is picked, and then inside a closed disclosure.
    expect(checks.querySelector("code")).toBeNull();
  });

});

describe("Report view: appendix pages and free pages (+ Page)", () => {
  const paper = () => document.querySelector<HTMLElement>(".report-page")!;
  const h1 = () => within(paper()).queryByRole("heading", { level: 1 })?.textContent;
  const detailOf = (t: HTMLElement) => t.querySelector("[data-tab-state]")?.textContent ?? "";
  const addPage = async (kind: "Appendix page" | "Free page") => {
    fireEvent.click(screen.getByRole("button", { name: "+ Page" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: kind }));
  };
  const pages = async () => {
    const report = await api.reportGetOrCreate("e-exam");
    return (await api.reportSectionsList(report.id)).filter((s) => s.kind === "page");
  };
  /** lnx02's page with its scan moved out, so it has Appendix A. */
  async function seedMoved() {
    await seedLnx();
    const report = await api.reportGetOrCreate("e-exam");
    const lnx = (await api.reportSectionsList(report.id)).find((s) => s.targetKey === LNX)!;
    const doc = JSON.parse(JSON.stringify(lnx.doc).replace('"appendix":"inline"', '"appendix":"moved"')) as ReportDoc;
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: lnx.position, doc, meta: lnx.meta, draftBuiltAt: lnx.draftBuiltAt });
  }

  // Skipped by the plain-page rollout (Task 4): a target has no appendix letter now, so the appendix page is Appendix A. Rewritten or removed with the Report view (Tasks 6 to 10).
  it.skip("+ Page → Appendix page adds a lettered tab after the targets' appendices, and opens it", async () => {
    await seedMoved();
    mount();
    await ready();
    await appendixTab("Appendix A");
    await addPage("Appendix page");
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "Closing", "Appendix A", "Appendix B"]));
    expect(detailOf(tab("Appendix B"))).toBe("Untitled appendix");
    expect(tab("Appendix B")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(h1()).toBe("Appendix B – Untitled appendix"));
    const [stored] = await pages();
    expect(stored.meta).toMatchObject({ title: "Untitled appendix", placement: "appendix", layout: DRAFT_LAYOUT });
    expect(stored.targetKey).toBeTruthy();
    expect(stored.doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("+ Page → Free page adds a numbered tab after the targets, before Closing", async () => {
    mount();
    await ready();
    await addPage("Free page");
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "Untitled page", "Closing"]));
    expect(detailOf(tab("Untitled page"))).toBe("Section 6");
    await waitFor(() => expect(h1()).toBe("6Untitled page"));
  });

  it("Rename edits the title on the tab; the tab and the page's heading follow", async () => {
    mount();
    await ready();
    await addPage("Free page");
    await waitFor(() => expect(h1()).toBe("6Untitled page"));
    // The page's actions sit outside the tablist (a tablist owns only tabs).
    const actions = screen.getByRole("button", { name: "Page actions" });
    expect(tabRow()).not.toContainElement(actions);
    fireEvent.click(actions);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Page title" });
    expect(input).toHaveValue("Untitled page");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Port knocking" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(tabLabels()).toContain("Port knocking"));
    await waitFor(() => expect(h1()).toBe("6Port knocking"));
    expect(document.activeElement).toBe(tab("Port knocking"));
    // F2 on the focused tab renames too; Esc keeps the title.
    fireEvent.keyDown(tab("Port knocking"), { key: "F2" });
    const again = screen.getByRole("textbox", { name: "Page title" });
    fireEvent.change(again, { target: { value: "Something else" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(tabLabels()).toContain("Port knocking");
    await waitFor(async () => expect((await pages())[0].meta).toMatchObject({ title: "Port knocking", placement: "body" }));
  });

  it("⌥→ on an appendix page's tab moves it later: the letters follow; ⌫ on the tab asks to delete", async () => {
    mount();
    await ready();
    await addPage("Appendix page");
    await waitFor(() => expect(tabLabels()).toContain("Appendix A"));
    await addPage("Appendix page");
    await waitFor(() => expect(tabLabels()).toContain("Appendix B"));
    // Tell them apart: rename the open one (B).
    fireEvent.keyDown(tab("Appendix B"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Page title" });
    fireEvent.change(input, { target: { value: "Second" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(detailOf(tab("Appendix B"))).toBe("Second"));
    fireEvent.keyDown(tab("Appendix A"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(detailOf(tab("Appendix A"))).toBe("Second"));
    expect(detailOf(tab("Appendix B"))).toBe("Untitled appendix");
    fireEvent.keyDown(tab("Appendix B"), { key: "Backspace" });
    expect(await screen.findByRole("dialog", { name: "Delete Untitled appendix? Its text goes with it." })).toBeInTheDocument();
  });

  it("Delete asks first, then Undo brings the page back with its text", async () => {
    mount();
    await ready();
    await addPage("Appendix page");
    await waitFor(() => expect(h1()).toBe("Appendix A – Untitled appendix"));
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    act(() => {
      const view = pageEditor().view;
      view.dispatch(view.state.tr.insertText("Every user dumped from the DC", 1));
    });
    fireEvent.click(screen.getByRole("button", { name: "Page actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Untitled appendix? Its text goes with it." });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(tabLabels()).not.toContain("Appendix A"));
    expect(await pages()).toEqual([]);
    // The first target opens in its place.
    expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true");

    const notice = (await screen.findAllByRole("status")).find((n) => n.textContent?.includes("Deleted Untitled appendix"))!;
    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(tabLabels()).toContain("Appendix A"));
    expect(tab("Appendix A")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(paper()).toHaveTextContent("Every user dumped from the DC"));
    const [back] = await pages();
    expect(JSON.stringify(back.doc)).toContain("Every user dumped from the DC");
    expect(back.meta).toMatchObject({ title: "Untitled appendix", placement: "appendix" });
  });
});

describe("CheckList", () => {
  it("shows a check's fix only once it is picked, inside a closed Fix disclosure", () => {
    const onPick = vi.fn();
    render(
      <TooltipProvider>
        <CheckList
          checks={[
            { id: "proof-ip:ms01:proof", level: "fail", text: "The proof.txt proof for ms01 doesn't show ipconfig.", fix: "ipconfig" },
            { id: "coverage:s1", level: "soft", text: "22/tcp on ms01 is untested." },
            { id: "coverage:s2", level: "soft", text: "80/tcp on ms01 is untested." },
          ]}
          onPick={onPick}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText("ipconfig")).toBeNull();
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
    // Short in the row; in full once picked.
    expect(screen.queryByText("The proof.txt proof for ms01 doesn't show ipconfig.")).toBeNull();
    fireEvent.click(screen.getByText("proof.txt proof lacks ipconfig"));
    expect(screen.getByText("The proof.txt proof for ms01 doesn't show ipconfig.")).toBeInTheDocument();
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "proof-ip:ms01:proof" }));
    const fix = screen.getByRole("button", { name: "Fix" });
    expect(fix).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fix);
    expect(screen.getByText("ipconfig").tagName).toBe("CODE");
    // A group's row names each one as it cycles, in its own words when they differ.
    fireEvent.click(screen.getByText("2 services are untested"));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("22/tcp on ms01 is untested.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("2 services are untested"));
    expect(screen.getByText("80/tcp on ms01 is untested.")).toBeInTheDocument();
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "coverage:s2" }));
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  });
});

describe("ReportTabs", () => {
  const tabs: TabItem[] = [
    { id: "front", label: "Front matter", state: "ready" },
    { id: "a", label: "1 lnx02", state: "todo", todo: 3, reorderable: true },
    { id: "b", label: "2 ms01", state: "not-started", reorderable: true },
    { id: "app", label: "Appendix A", state: "none", detail: "ms01, 2 items" },
  ];
  const renderTabs = (props: Partial<ComponentProps<typeof ReportTabs>> = {}) => {
    const onOpen = vi.fn();
    const onReorder = vi.fn();
    const onTodo = vi.fn();
    const onAddPage = vi.fn();
    render(
      <TooltipProvider>
        <ReportTabs tabs={tabs} openId="a" onOpen={onOpen} onReorder={onReorder} onTodo={onTodo} onAddPage={onAddPage} exportSlot={<button type="button">Export PDF</button>} {...props} />
      </TooltipProvider>,
    );
    return { onOpen, onReorder, onTodo, onAddPage };
  };

  it("puts + Page after the last tab and Export at the row's end; + Page offers an appendix page or a free page", () => {
    const { onAddPage } = renderTabs();
    const row = screen.getByRole("tablist", { name: "Report pages" });
    expect(within(row).getAllByRole("tab").map((t) => t.querySelector("[data-tab-label]")?.textContent)).toEqual(["Front matter", "1 lnx02", "2 ms01", "Appendix A"]);
    const add = screen.getByRole("button", { name: "+ Page" });
    // In document order: the last tab, + Page, then Export.
    const appendix = within(row).getAllByRole("tab")[3];
    expect(appendix.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.compareDocumentPosition(screen.getByRole("button", { name: "Export PDF" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(appendix).toHaveTextContent("ms01, 2 items");
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("menuitem", { name: "Free page" }));
    expect(onAddPage).toHaveBeenCalledWith("body");
  });

  it("states: ready, N to do, not started; N to do opens its tab and the To do panel", () => {
    const { onOpen, onTodo } = renderTabs({ openId: "front" });
    const state = (label: string) => screen.getAllByRole("tab").find((t) => t.textContent?.startsWith(label))!.querySelector("[data-tab-state]")!;
    expect(state("Front matter").textContent).toBe("ready");
    expect(state("1 lnx02").textContent).toBe("3 to do");
    expect(state("2 ms01").textContent).toBe("not started");
    fireEvent.click(state("1 lnx02"));
    expect(onOpen).toHaveBeenCalledWith("a");
    expect(onTodo).toHaveBeenCalledWith("a");
  });

  it("⌥← and ⌥→ reorder only reorderable tabs", () => {
    const { onReorder } = renderTabs();
    const [front, a] = screen.getAllByRole("tab");
    fireEvent.keyDown(a, { key: "ArrowRight", altKey: true });
    expect(onReorder).toHaveBeenCalledWith("a", 1);
    fireEvent.keyDown(front, { key: "ArrowRight", altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
});

describe("TodoPanel", () => {
  it("lists the checks and closes on Esc", () => {
    const onClose = vi.fn();
    render(
      <TooltipProvider>
        <TodoPanel checks={[{ id: "details", level: "fail", text: "Report details are missing the OSID." }]} onPick={() => {}} onClose={onClose} />
      </TooltipProvider>,
    );
    const panel = screen.getByRole("region", { name: "To do" });
    expect(within(panel).getByRole("list", { name: "Checks" })).toBeInTheDocument();
    fireEvent.keyDown(within(panel).getAllByRole("button")[0], { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("pruneRemoved", () => {
  const ev = (entryId: string) => ({ type: "evidence", attrs: { entryId } });
  it("drops removed ids whose entry is on the page again (undo) and keeps the rest", () => {
    const doc = { type: "doc", content: [ev("a")] };
    expect(pruneRemoved(doc, { removedEntryIds: ["a", "b"], layout: 3 })).toEqual({ removedEntryIds: ["b"], layout: 3 });
    const meta = { removedEntryIds: ["b"] };
    expect(pruneRemoved(doc, meta)).toBe(meta);
  });
});
