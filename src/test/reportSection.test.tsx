import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { TextSelection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resetAuditState } from "../audit/fakeApi";
import { ReportSectionView } from "../features/report/ReportSection";
import { pruneRemoved } from "../features/report/queries";
import { makeQueryClient } from "../lib/queryClient";
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

afterEach(() => {
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

const outline = () => screen.getByRole("navigation", { name: "Report outline" });
const targetGroup = () => within(outline()).getByRole("group", { name: "Targets, in grading order" });
const targetRows = () => [...targetGroup().querySelectorAll<HTMLElement>("[data-outline-row]")];
const row = (name: string | RegExp) => within(outline()).getByRole("button", { name });
const rowFor = (label: string) => targetRows().find((r) => r.textContent?.startsWith(label))!;

async function ready() {
  await waitFor(() => expect(targetRows().length).toBeGreaterThan(0));
}

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
    await waitFor(() => expect(targetRows().map((r) => r.textContent)).toEqual(["lnx02.21", "ms01.5", "web01.20", "AD set: ad02, dc01"]));
    expect(screen.getByRole("group", { name: "Report OSCP-OS-?????-Exam-Report.pdf" })).toBeInTheDocument();

    fireEvent.click(row(/Report details/));
    const osid = await screen.findByLabelText("OSID");
    fireEvent.change(osid, { target: { value: "OS-48213" } });
    fireEvent.blur(osid);
    expect(await screen.findByRole("group", { name: "Report OSCP-OS-48213-Exam-Report.pdf" })).toBeInTheDocument();
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
    await waitFor(() => expect(targetRows()).toHaveLength(4));

    await act(async () => {
      await api.hostDelete("h-exam-web");
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(targetRows().map((r) => r.textContent)).toEqual(["lnx02.21", "ms01.5", "AD set: ad02, dc01"]));

    let created = "";
    await act(async () => {
      created = (await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never)).id;
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(targetRows().some((r) => r.textContent === "files03.33")).toBe(true));
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

  it("shows a failed section setup with Retry, keeping the outline", async () => {
    const real = api.reportSectionUpsert;
    let fail = false;
    vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
      if (fail && input.draftBuiltAt === null) throw new Error("db busy");
      return real(rid, input);
    });
    const { qc } = mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(4));

    fail = true;
    await act(async () => {
      await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never);
      await qc.invalidateQueries();
    });
    expect(await screen.findByText(/Couldn't add the report's new sections/)).toBeInTheDocument();
    expect(targetRows()).toHaveLength(4);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(targetRows().some((r) => r.textContent === "files03.33")).toBe(true));
    expect(screen.queryByText(/Couldn't add the report's new sections/)).not.toBeInTheDocument();
  });

  it("shows a placeholder for client engagements", async () => {
    mount("e-old");
    expect(await screen.findByText("Client reports come after the exam")).toBeInTheDocument();
  });

  it("moves a target down the grading order with ⌥↓", async () => {
    const reorder = vi.spyOn(api, "reportSectionsReorder");
    mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(4));
    const first = rowFor("lnx02");
    const lnxId = first.dataset.id!;
    const msId = rowFor("ms01").dataset.id!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    await waitFor(() => expect(targetRows().map((r) => r.textContent)).toEqual(["ms01.5", "lnx02.21", "web01.20", "AD set: ad02, dc01"]));
    expect(reorder).toHaveBeenCalledTimes(1);
    const ids = reorder.mock.calls[0][1];
    expect(ids.indexOf(msId)).toBeLessThan(ids.indexOf(lnxId));
    expect(document.activeElement).toBe(rowFor("lnx02"));
  });
});

describe("pruneRemoved", () => {
  const ev = (entryId: string) => ({ type: "evidence", attrs: { entryId } });
  it("drops removed ids whose entry is on the page again (undo) and keeps the rest", () => {
    const doc = { type: "doc", content: [ev("a")] };
    expect(pruneRemoved(doc, { removedEntryIds: ["a", "b"], method: "x" })).toEqual({ removedEntryIds: ["b"], method: "x" });
    const meta = { removedEntryIds: ["b"] };
    expect(pruneRemoved(doc, meta)).toBe(meta);
  });
});
