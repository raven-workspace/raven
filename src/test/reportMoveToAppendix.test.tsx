import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportNode } from "../engines/report";
import { ReportDataContext, type ReportDataValue } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { moveToAppendix, undoMoveToAppendix } from "../features/report/moveToAppendix";
import { reportSectionsKey } from "../features/report/queries";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import { RavenError } from "../types/errors";
import type { Report, ReportSection } from "../types/report";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const para = (text: string, source?: string): ReportNode => ({ type: "paragraph", attrs: source ? { source } : {}, content: [{ type: "text", text }] });
const output: ReportNode = { type: "codeBlock", attrs: { language: "", source: "entry:l1:0:output", also: ["f1"] }, content: [{ type: "text", text: "uid=0(root)" }] };
const step: ReportNode = { type: "list", attrs: { kind: "ordered" }, content: [para("Ran id.", "entry:l1:title"), output] };
const targetDoc: ReportNode = { type: "doc", content: [para("Steps to reproduce:"), step, para("After.")] };

const report = { id: "r1", engagementId: "e1", meta: {} } as unknown as Report;
const section = (id: string, kind: ReportSection["kind"], doc: ReportNode, meta: Record<string, unknown> = {}): ReportSection =>
  ({ id, reportId: "r1", kind, targetKey: id, position: 0, doc, meta, draftBuiltAt: 1 }) as unknown as ReportSection;
const appendixPage = section("a1", "page", { type: "doc", content: [para("Loot")] }, { title: "Loot", placement: "appendix" });
const data = { log: [], attempts: [], hosts: [] } as unknown as ReportData;

function mount(qc: QueryClient, context: Partial<ReportDataValue> = {}) {
  const ref: { editor: Editor | null } = { editor: null };
  const onRemoveEvidence = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ReportDataContext.Provider value={{ data, onRemoveEvidence, reportMeta: {}, ...context }}>
          <ReportEditor doc={targetDoc} onChange={vi.fn()} onReady={(e) => (ref.editor = e)} />
        </ReportDataContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onRemoveEvidence, editor: () => ref.editor! };
}

/** The block whose source is `source`, with its position. */
function blockOf(editor: Editor, source: string): { node: PMNode; pos: number } {
  let found: { node: PMNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.attrs.source === source) found = { node, pos };
    return !found;
  });
  expect(found).not.toBeNull();
  return found!;
}
const json = (editor: Editor) => editor.getDocJSON() as ReportNode;
const sources = (n: ReportNode): string[] => [...(typeof n.attrs?.source === "string" ? [n.attrs.source] : []), ...(n.content ?? []).flatMap(sources)];

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

let qc: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  qc = makeQueryClient();
  qc.setQueryData(reportSectionsKey("r1"), [section("t1", "target", targetDoc), appendixPage]);
  m.reportSectionsSave.mockImplementation(async (_r, writes) => writes.map((w) => section(w.id, "page", w.doc, w.meta)));
});

describe("the block menu's Move to appendix", () => {
  const appendices = [{ sectionId: "a1", label: "Appendix A – Loot" }];

  async function openMenu(p: ReturnType<typeof mount>, block: { node: PMNode; pos: number }) {
    const root = p.container.querySelector("prosekit-block-handle-root")!;
    act(() => void root.dispatchEvent(Object.assign(new Event("stateChange"), { detail: block })));
    fireEvent.click(screen.getByRole("button", { name: "Block actions", hidden: true }));
    await screen.findByRole("menu", { name: "Block actions" });
  }

  it("turns the menu into the appendix pages and New appendix page, by keyboard too", async () => {
    const onMoveToAppendix = vi.fn();
    const p = mount(qc, { appendices, onMoveToAppendix });
    await waitFor(() => expect(p.editor()?.mounted).toBe(true));
    const block = blockOf(p.editor(), "entry:l1:0:output");
    await openMenu(p, block);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to appendix…" }));
    await waitFor(() => expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Appendix A – Loot", "New appendix page"]));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Appendix A – Loot" }));
    fireEvent.keyDown(screen.getByRole("menu", { name: "Block actions" }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "New appendix page" }));
    fireEvent.click(document.activeElement!);
    expect(onMoveToAppendix).toHaveBeenCalledWith(block, null);
  });

  it("isn't offered on an appendix page", async () => {
    const p = mount(qc, { onMoveToAppendix: vi.fn() });
    await waitFor(() => expect(p.editor()?.mounted).toBe(true));
    await openMenu(p, blockOf(p.editor(), "entry:l1:0:output"));
    expect(screen.queryByRole("menuitem", { name: "Move to appendix…" })).toBeNull();
  });
});

describe("moveToAppendix", () => {
  it("writes both pages in one save, then takes the block off the page without counting it removed", async () => {
    const p = mount(qc);
    await waitFor(() => expect(p.editor()?.mounted).toBe(true));
    const moved = await act(() => moveToAppendix(qc, report, p.editor(), "t1", blockOf(p.editor(), "entry:l1:0:output"), "a1"));

    expect(m.reportSectionsSave).toHaveBeenCalledTimes(1);
    const [reportId, writes] = m.reportSectionsSave.mock.calls[0];
    expect(reportId).toBe("r1");
    expect(writes.map((w) => w.id)).toEqual(["t1", "a1"]);
    expect(writes[1].doc.content!.map((n) => n.type)).toEqual(["paragraph", "codeBlock"]);
    expect(writes[1].doc.content![1].attrs).toMatchObject({ source: "entry:l1:0:output", also: ["f1"] });
    expect(sources(writes[0].doc)).not.toContain("entry:l1:0:output");
    expect(sources(json(p.editor()))).toEqual(["entry:l1:title"]);
    expect(p.onRemoveEvidence).not.toHaveBeenCalled();
    expect(moved).toMatchObject({ sourceId: "t1", appendixId: "a1", created: false, path: [1, 1] });
    // The cached pages hold what was written: the appendix page's tab and the evidence column read them.
    const cached = qc.getQueryData<ReportSection[]>(reportSectionsKey("r1"))!;
    expect(cached.find((s) => s.id === "a1")!.doc).toEqual(writes[1].doc);

    // Undo puts it back where it stood and takes it off the appendix page, in one save.
    await act(() => undoMoveToAppendix(qc, report, p.editor(), moved));
    expect(sources(json(p.editor()))).toEqual(["entry:l1:title", "entry:l1:0:output"]);
    const [, back, deleted] = m.reportSectionsSave.mock.calls[1];
    expect(back.map((w) => w.id)).toEqual(["t1", "a1"]);
    expect(back[1].doc).toEqual({ type: "doc", content: [para("Loot")] });
    expect(deleted).toBeNull();
    expect(p.onRemoveEvidence).not.toHaveBeenCalled();
  });

  it("stays out of the page's ⌘Z", async () => {
    const p = mount(qc);
    await waitFor(() => expect(p.editor()?.mounted).toBe(true));
    await act(() => moveToAppendix(qc, report, p.editor(), "t1", blockOf(p.editor(), "entry:l1:0:output"), "a1"));
    const after = json(p.editor());
    act(() => void (p.editor().commands as unknown as { undo(): boolean }).undo());
    expect(json(p.editor())).toEqual(after);
  });

  it("makes a new appendix page for New appendix page, and Undo deletes it", async () => {
    const created = section("a2", "page", { type: "doc", content: [{ type: "paragraph" }] }, { title: "Untitled appendix", placement: "appendix" });
    m.reportSectionUpsert.mockResolvedValue(created);
    const p = mount(qc);
    await waitFor(() => expect(p.editor()?.mounted).toBe(true));
    const moved = await act(() => moveToAppendix(qc, report, p.editor(), "t1", blockOf(p.editor(), "entry:l1:0:output"), null));

    expect(m.reportSectionUpsert).toHaveBeenCalledWith("r1", expect.objectContaining({ kind: "page", meta: expect.objectContaining({ placement: "appendix" }) }));
    const [, writes] = m.reportSectionsSave.mock.calls[0];
    // The new page's one empty paragraph gives way to the block.
    expect(writes[1]).toMatchObject({ id: "a2", doc: { type: "doc", content: [{ type: "codeBlock" }] } });
    expect(moved.created).toBe(true);
    expect(qc.getQueryData<ReportSection[]>(reportSectionsKey("r1"))!.map((s) => s.id)).toEqual(["t1", "a1", "a2"]);

    await act(() => undoMoveToAppendix(qc, report, p.editor(), moved));
    const [, back, deleted] = m.reportSectionsSave.mock.calls[1];
    expect(back.map((w) => w.id)).toEqual(["t1"]);
    expect(deleted).toBe("a2");
    expect(qc.getQueryData<ReportSection[]>(reportSectionsKey("r1"))!.map((s) => s.id)).toEqual(["t1", "a1"]);
    expect(sources(json(p.editor()))).toContain("entry:l1:0:output");
  });

  it("changes nothing when the save fails, and drops a page it made for the move", async () => {
    m.reportSectionsSave.mockRejectedValue(new RavenError("validation", "this page is over 8 MiB"));
    m.reportSectionUpsert.mockResolvedValue(section("a2", "page", { type: "doc", content: [{ type: "paragraph" }] }, { placement: "appendix" }));
    m.reportSectionDelete.mockResolvedValue(null);
    const p = mount(qc);
    await waitFor(() => expect(p.editor()?.mounted).toBe(true));
    const before = json(p.editor());

    await expect(moveToAppendix(qc, report, p.editor(), "t1", blockOf(p.editor(), "entry:l1:0:output"), "a1")).rejects.toThrow("over 8 MiB");
    expect(json(p.editor())).toEqual(before);
    expect(qc.getQueryData<ReportSection[]>(reportSectionsKey("r1"))!.find((s) => s.id === "a1")!.doc).toEqual(appendixPage.doc);

    await expect(moveToAppendix(qc, report, p.editor(), "t1", blockOf(p.editor(), "entry:l1:0:output"), null)).rejects.toThrow("over 8 MiB");
    expect(m.reportSectionDelete).toHaveBeenCalledWith("r1", "a2");
    expect(qc.getQueryData<ReportSection[]>(reportSectionsKey("r1"))!.map((s) => s.id)).toEqual(["t1", "a1"]);
    expect(json(p.editor())).toEqual(before);
  });
});
