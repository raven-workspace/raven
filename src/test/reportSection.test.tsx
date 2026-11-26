import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api, resetAuditState } from "../audit/fakeApi";
import { reportSchema } from "../features/report/editor/extension";
import { PROGRAMMATIC } from "../features/report/editor/pageActions";
import { ReportSectionView } from "../features/report/ReportSection/ReportSection";
import { pruneRemoved } from "../features/report/queries";
import { DRAFT_LAYOUT, needsFlatten, PAGE_NODE_TYPES, type ReportNode, type SectionMeta, placedIn, removalKeys } from "../engines/report";
import { discardReports, flushReports, queueReportSave } from "../features/report/saveQueue";
import { ReportTabs, type TabItem } from "../features/report/ReportTabs/ReportTabs";
import { CheckList, TodoPanel } from "../features/report/TodoPanel/TodoPanel";
import { makeQueryClient } from "../lib/queryClient";
import type { LogContent, LogEntryInput } from "../types/log";
import { RavenError } from "../types/errors";
import { TooltipProvider } from "../ui";
import layout3Json from "./fixtures/report-layout3-owner.json";
import layout5Json from "./fixtures/report-layout5-web01.json";

/** What a page places, as `removedEntryIds` records it. */
const placedKeys = (n: ReportNode) => new Set(removalKeys(placedIn(n)));

vi.mock("../lib/api", () => import("../audit/fakeApi"));
// The audit fixture also stores web01's layout-5 page (the audit's Restore screens); these tests store their own
// (storeWeb01) where they need it, so every target starts undrafted, in grading order.
vi.mock("../audit/fixtures", async (importOriginal) => {
  const real = await importOriginal<typeof import("../audit/fixtures")>();
  return { ...real, FIXTURES: { ...real.FIXTURES, reportSections: real.FIXTURES.reportSections.filter((s) => s.kind !== "target") } };
});

// The real editor, with a handle on its instance so a test can type into the page.
const editors: Editor[] = [];
vi.mock("../features/report/editor/ReportEditor/ReportEditor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../features/report/editor/ReportEditor/ReportEditor")>();
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

// The page's schema as it is; a test can make its check fail (`failSchema`).
vi.mock("../features/report/editor/extension", async (importOriginal) => {
  const real = await importOriginal<typeof import("../features/report/editor/extension")>();
  return { ...real, reportSchema: vi.fn(real.reportSchema) };
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
/** A free page's tab by its title, without the "§6 " its label leads with. */
const pageTab = (title: string) => tabEls().find((t) => labelOf(t).replace(/^§\d+ /, "") === title)!;
/** Opens a part of Front matter or Closing: the tab, then the part in its segmented row. */
const openPart = (group: "Front matter" | "Closing", part: RegExp) => {
  fireEvent.click(tab(group));
  fireEvent.click(within(screen.getByRole("tablist", { name: `${group} parts` })).getByRole("tab", { name: part }));
};
const TARGETS = ["1 lnx02", "2 garnet", "3 ms01", "4 web01", "5 xfer03", "6 AD set"];
/** Opens the To do panel from the strip (unless it is open) and returns its checks. */
const openTodo = () => {
  if (!screen.queryByRole("region", { name: "To do" })) fireEvent.click(screen.getByRole("button", { name: /^To do/ }));
  return within(screen.getByRole("region", { name: "To do" })).getByRole("list", { name: "Checks" });
};

async function ready() {
  await waitFor(() => expect(targetRows().length).toBeGreaterThan(0));
}

const LNX_ID = "h-exam-lnx";
const nodeTypes = (n: ReportNode): string[] => [n.type, ...(n.content ?? []).flatMap(nodeTypes)];
type UpsertInput = { targetKey: string | null; draftBuiltAt: number | null };
const draftUpserts = (spy: { mock: { calls: unknown[][] } }, targetKey: string) =>
  spy.mock.calls.filter((call) => {
    const input = call[1] as UpsertInput;
    return input.targetKey === targetKey && input.draftBuiltAt !== null;
  });

describe("Report view", () => {
  it("puts the open page's guide notes in the right-hand column, above the log", async () => {
    mount();
    await ready();
    const list = await screen.findByRole("list", { name: "Guide notes" });
    expect(list.closest("[aria-label='Evidence'], [role='dialog']")).toBeTruthy();
    expect(document.querySelector(".ProseMirror [data-guide]")).toBeNull();
  });

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

  it("lists a target page stored before the others first, the newly drafted ones after it in grading order", async () => {
    // A report opened before a layout change (the audit's web01): its stored page keeps its place, new pages follow.
    const report = await api.reportGetOrCreate("e-exam");
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: "h-exam-web", position: 2, doc: null, meta: {}, draftBuiltAt: null });
    mount();
    await ready();
    await waitFor(() => expect(targetLabels()).toEqual(["1 web01", "2 lnx02", "3 garnet", "4 ms01", "5 xfer03", "6 AD set"]));
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
    expect(document.activeElement).toBe(rowFor("garnet"));
    expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(rowFor("garnet"), { key: "Enter", code: "Enter" });
    await waitFor(() => expect(rowFor("garnet")).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(rowFor("garnet"), { key: "ArrowLeft", code: "ArrowLeft" });
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
    expect(state).toHaveClass("report-tab__state--todo");
    fireEvent.click(state);
    const panel = await screen.findByRole("region", { name: "To do" });
    await waitFor(() => expect(rowFor("lnx02")).toHaveAttribute("aria-selected", "true"));
    const checks = within(panel).getByRole("list", { name: "Checks" });
    expect(within(checks).getByText("2 flags are not on the page")).toBeInTheDocument();
    // lnx02's expected flags are set in the panel too.
    expect(within(panel).getByRole("group", { name: "Expected flags" })).toBeInTheDocument();
    await waitFor(() => expect(editors.length).toBe(3));
    fireEvent.click(within(checks).getByText("Long block (80 lines)"));
    await waitFor(() => expect(pageEditor().state.selection instanceof NodeSelection).toBe(true));
    expect(pageEditor().view.hasFocus() || pageEditor().view.dom.contains(document.activeElement)).toBe(true);
    // Esc in the panel closes it.
    fireEvent.keyDown(within(panel).getByRole("button", { name: "Close To do" }), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "To do" })).toBeNull());
  });

  it("picking a missing flag selects its machine's heading", async () => {
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    await waitFor(() => expect(openTodo()).toHaveTextContent("2 flags are not on the page"));
    fireEvent.click(within(openTodo()).getByText("2 flags are not on the page"));
    await waitFor(() => expect(pageEditor().state.selection instanceof NodeSelection).toBe(true));
    const picked = (pageEditor().state.selection as NodeSelection).node;
    expect(picked.type.name).toBe("heading");
    expect(picked.textContent).toContain("lnx02");
  });

  it("a dismissed check leaves To do and the tab's count, is saved with the page, and can be brought back", async () => {
    await seedLnx(80);
    const save = vi.spyOn(api, "reportSectionSave");
    const { unmount } = mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    const count = () => Number(rowFor("lnx02").querySelector<HTMLElement>("[data-tab-state]")?.textContent?.match(/^(\d+)/)?.[1] ?? 0);
    const before = count();
    fireEvent.click(rowFor("lnx02").querySelector<HTMLElement>("[data-tab-state]")!);
    const panel = await screen.findByRole("region", { name: "To do" });
    const checks = within(panel).getByRole("list", { name: "Checks" });
    fireEvent.click(within(checks).getByText("2 flags are not on the page"));
    fireEvent.click(within(panel).getByRole("button", { name: "Dismiss all 2" }));
    await waitFor(() => expect(within(checks).queryByText("2 flags are not on the page")).toBeNull());
    expect(count()).toBe(before - 2);
    fireEvent.click(within(panel).getByRole("button", { name: "Dismissed (2)" }));
    const dismissed = within(panel).getByRole("list", { name: "Dismissed checks" });
    expect(within(dismissed).getAllByRole("listitem")).toHaveLength(2);
    // One comes back: it is on the list (and counted) again.
    fireEvent.click(within(dismissed).getAllByRole("button", { name: "Bring back" })[0]);
    await waitFor(() => expect(count()).toBe(before - 1));
    expect(within(panel).getByRole("button", { name: "Dismissed (1)" })).toBeInTheDocument();
    unmount();
    const metas = save.mock.calls.map(([, , meta]) => meta as { dismissedChecks?: string[] });
    expect(metas.at(-1)?.dismissedChecks).toHaveLength(1);
    expect(metas.at(-1)?.dismissedChecks?.[0]).toMatch(/^proof-missing:lnx02:/);
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
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX_ID, position: 0, doc: old("Old lnx02 page"), meta: { layout: 3 }, draftBuiltAt: 1 });
    await api.reportSectionUpsert(report.id, { kind: "summary", targetKey: null, position: 0, doc: old("Old summary page"), meta: { layout: 3 }, draftBuiltAt: 1 });
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

  it("builds a target's plain draft once, on its first open", async () => {
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    mount();
    await ready();
    // The first target opens by default and gets its draft: a plain page at layout 6.
    await waitFor(() => expect(draftUpserts(upsert, "h-exam-lnx")).toHaveLength(1));
    const [, input] = draftUpserts(upsert, "h-exam-lnx")[0] as [string, { meta: unknown; doc: ReportNode }];
    expect(input.meta).toEqual({ layout: 6 });
    expect(nodeTypes(input.doc).every((t) => PAGE_NODE_TYPES.includes(t))).toBe(true);
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
          if (n.type.name === "paragraph" && at === 1) at = p + 1;
          return at === 1;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).insertText(text));
      });
    const savedText = () => save.mock.calls.map(([, doc]) => JSON.stringify(doc));

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
    await waitFor(() => expect(targetRows()).toHaveLength(6));

    await act(async () => {
      await api.hostDelete("h-exam-web");
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(targetLabels()).toEqual(["1 lnx02", "2 garnet", "3 ms01", "4 xfer03", "5 AD set"]));

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
    await waitFor(() => expect(targetRows()).toHaveLength(6));
    const first = rowFor("lnx02");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight", code: "ArrowRight", altKey: true });
    const order = ["1 garnet", "2 lnx02", "3 ms01", "4 web01", "5 xfer03", "6 AD set"];
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
    await waitFor(() => expect(targetRows()).toHaveLength(6));

    fail = true;
    await act(async () => {
      await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never);
      await qc.invalidateQueries();
    });
    expect(await screen.findByText(/Couldn't add the report's new sections/)).toBeInTheDocument();
    expect(targetRows()).toHaveLength(6);

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

  it("a page whose draft fails to build stops no other page; its Retry clears only its own failure", async () => {
    const real = api.reportSectionUpsert;
    let failing: string | null = null;
    vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
      // The first page to build its draft fails, every time, until Retry.
      if (input.draftBuiltAt !== null && (failing ??= input.targetKey) === input.targetKey) throw new Error("db busy");
      return real(rid, input);
    });
    mount();
    await ready();
    expect(await screen.findByText(/Couldn't build this page's draft/)).toBeInTheDocument();
    const first = targetRows().find((t) => t.getAttribute("aria-selected") === "true")!;
    const other = targetRows().find((t) => t !== first)!;
    fireEvent.click(other);
    await waitFor(() => expect(other).toHaveAttribute("aria-selected", "true"));
    // The other page builds: its draft is on the page, and it says nothing about the first page's failure.
    await waitFor(() => expect(document.querySelector(".report-page .ProseMirror")).not.toBeNull());
    expect(screen.queryByText(/Couldn't build this page's draft/)).toBeNull();
    // Back on the first, its failure still shows; Retry builds it.
    fireEvent.click(first);
    expect(await screen.findByText(/Couldn't build this page's draft/)).toBeInTheDocument();
    failing = "none";
    fireEvent.click(screen.getByRole("button", { name: "Retry building the draft" }));
    await waitFor(() => expect(screen.queryByText(/Couldn't build this page's draft/)).not.toBeInTheDocument());
    await waitFor(() => expect(document.querySelector(".report-page .ProseMirror")).not.toBeNull());
  });

  it("shows a placeholder for client engagements", async () => {
    mount("e-old");
    expect(await screen.findByText("Client reports come after the exam")).toBeInTheDocument();
  });

  it("⌥→ on a target tab moves it later in grading order", async () => {
    const reorder = vi.spyOn(api, "reportSectionsReorder");
    mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(6));
    const first = rowFor("lnx02");
    const lnxId = first.dataset.id!;
    const garnetId = rowFor("garnet").dataset.id!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight", code: "ArrowRight", altKey: true });
    await waitFor(() => expect(targetLabels()).toEqual(["1 garnet", "2 lnx02", "3 ms01", "4 web01", "5 xfer03", "6 AD set"]));
    expect(reorder).toHaveBeenCalledTimes(1);
    const ids = reorder.mock.calls[0][1];
    expect(ids.indexOf(garnetId)).toBeLessThan(ids.indexOf(lnxId));
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
/** lnx02's page, stored as a plain page at the current layout (`lnxPage`), its scan's output `outputLines` lines long. */
async function seedLnx(outputLines = 3, meta: Record<string, unknown> = {}) {
  const output = Array.from({ length: outputLines }, (_, i) => `line ${i}`).join("\n");
  const scan = await api.logCreate("e-exam", logInput("nmap scan", { kind: "command", blocks: [{ command: "nmap -sV 10.10.30.21", output }] }, 1_000));
  const report = await api.reportGetOrCreate("e-exam");
  await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: lnxPage(scan.id, output), meta: { layout: DRAFT_LAYOUT, ...meta }, draftBuiltAt: Date.now() });
  return scan;
}

const plainPage = (content: ReportNode[]): ReportNode => ({ type: "doc", content });
const plainBlocks = (doc: ReportNode): ReportNode[] => doc.content ?? [];

/** A plain lnx02 page: an h2 with its phase source, a hint paragraph, the scan's command and output, the post heading. */
function lnxPage(scanId: string, output: string): ReportNode {
  return plainPage([
    { type: "heading", attrs: { level: 2, source: `phase:${LNX}:foothold` }, content: [{ type: "text", text: "Initial access" }] },
    { type: "paragraph", attrs: { hint: "What you do next" } },
    { type: "codeBlock", attrs: { language: "", source: `entry:${scanId}:0:command` }, content: [{ type: "text", text: "nmap -sV 10.10.30.21" }] },
    { type: "codeBlock", attrs: { language: "", source: `entry:${scanId}:0:output` }, content: [{ type: "text", text: output }] },
    { type: "heading", attrs: { level: 2, source: `phase:${LNX}:post` }, content: [{ type: "text", text: "Post-exploitation" }] },
  ]);
}

const pageEditor = () => editors[editors.length - 1];
describe("Report view: long blocks, screenshots and new evidence", () => {
  it("a long block's soft check suggests an appendix page and offers no action", async () => {
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    const checks = openTodo();
    fireEvent.click(within(checks).getByText("Long block (80 lines)"));
    // Picked, the check reads in full under its row; a page moves nothing to an appendix, so there is no Move.
    expect(within(checks).getByText("This block is long (80 lines). Consider moving it to an appendix page.")).toBeInTheDocument();
    expect(within(checks).queryByRole("button", { name: "Move to appendix" })).toBeNull();
    // The pick selects the block itself: the scan's output.
    await waitFor(() => {
      const sel = pageEditor().state.selection;
      expect(sel instanceof NodeSelection && sel.node.type.name === "codeBlock" && sel.node.textContent.startsWith("line 0")).toBe(true);
    });
  });

  it("flags a screenshot figure too narrow to print legibly once its image loads", async () => {
    const shot = await api.logCreate("e-exam", {
      ...logInput("Login page", { kind: "screenshot", attachmentId: "", caption: "Login page", fileName: "x.png" }, 500),
      attachment: { mime: "image/png", dataBase64: "AAAA" },
    } as LogEntryInput);
    const { attachmentId } = shot.content as { attachmentId: string };
    const scan = await seedLnx();
    const report = await api.reportGetOrCreate("e-exam");
    const lnx = (await api.reportSectionsList(report.id)).find((s) => s.targetKey === LNX)!;
    const figure: ReportNode = { type: "figure", attrs: { attachmentId, entryId: shot.id, source: `entry:${shot.id}` }, content: [{ type: "text", text: "Login page" }] };
    await api.reportSectionSave(lnx.id, plainPage([...plainBlocks(lnxPage(scan.id, "line 0")), figure]), { layout: DRAFT_LAYOUT });
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
  /** The open target page's machine heading: its printed number and its text. */
  const machineHeading = () => {
    const h = paper().querySelector("h1[data-number]");
    return h ? [h.getAttribute("data-number"), h.textContent] : null;
  };
  const text = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(text).join("");

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
    // The first target opens the Independent Challenges chapter; the next carries only its own heading. A machine's
    // heading takes the target's number; the phase headings under it are unnumbered.
    const title = () => paper().querySelector(".report-title")?.textContent ?? null;
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(title()).toBe("4Independent Challenges"));
    await waitFor(() => expect(machineHeading()).toEqual(["4.1", "lnx02 (10.10.30.21)"]));
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(machineHeading()).toEqual(["4.3", "ms01 (10.10.30.5)"]));
    expect(title()).toBeNull();
    const subs = within(paper()).getAllByRole("heading", { level: 2 });
    expect(subs.map((h) => h.textContent)[0]).toBe("Service enumeration");
    expect(subs.map((h) => h.textContent)[1]).toMatch(/^Initial access: /);
    expect(subs.map((h) => h.textContent)[2]).toMatch(/^Privilege escalation: /);
    expect(subs.every((h) => !h.hasAttribute("data-number"))).toBe(true);
    fireEvent.click(rowFor("AD set"));
    await waitFor(() => expect(title()).toBe("5Active Directory Set"));
  });

  it("lists no generated appendices in the tab row", async () => {
    mount();
    await ready();
    expect(within(tabRow()).queryByRole("tab", { name: /Proof table|Tools and payloads|Metasploit usage|House cleaning|Appendix/ })).toBeNull();
    openPart("Closing", /Further information/);
    await waitFor(() => expect(within(paper()).queryByRole("heading", { level: 1 })?.textContent).toBe("Further Information"));
  });

  it("prints a flag as the last step of its phase: Read local.txt: then its proof", async () => {
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(machineHeading()?.[1]).toBe("ms01 (10.10.30.5)"));
    const blocks = pageEditor().state.doc.toJSON().content as ReportNode[];
    /** The last numbered step before the heading whose text starts with `heading`. */
    const lastStepBefore = (heading: string) => {
      const at = blocks.findIndex((b) => b.type === "heading" && text(b).startsWith(heading));
      return blocks.slice(0, at).reverse().find((b) => b.type === "list" && b.attrs?.kind === "ordered")!;
    };
    const local = lastStepBefore("Privilege escalation").content!;
    expect(text(local[0])).toBe("Read local.txt:");
    expect(local[1].type).toBe("codeBlock");
    expect(local[1].attrs?.source).toMatch(/^entry:.+:proof$/);
    const proof = lastStepBefore("Also tested").content!;
    expect(text(proof[0])).toBe("Read proof.txt:");
    expect(proof[1].type).toBe("codeBlock");
    expect(text(proof[1])).toContain("type proof.txt");
  });

  it("prints the port table at the top of Service enumeration; typing in a Notes cell saves the page and not the services", async () => {
    const save = vi.spyOn(api, "reportSectionSave");
    const service = vi.spyOn(api, "serviceUpdate");
    mount();
    await ready();
    await waitFor(() => expect(paper().querySelector("table")).toBeTruthy());
    const table = paper().querySelector("table")!;
    expect([...table.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Port", "Service", "Version", "Notes"]);
    expect([...table.querySelectorAll("tr")].slice(1).map((tr) => tr.querySelector("td")?.textContent)).toEqual(["22/tcp", "8080/tcp"]);
    // Enumeration's heading comes right before the table.
    const order = [...paper().querySelectorAll(".report-page-doc > h2, .report-page-doc table")].map((el) => el.tagName);
    expect(order.slice(0, 2)).toEqual(["H2", "TABLE"]);
    expect(table.closest(".report-page-doc")!.querySelector("h2")!.textContent).toBe("Service enumeration");

    // The 22/tcp row's Notes cell: its paragraph's inside.
    let at = -1;
    pageEditor().state.doc.descendants((n, pos) => {
      if (at !== -1) return false;
      if (n.type.name === "tableRow" && n.child(0).textContent === "22/tcp") {
        let cell = pos + 1;
        for (let i = 0; i < 3; i++) cell += n.child(i).nodeSize;
        at = cell + 2;
      }
      return true;
    });
    act(() => {
      const view = pageEditor().view;
      view.dispatch(view.state.tr.insertText("ssh keys reused", at));
    });
    expect([...table.querySelectorAll("tr")][1].querySelectorAll("td")[3].textContent).toBe("ssh keys reused");
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(save.mock.calls.some(([, doc]) => JSON.stringify(doc).includes("ssh keys reused"))).toBe(true));
    expect(service).not.toHaveBeenCalled();
  });

  /** A drafted machine page shows its numbered machine heading (the old page in these tests has none). */
  const rebuilt = () => paper().querySelector("h1[data-number]");

  it("rebuilds a page saved with an older layout from scratch, once", async () => {
    const report = await api.reportGetOrCreate("e-exam");
    const old = { type: "doc", content: [{ type: "slot", attrs: { hint: "x" }, content: [{ type: "text", text: "Written under the old layout" }] }] };
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { removedEntryIds: ["l-x"] }, draftBuiltAt: 1 });
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    mount();
    await ready();
    await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
    const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: unknown; doc: unknown }];
    // The page written before is kept in the meta, never dropped.
    // The owner's removed entries carry forward; the old page and its meta are archived as they were.
    expect(input.meta).toEqual({
      removedEntryIds: ["l-x"],
      layout: 6,
      previousDoc: old,
      previousLayout: null,
      previousAt: expect.any(Number),
      originals: [{ doc: old, layout: null, meta: { removedEntryIds: ["l-x"] }, at: expect.any(Number), why: "rebuild" }],
    });
    expect(JSON.stringify(input.doc)).not.toContain("Written under the old layout");
    await waitFor(() => expect(rebuilt()).toBeTruthy());
    expect(paper().textContent).not.toContain("Written under the old layout");
    // Opened again, the rebuilt page stays.
    fireEvent.click(rowFor("ms01"));
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(machineHeading()).toEqual(["4.1", "lnx02 (10.10.30.21)"]));
    expect(draftUpserts(upsert, LNX)).toHaveLength(1);
  });

  it("a page rebuilt for a new layout offers the previous one back, and the swap undoes", async () => {
    const report = await api.reportGetOrCreate("e-exam");
    const old = { type: "doc", content: [{ type: "slot", attrs: { hint: "x" }, content: [{ type: "text", text: "Written under the old layout" }] }] };
    const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { layout: 2 }, draftBuiltAt: 1 });
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
    const [id, doc, meta] = save.mock.calls[save.mock.calls.length - 1] as [string, ReportNode, Record<string, unknown>];
    expect(id).toBe(section.id);
    expect(JSON.stringify(doc)).toContain("Written under the old layout");
    expect(meta).toMatchObject({ layout: 6, previousLayout: 2, restored: true });
    expect(JSON.stringify(meta.previousDoc)).toContain(`"facts:${LNX}"`);
    expect(needsFlatten(doc)).toBe(false);
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
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc, meta: { layout: DRAFT_LAYOUT }, draftBuiltAt: 1 });
    mount();
    await ready();
    await waitFor(() => expect(paper().querySelector('[data-source-gone="private"]')).toBeTruthy());
    const checks = openTodo();
    fireEvent.click(within(checks).getByText("Block from a now-private entry"));
    // The action says what it does before it is pressed.
    expect(within(checks).getByText("Keep the text to make it your own writing: it stays on the page and goes into the report, though its entry stays private.")).toBeInTheDocument();
    fireEvent.click(within(checks).getByRole("button", { name: "Keep the text" }));
    await waitFor(() => expect(paper().querySelector("[data-source-gone]")).toBeNull());
    expect(paper().textContent).toContain("creds in the share");
    expect(within(checks).queryByText("Block from a now-private entry")).toBeNull();
  });

  describe("plain pages at layout 6", () => {
    const WEB = "h-exam-web";
    const layout5 = layout5Json as ReportNode;
    /** The four sentences the owner wrote on the layout-5 web01 page: a step's sentence, a port note, a finding edit, a caption. */
    const OWNER = ["I read the backup config through the LFI first.", "Admin panel on 8080", "The upload filter trusts the extension only.", "Root shell on web01"];
    const storeWeb01 = async () => {
      const report = await api.reportGetOrCreate("e-exam");
      return api.reportSectionUpsert(report.id, { kind: "target", targetKey: WEB, position: 2, doc: layout5, meta: { layout: 5 }, draftBuiltAt: 1 });
    };
    const stored = async (id: string) => {
      const report = await api.reportGetOrCreate("e-exam");
      return (await api.reportSectionsList(report.id)).find((s) => s.id === id)!;
    };

    it("a layout-5 page rebuilds as the plain draft and keeps the old page byte for byte", async () => {
      const section = await storeWeb01();
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      mount();
      await ready();
      fireEvent.click(rowFor("web01"));
      await waitFor(() => expect(draftUpserts(upsert, WEB)).toHaveLength(1));
      const [, input] = draftUpserts(upsert, WEB)[0] as [string, { meta: SectionMeta; doc: ReportNode }];
      expect(input.meta.previousDoc).toEqual(layout5);
      expect(JSON.stringify(input.meta.previousDoc)).toBe(JSON.stringify(layout5));
      expect(input.meta).toMatchObject({ layout: 6, previousLayout: 5, previousAt: expect.any(Number) });
      expect(needsFlatten(input.doc)).toBe(false);
      // Stored so: the old page is in the meta, the plain draft is the page.
      await waitFor(async () => expect((await stored(section.id)).meta).toMatchObject({ layout: 6, previousLayout: 5 }));
      expect(JSON.stringify((await stored(section.id)).meta.previousDoc)).toBe(JSON.stringify(layout5));
    });

    it("the rebuild leaves out what the owner removed, and the removal stays recorded after it saves", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const removed = ["l-exam-web01-grafana", "l-exam-web01-sudo", "tested:h-exam-web"];
      const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: WEB, position: 2, doc: layout5, meta: { layout: 5, removedEntryIds: removed }, draftBuiltAt: 1 });
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      mount();
      await ready();
      fireEvent.click(rowFor("web01"));
      await waitFor(() => expect(draftUpserts(upsert, WEB)).toHaveLength(1));
      const [, input] = draftUpserts(upsert, WEB)[0] as [string, { meta: SectionMeta; doc: ReportNode }];
      const placed = placedKeys(input.doc);
      for (const id of removed) expect(placed.has(id)).toBe(false);
      // The rest of the draft is there: the entries the owner kept.
      expect(placed.has("l-exam-web01-tar")).toBe(true);
      expect(input.meta.removedEntryIds).toEqual(removed);
      await waitFor(() => expect(machineHeading()?.[1]).toBe("web01 (10.10.30.20)"));
      expect(paper().textContent).not.toContain("sudo -l");
      // A later save of the page goes through pruneRemoved: the removals stay recorded.
      expect(pruneRemoved(input.doc, input.meta).removedEntryIds).toEqual(removed);
      const save = vi.spyOn(api, "reportSectionSave");
      queueReportSave(makeQueryClient(), section.id, input.doc, input.meta);
      await flushReports();
      const [, , meta] = save.mock.calls.filter(([id]) => id === section.id).at(-1)! as [string, ReportNode, SectionMeta];
      expect(meta.removedEntryIds).toEqual(removed);
    });

    it("Restore shows every owner sentence of a layout-5 page, as plain blocks", async () => {
      const section = await storeWeb01();
      const save = vi.spyOn(api, "reportSectionSave");
      mount();
      await ready();
      fireEvent.click(rowFor("web01"));
      await waitFor(() => expect(machineHeading()?.[1]).toBe("web01 (10.10.30.20)"));
      await waitFor(() => expect(screen.getByText("This page was rebuilt for a new layout.")).toBeInTheDocument());
      const draftText = paper().textContent;
      fireEvent.click(screen.getByRole("button", { name: "Restore your previous page" }));
      await waitFor(() => expect(paper().textContent).toContain(OWNER[0]));
      for (const sentence of OWNER) expect(paper().textContent).toContain(sentence);
      await waitFor(() => expect(save.mock.calls.some(([id]) => id === section.id)).toBe(true));
      const [, doc, meta] = save.mock.calls.filter(([id]) => id === section.id).at(-1)! as [string, ReportNode, SectionMeta];
      expect(needsFlatten(doc)).toBe(false);
      expect(meta).toMatchObject({ layout: 6, restored: true });

      // The stored layout-5 page survives the swaps, byte for byte, in the archive; the rebuilt page swapped out joins it.
      await flushReports();
      const archived = ((await stored(section.id)).meta as SectionMeta).originals!;
      expect(JSON.stringify(archived[0].doc)).toBe(JSON.stringify(layout5));
      expect(archived.map((a) => a.why)).toEqual(["rebuild", "restore"]);

      fireEvent.click(screen.getByRole("button", { name: "Use the rebuilt page" }));
      await waitFor(() => expect(paper().textContent).toBe(draftText));
      await flushReports();
      const after = ((await stored(section.id)).meta as SectionMeta).originals!;
      expect(after.slice(0, 2)).toEqual(archived);
      expect(after.map((a) => a.why)).toEqual(["rebuild", "restore", "restore"]);

      // Toggling again swaps the same two pages: the archive holds both already and adds nothing.
      fireEvent.click(screen.getByRole("button", { name: "Restore your previous page" }));
      await waitFor(() => expect(paper().textContent).toContain(OWNER[0]));
      fireEvent.click(screen.getByRole("button", { name: "Use the rebuilt page" }));
      await waitFor(() => expect(paper().textContent).toBe(draftText));
      await flushReports();
      expect(((await stored(section.id)).meta as SectionMeta).originals).toEqual(after);
      expect(screen.getByRole("button", { name: "Restore your previous page" })).toBeInTheDocument();
    });

    it("a queued write of the old page lands before the rebuild, never after it", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const old = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page" }] }]);
      const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { layout: 5 }, draftBuiltAt: 1 });
      const edited = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page, edited before the rebuild" }] }]);
      const calls: string[] = [];
      const realSave = api.reportSectionSave;
      const realUpsert = api.reportSectionUpsert;
      let failOnce = true;
      vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
        if (id === section.id) calls.push(`save:${(meta as SectionMeta).layout}`);
        if (id === section.id && failOnce) {
          failOnce = false;
          throw new Error("disk busy");
        }
        return realSave(id, doc, meta);
      });
      vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
        if (input.targetKey === LNX && input.draftBuiltAt !== null) calls.push(`upsert:${(input.meta as SectionMeta).layout}`);
        return realUpsert(rid, input);
      });
      // An edit of the old page whose write failed: it waits in the queue for its retry.
      const qc = makeQueryClient();
      queueReportSave(qc, section.id, edited, { layout: 5 });
      await flushReports();
      expect(calls).toEqual(["save:5"]);

      mount("e-exam", qc);
      await ready();
      await waitFor(() => expect(calls).toContain("upsert:6"));
      await act(async () => {});
      // The old page's write went out first; nothing of the old layout is written after the rebuild.
      expect(calls).toEqual(["save:5", "save:5", "upsert:6"]);
      const after = await stored(section.id);
      expect(needsFlatten(after.doc!)).toBe(false);
      expect(after.meta).toMatchObject({ layout: 6, previousLayout: 5 });
      expect(after.meta.previousDoc).toEqual(edited);
    });

    it("an old page whose queued write still fails is not rebuilt until the write lands", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const old = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page" }] }]);
      const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { layout: 5 }, draftBuiltAt: 1 });
      const edited = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page, edited" }] }]);
      const realSave = api.reportSectionSave;
      let fail = true;
      vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
        if (id === section.id && fail) throw new Error("disk busy");
        return realSave(id, doc, meta);
      });
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      const qc = makeQueryClient();
      queueReportSave(qc, section.id, edited, { layout: 5 });
      await flushReports();

      mount("e-exam", qc);
      await ready();
      const blocked = await screen.findByText(/An earlier change to this page couldn't be saved, so Raven kept the old page/);
      expect(draftUpserts(upsert, LNX)).toHaveLength(0);

      fail = false;
      fireEvent.click(within(blocked.closest<HTMLElement>("[role=alert]")!).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
      const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: SectionMeta }];
      expect(input.meta.previousDoc).toEqual(edited);
    });

    it("a refused write of the old page blocks the rebuild in plain words; Retry tries it again, Rebuild anyway archives it", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const old = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page" }] }]);
      const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { layout: 5 }, draftBuiltAt: 1 });
      const edited = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page, too big to save" }] }]);
      const save = vi.spyOn(api, "reportSectionSave").mockImplementation(async (id) => {
        throw new RavenError("validation", `section ${id} is over 8 MiB`);
      });
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      const qc = makeQueryClient();
      queueReportSave(qc, section.id, edited, { layout: 5 });
      await flushReports();
      expect(save).toHaveBeenCalledTimes(1);

      mount("e-exam", qc);
      await ready();
      const alert = () => screen.getByText(/An earlier change to this page couldn't be saved, so Raven kept the old page/).closest<HTMLElement>("[role=alert]")!;
      await waitFor(() => expect(alert()).toBeInTheDocument());
      // The rebuild tried the refused write once more first.
      expect(save).toHaveBeenCalledTimes(2);
      expect(draftUpserts(upsert, LNX)).toHaveLength(0);
      // Retry tries it again; still refused, the page stays as it was.
      fireEvent.click(within(alert()).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(alert()).toBeInTheDocument());
      expect(draftUpserts(upsert, LNX)).toHaveLength(0);
      // Rebuild anyway: the unsaved page is the one kept, and its write never goes out again.
      fireEvent.click(within(alert()).getByRole("button", { name: "Rebuild anyway" }));
      await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
      const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: SectionMeta }];
      expect(input.meta.previousDoc).toEqual(edited);
      expect(input.meta.originals?.at(-1)).toMatchObject({ doc: edited, layout: 5, why: "rebuild" });
      await flushReports();
      expect(save).toHaveBeenCalledTimes(3);
    });

    it("Rebuild anyway waits for a write of the old page already on its way, so it never lands after the rebuild", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const old = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page" }] }]);
      const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { layout: 5 }, draftBuiltAt: 1 });
      const edited = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Old lnx02 page, edited" }] }]);
      const calls: string[] = [];
      const realSave = api.reportSectionSave;
      const realUpsert = api.reportSectionUpsert;
      let mode: "fail" | "hold" = "fail";
      let release: () => void = () => {};
      vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
        if (id !== section.id) return realSave(id, doc, meta);
        if (mode === "fail") throw new Error("disk busy");
        calls.push("save:start");
        await new Promise<void>((r) => (release = r));
        calls.push("save:end");
        return realSave(id, doc, meta);
      });
      vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
        if (input.targetKey === LNX && input.draftBuiltAt !== null) calls.push("upsert");
        return realUpsert(rid, input);
      });
      const qc = makeQueryClient();
      queueReportSave(qc, section.id, edited, { layout: 5 });
      await flushReports();
      mount("e-exam", qc);
      await ready();
      const alert = () => screen.getByText(/An earlier change to this page couldn't be saved/).closest<HTMLElement>("[role=alert]")!;
      await waitFor(() => expect(alert()).toBeInTheDocument());

      // The queue's retry sends the write; it is on its way when the owner picks Rebuild anyway.
      mode = "hold";
      void flushReports();
      await waitFor(() => expect(calls).toEqual(["save:start"]));
      fireEvent.click(within(alert()).getByRole("button", { name: "Rebuild anyway" }));
      await act(async () => {});
      expect(calls).toEqual(["save:start"]);
      await act(async () => release());
      await waitFor(() => expect(calls).toEqual(["save:start", "save:end", "upsert"]));
      const after = await stored(section.id);
      expect(after.meta).toMatchObject({ layout: 6, previousDoc: edited });
      expect(needsFlatten(after.doc!)).toBe(false);
    });

    it("a section with no page yet keeps its archive when its draft is built", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const archived = [{ doc: plainPage([]), layout: 4, meta: { layout: 4 }, at: 3, why: "rebuild" as const }];
      await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: null, meta: { layout: 5, originals: archived }, draftBuiltAt: null });
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      mount();
      await ready();
      await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
      const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: SectionMeta }];
      expect(input.meta).toEqual({ layout: 6, originals: archived });
    });

    it("a rebuild carries the owner's meta forward and archives the old page with its whole meta", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const older = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Written under layout 3" }] }]);
      const old = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Written under layout 5" }] }]);
      const was = { layout: 5, coverage: { s1: { result: "tested", note: "checked by hand" } }, removedEntryIds: ["l-gone"], previousDoc: older, previousLayout: 3, previousAt: 7 };
      await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: was, draftBuiltAt: 1 });
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      mount();
      await ready();
      await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
      const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: SectionMeta }];
      expect(input.meta).toMatchObject({ coverage: was.coverage, removedEntryIds: ["l-gone"], layout: 6, previousDoc: old, previousLayout: 5 });
      expect(input.meta.originals).toEqual([{ doc: old, layout: 5, meta: was, at: expect.any(Number), why: "rebuild" }]);
    });

    it("a page already at layout 6 is never rebuilt", async () => {
      await seedLnx();
      const upsert = vi.spyOn(api, "reportSectionUpsert");
      mount();
      await ready();
      await waitFor(() => expect(editors.length).toBeGreaterThan(0));
      expect(paper().textContent).toContain("nmap -sV 10.10.30.21");
      fireEvent.click(rowFor("ms01"));
      fireEvent.click(rowFor("lnx02"));
      await waitFor(() => expect(paper().textContent).toContain("nmap -sV 10.10.30.21"));
      expect(draftUpserts(upsert, LNX)).toHaveLength(0);
    });

    it("an owner page holding old evidence nodes opens flattened, its text kept and the original in previousDoc", async () => {
      const original = layout3Json as ReportNode;
      const report = await api.reportGetOrCreate("e-exam");
      const page = await api.reportSectionUpsert(report.id, {
        kind: "page",
        targetKey: "p-owner",
        position: 99,
        doc: original,
        meta: { title: "Owner notes", placement: "body", layout: DRAFT_LAYOUT },
        draftBuiltAt: 1,
      });
      const save = vi.spyOn(api, "reportSectionSave");
      mount();
      await ready();
      fireEvent.click(pageTab("Owner notes"));
      await waitFor(() => expect(paper().textContent).toContain("The sudo rule is the way to root."));
      expect(paper().textContent).toContain("Every tool ran from the attacking machine unless the step says otherwise.");
      // The flattened page is saved once, the page as stored kept in the meta.
      await waitFor(() => expect(save.mock.calls.some(([id]) => id === page.id)).toBe(true));
      const writes = save.mock.calls.filter(([id]) => id === page.id);
      expect(writes).toHaveLength(1);
      const [, doc, meta] = writes[0] as unknown as [string, ReportNode, SectionMeta & { title: string }];
      expect(needsFlatten(doc)).toBe(false);
      expect(meta.previousDoc).toEqual(original);
      expect(meta).toMatchObject({ title: "Owner notes", placement: "body", layout: DRAFT_LAYOUT, previousLayout: DRAFT_LAYOUT, flattened: true });
      expect(meta.originals).toEqual([{ doc: original, layout: DRAFT_LAYOUT, meta: { title: "Owner notes", placement: "body", layout: DRAFT_LAYOUT }, at: expect.any(Number), why: "flatten" }]);
      expect(screen.getByText("This page was converted to the new format.")).toBeInTheDocument();
      // Only converted, never rebuilt: there is no earlier page of the owner's to bring back.
      expect(screen.queryByRole("button", { name: "Restore your previous page" })).toBeNull();
    });

    it("a page whose conversion fails the schema check opens no editable page and is never saved", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const raw = { type: "doc", content: [{ type: "slot", attrs: { hint: "x" }, content: [{ type: "text", text: "Owner words" }] }] };
      const page = await api.reportSectionUpsert(report.id, {
        kind: "page",
        targetKey: "p-broken",
        position: 99,
        doc: raw,
        meta: { title: "Broken notes", placement: "body", layout: DRAFT_LAYOUT },
        draftBuiltAt: 1,
      });
      const schema = vi.mocked(reportSchema);
      const real = schema.getMockImplementation()!;
      schema.mockImplementation(() => ({ nodeFromJSON: () => ({ check: () => { throw new Error("Invalid content for node list"); } }) }) as never);
      try {
        const save = vi.spyOn(api, "reportSectionSave");
        mount();
        await ready();
        fireEvent.click(pageTab("Broken notes"));
        expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't convert this page to the new format");
        expect(screen.getByRole("alert")).toHaveTextContent("Invalid content for node list");
        expect(document.querySelector(".ProseMirror")).toBeNull();
        expect(editors).toHaveLength(0);
        await flushReports();
        expect(save.mock.calls.some(([id]) => id === page.id)).toBe(false);
        expect(JSON.stringify((await api.reportSectionsList(report.id)).find((x) => x.id === page.id)!.doc)).toBe(JSON.stringify(raw));
      } finally {
        schema.mockImplementation(real);
      }
    });

    it("a page whose list held only a now-private entry's copy opens flattened into a page that fits the schema", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const raw = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Owner intro" }] },
          { type: "list", attrs: { kind: "ordered" }, content: [{ type: "evidence", attrs: { entryId: "l-exam-ms01-private", block: 0, keep: null, emphasis: [], appendix: "inline" } }] },
        ],
      };
      const page = await api.reportSectionUpsert(report.id, {
        kind: "page",
        targetKey: "p-private",
        position: 99,
        doc: raw,
        meta: { title: "Private notes", placement: "body", layout: DRAFT_LAYOUT },
        draftBuiltAt: 1,
      });
      const save = vi.spyOn(api, "reportSectionSave");
      mount();
      await ready();
      fireEvent.click(pageTab("Private notes"));
      await waitFor(() => expect(paper().textContent).toContain("Owner intro"));
      await waitFor(() => expect(save.mock.calls.some(([id]) => id === page.id)).toBe(true));
      const [, doc] = save.mock.calls.filter(([id]) => id === page.id)[0] as unknown as [string, ReportNode];
      expect(() => reportSchema().nodeFromJSON(doc).check()).not.toThrow();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("a page with a kept previous page that still holds an old node opens flattened and keeps that previous page", async () => {
      const report = await api.reportGetOrCreate("e-exam");
      const kept = plainPage([{ type: "paragraph", content: [{ type: "text", text: "The page before the rebuild" }] }]);
      const raw = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Rebuilt page text" }] },
          { type: "evidence", attrs: { entryId: "l-exam-web01-sudo", block: 0, keep: null, emphasis: [], appendix: "inline" } },
        ],
      };
      const was = { layout: DRAFT_LAYOUT, previousDoc: kept, previousLayout: 5, previousAt: 7 };
      const section = await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: raw, meta: was, draftBuiltAt: 1 });
      const save = vi.spyOn(api, "reportSectionSave");
      mount();
      await ready();
      await waitFor(() => expect(paper().textContent).toContain("Rebuilt page text"));
      await waitFor(() => expect(save.mock.calls.some(([id]) => id === section.id)).toBe(true));
      const [, doc, meta] = save.mock.calls.filter(([id]) => id === section.id)[0] as unknown as [string, ReportNode, SectionMeta];
      expect(needsFlatten(doc)).toBe(false);
      expect(meta).toMatchObject({ previousDoc: kept, previousLayout: 5, previousAt: 7 });
      expect(meta.flattened).toBeUndefined();
      expect(meta.originals).toEqual([{ doc: raw, layout: DRAFT_LAYOUT, meta: was, at: expect.any(Number), why: "flatten" }]);
      // Its Restore still brings back the page from before the rebuild.
      expect(screen.getByText("This page was rebuilt for a new layout.")).toBeInTheDocument();
    });

    it("numbers a target's machine heading from the section order and renumbers after ⌥→", async () => {
      mount();
      await ready();
      fireEvent.click(rowFor("lnx02"));
      await waitFor(() => expect(machineHeading()).toEqual(["4.1", "lnx02 (10.10.30.21)"]));
      rowFor("lnx02").focus();
      fireEvent.keyDown(rowFor("lnx02"), { key: "ArrowRight", code: "ArrowRight", altKey: true });
      await waitFor(() => expect(targetLabels()).toEqual(["1 garnet", "2 lnx02", "3 ms01", "4 web01", "5 xfer03", "6 AD set"]));
      await waitFor(() => expect(machineHeading()).toEqual(["4.2", "lnx02 (10.10.30.21)"]));
    });

    it("lnx02 never started shows the not-started line and only its heading", async () => {
      mount();
      await ready();
      await waitFor(() => expect(machineHeading()?.[1]).toBe("lnx02 (10.10.30.21)"));
      expect(screen.getByText("Nothing logged on lnx02 yet. The page fills in as you work.")).toBeInTheDocument();
      // One machine heading on the page itself, and nothing drafted under a step or a hint.
      const doc = paper().querySelector(".report-page-doc")!;
      expect(doc.querySelectorAll("h1")).toHaveLength(1);
      expect(doc.textContent).not.toContain("Steps to reproduce:");
      expect(doc.querySelector('[data-list-kind="ordered"]')).toBeNull();
    });
  });

  it("guards DRAFT_LAYOUT: it is 6, and a bump keeps every stored page in previousDoc", async () => {
    // Bumping it is a data-safety change: every stored page under another layout is rebuilt, and must be kept.
    expect(DRAFT_LAYOUT).toBe(6);
    const report = await api.reportGetOrCreate("e-exam");
    const old = plainPage([{ type: "paragraph", content: [{ type: "text", text: "Written one layout ago" }] }]);
    await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: old, meta: { layout: DRAFT_LAYOUT - 1 }, draftBuiltAt: 1 });
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    mount();
    await ready();
    await waitFor(() => expect(draftUpserts(upsert, LNX)).toHaveLength(1));
    const [, input] = draftUpserts(upsert, LNX)[0] as [string, { meta: SectionMeta }];
    expect(input.meta).toMatchObject({ layout: DRAFT_LAYOUT, previousDoc: old, previousLayout: DRAFT_LAYOUT - 1 });
  });

  it("groups checks of one kind into one row and cycles through them; the fix sits in a disclosure for the picked one", async () => {
    // Two numbered steps, each opening with its entry's command and no sentence before it.
    const scan = await seedLnx();
    const whoami = await api.logCreate("e-exam", logInput("whoami", { kind: "command", blocks: [{ command: "whoami", output: "www-data" }] }, 2_000));
    const report = await api.reportGetOrCreate("e-exam");
    const lnx = (await api.reportSectionsList(report.id)).find((s) => s.targetKey === LNX)!;
    const step = (entryId: string, command: string): ReportNode => ({
      type: "list",
      attrs: { kind: "ordered" },
      content: [{ type: "codeBlock", attrs: { language: "", source: `entry:${entryId}:0:command` }, content: [{ type: "text", text: command }] }],
    });
    const blocks = plainBlocks(lnxPage(scan.id, "line 0"));
    await api.reportSectionSave(lnx.id, plainPage([blocks[0], step(scan.id, "nmap -sV 10.10.30.21"), step(whoami.id, "whoami"), blocks[4]]), { layout: DRAFT_LAYOUT });
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
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
  it("+ Page → Appendix page adds Appendix A after Closing, and opens it", async () => {
    mount();
    await ready();
    await addPage("Appendix page");
    // A target has no appendix of its own: the first appendix page is A.
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "Closing", "Appendix A"]));
    expect(detailOf(tab("Appendix A"))).toBe("Untitled appendix");
    expect(tab("Appendix A")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(h1()).toBe("Appendix A – Untitled appendix"));
    const [stored] = await pages();
    expect(stored.meta).toMatchObject({ title: "Untitled appendix", placement: "appendix", layout: DRAFT_LAYOUT });
    expect(stored.targetKey).toBeTruthy();
    expect(stored.doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("+ Page → Free page adds a numbered tab after the targets, before Closing", async () => {
    mount();
    await ready();
    await addPage("Free page");
    // The tab leads with the section number the page prints under, marked § (RAV-32), and its name says it.
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "§6 Untitled page", "Closing"]));
    expect(tab("§6 Untitled page")).toHaveAccessibleName(/^§6 Untitled page/);
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
    await waitFor(() => expect(tabLabels()).toContain("§6 Port knocking"));
    await waitFor(() => expect(h1()).toBe("6Port knocking"));
    expect(document.activeElement).toBe(tab("§6 Port knocking"));
    // F2 on the focused tab renames too; Esc keeps the title.
    fireEvent.keyDown(tab("§6 Port knocking"), { key: "F2" });
    const again = screen.getByRole("textbox", { name: "Page title" });
    fireEvent.change(again, { target: { value: "Something else" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(tabLabels()).toContain("§6 Port knocking");
    await waitFor(async () => expect((await pages())[0].meta).toMatchObject({ title: "Port knocking", placement: "body" }));
  });

  it("⌥→ on a free page's tab moves it later: its tab number and printed number move together (RAV-32)", async () => {
    mount();
    await ready();
    await addPage("Free page");
    await waitFor(() => expect(tabLabels()).toContain("§6 Untitled page"));
    // Tell them apart: rename the first, then add a second.
    fireEvent.keyDown(tab("§6 Untitled page"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Page title" });
    fireEvent.change(input, { target: { value: "Alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(tabLabels()).toContain("§6 Alpha"));
    await addPage("Free page");
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "§6 Alpha", "§7 Untitled page", "Closing"]));
    fireEvent.keyDown(tab("§6 Alpha"), { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(tabLabels()).toEqual(["Front matter", ...TARGETS, "§6 Untitled page", "§7 Alpha", "Closing"]));
    fireEvent.click(tab("§7 Alpha"));
    await waitFor(() => expect(h1()).toBe("7Alpha"));
    fireEvent.click(tab("§6 Untitled page"));
    await waitFor(() => expect(h1()).toBe("6Untitled page"));
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

describe("Report view: undoing a page delete", () => {
  const addPage = async (kind: "Appendix page" | "Free page") => {
    fireEvent.click(screen.getByRole("button", { name: "+ Page" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: kind }));
  };
  const ordered = async () => {
    const report = await api.reportGetOrCreate("e-exam");
    return (await api.reportSectionsList(report.id)).sort((a, b) => a.position - b.position);
  };

  it("puts the page back at its old place, every position still unique, after a page was added meanwhile", async () => {
    mount();
    await ready();
    await addPage("Appendix page");
    await waitFor(() => expect(tabLabels()).toContain("Appendix A"));
    await addPage("Appendix page");
    await waitFor(() => expect(tabLabels()).toContain("Appendix B"));
    const before = await ordered();
    const victim = before.filter((s) => s.kind === "page").at(-1)!;
    const oldIndex = before.findIndex((s) => s.id === victim.id);

    fireEvent.keyDown(tab("Appendix B"), { key: "Backspace" });
    const dialog = await screen.findByRole("dialog", { name: "Delete Untitled appendix? Its text goes with it." });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete page" }));
    await waitFor(() => expect(tabLabels()).not.toContain("Appendix B"));
    // A page added meanwhile takes the deleted page's position.
    await addPage("Free page");
    await waitFor(() => expect(tabLabels().some((l) => /^§\d+ Untitled page$/.test(l))).toBe(true));

    const notice = (await screen.findAllByRole("status")).find((n) => n.textContent?.includes("Deleted Untitled appendix"))!;
    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(tabLabels()).toContain("Appendix B"));
    await waitFor(async () => {
      const after = await ordered();
      expect(new Set(after.map((s) => s.position)).size).toBe(after.length);
      expect(after.findIndex((s) => s.targetKey === victim.targetKey)).toBe(oldIndex);
    });
  });
});

describe("Report view: Move to appendix", () => {
  const paper = () => document.querySelector<HTMLElement>(".report-page")!;
  const h1 = () => within(paper()).queryByRole("heading", { level: 1 })?.textContent;
  const sources = (n: ReportNode): string[] => [...(typeof n.attrs?.source === "string" ? [n.attrs.source] : []), ...(n.content ?? []).flatMap(sources)];
  const pages = async () => (await api.reportSectionsList((await api.reportGetOrCreate("e-exam")).id)).filter((s) => s.kind === "page");

  it("moves a block to a new appendix page and back with the notice's Undo; the page it left doesn't add it again", async () => {
    await seedLnx();
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    const editor = pageEditor();
    await waitFor(() => expect(editor.mounted).toBe(true));
    // The scan's output is its only block on the page: its command goes first, as the page's own change.
    act(() => {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at === -1 && /^entry:.+:command$/.test(String(node.attrs.source))) at = pos;
        return at === -1;
      });
      editor.view.dispatch(editor.state.tr.delete(at, at + editor.state.doc.nodeAt(at)!.nodeSize).setMeta(PROGRAMMATIC, true));
    });
    let block: { node: import("prosekit/pm/model").Node; pos: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (!block && node.type.name === "codeBlock" && /^entry:.+:output$/.test(String(node.attrs.source))) block = { node, pos };
      return !block;
    });
    expect(block).not.toBeNull();
    const source = String(block!.node.attrs.source);
    const entryId = source.split(":")[1];
    const root = document.querySelector("prosekit-block-handle-root")!;
    act(() => void root.dispatchEvent(Object.assign(new Event("stateChange"), { detail: block })));
    fireEvent.click(screen.getByRole("button", { name: "Block actions", hidden: true }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to appendix…" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New appendix page" }));

    await waitFor(() => expect(tabLabels()).toContain("Appendix A"));
    const notice = (await screen.findAllByRole("status")).find((n) => n.textContent?.includes("Moved to Appendix A"))!;
    expect(notice).toBeDefined();
    expect(sources(editor.getDocJSON() as ReportNode)).not.toContain(source);
    const [stored] = await pages();
    expect(stored.meta).toMatchObject({ placement: "appendix" });
    expect(sources(stored.doc!)).toEqual([source]);
    // Its entry is in the report, on the appendix page: Add new evidence doesn't put it back, and it isn't removed.
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    await act(() => flushReports());
    expect(sources(editor.getDocJSON() as ReportNode).some((s) => s.startsWith(`entry:${entryId}`))).toBe(false);
    const report = await api.reportGetOrCreate("e-exam");
    const target = (await api.reportSectionsList(report.id)).find((s) => s.kind === "target" && s.targetKey === LNX)!;
    expect((target.meta as SectionMeta).removedEntryIds ?? []).not.toContain(entryId);

    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(tabLabels()).not.toContain("Appendix A"));
    expect(await pages()).toEqual([]);
    expect(sources(editor.getDocJSON() as ReportNode)).toContain(source);
    expect(h1()).not.toMatch(/Appendix/);
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

  it("shows a single check's text once when its row already reads in full, keeping its fix and action", () => {
    const run = vi.fn();
    render(
      <TooltipProvider>
        <CheckList
          checks={[{ id: "coverage:s1", level: "soft", text: "22/tcp on ms01 is untested.", fix: "nmap -p22 ms01" }]}
          onPick={() => {}}
          actionFor={() => ({ label: "Mark tested", run })}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByText("22/tcp on ms01 is untested"));
    expect(screen.getAllByText(/22\/tcp on ms01 is untested/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Fix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark tested" })).toBeInTheDocument();
  });

  it("shows an action's note, saying what it does, with the action", () => {
    render(
      <TooltipProvider>
        <CheckList
          checks={[{ id: "copied-deleted:e1", level: "fail", text: "A block on the page comes from an entry that was deleted." }]}
          onPick={() => {}}
          actionFor={() => ({ label: "Keep the text", note: "It stays as yours.", run: () => {} })}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText("It stays as yours.")).toBeNull();
    fireEvent.click(screen.getByText("Block from a deleted entry"));
    expect(screen.getByText("It stays as yours.")).toBeInTheDocument();
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

describe("TodoPanel dismissals", () => {
  it("dismisses the picked check, or all of its kind, and lists dismissed ones folded", () => {
    const onDismiss = vi.fn();
    const onRestore = vi.fn();
    const checks = [
      { id: "explain:a", level: "soft" as const, text: "A step has no explanation before it." },
      { id: "explain:b", level: "soft" as const, text: "A step has no explanation before it." },
    ];
    render(
      <TooltipProvider>
        <TodoPanel
          checks={checks}
          dismissed={[{ id: "caption:x", level: "soft", text: "A screenshot caption is over 10 words." }]}
          onPick={() => {}}
          onDismiss={onDismiss}
          onRestore={onRestore}
          onClose={() => {}}
        />
      </TooltipProvider>,
    );
    const panel = screen.getByRole("region", { name: "To do" });
    expect(within(panel).queryByRole("button", { name: "Dismiss" })).toBeNull();
    fireEvent.click(within(within(panel).getByRole("list", { name: "Checks" })).getAllByRole("button")[0]);
    fireEvent.click(within(panel).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenLastCalledWith(["explain:a"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Dismiss all 2" }));
    expect(onDismiss).toHaveBeenLastCalledWith(["explain:a", "explain:b"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Dismissed (1)" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Bring back" }));
    expect(onRestore).toHaveBeenCalledWith(["caption:x"]);
  });
});

describe("pruneRemoved", () => {
  const block = (entryId: string) => ({ type: "codeBlock", attrs: { source: `entry:${entryId}:0:output` } });
  it("drops removed ids whose entry is on the page again (undo) and keeps the rest", () => {
    const doc = { type: "doc", content: [block("a"), { type: "figure", attrs: { entryId: "c" } }, { type: "paragraph", attrs: { also: ["d"] } }] };
    expect(pruneRemoved(doc, { removedEntryIds: ["b", "c", "d"] })).toEqual({ removedEntryIds: ["b"] });
    expect(pruneRemoved(doc, { removedEntryIds: ["a", "b"], layout: 3 })).toEqual({ removedEntryIds: ["b"], layout: 3 });
    const meta = { removedEntryIds: ["b"] };
    expect(pruneRemoved(doc, meta)).toBe(meta);
  });
});
