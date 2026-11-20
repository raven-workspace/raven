import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NodeSelection } from "prosekit/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "prosekit/core";
import { subsectionNumbers, type ReportData, type ReportNode } from "../engines/report";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { collectInserted, insertBlocksAt } from "../features/report/editor/pageActions";
import { hasPageCursor, posAtPath, removeExact, ReportEditor, selectBlockAt } from "../features/report/editor/ReportEditor/ReportEditor";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const host = { id: "h1", name: "DC01", ip: "10.0.0.5", os: "windows", access: "root", adSetEffective: false } as Host;
const entry = (o: Record<string, unknown>) =>
  ({
    id: "e1",
    kind: "command",
    title: "Full port scan",
    ranOn: "Kali (VM)",
    private: false,
    hostIds: ["h1"],
    returnedNothing: false,
    at: 1000,
    createdAt: 1000,
    content: { kind: "command", blocks: [{ command: "nmap -p- 10.0.0.5", output: "PORT   STATE SERVICE\n22/tcp open  ssh" }] },
    ...o,
  }) as unknown as LogEntry;

function data(o: Partial<ReportData> = {}): ReportData {
  return {
    engagement: { id: "eng", kind: "exam-sim" },
    hosts: [host],
    services: [],
    log: [entry({})],
    checklist: [],
    findings: [],
    findingFiles: [],
    attempts: [],
    ruledOut: [],
    grants: [],
    usernames: [],
    hops: [],
    cleanup: [],
    notes: [],
    credentials: [], credAttempts: [],
    ...o,
  } as unknown as ReportData;
}

const para = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const code = (text: string): ReportNode => ({ type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text }] });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
/** A plain page's numbered step for an entry, as the draft writes one: a list item whose first block is sourced. */
const stepOf = (id: string): ReportNode => ({
  type: "list",
  attrs: { kind: "ordered" },
  content: [{ type: "paragraph", attrs: { source: `entry:${id}:title` }, content: [{ type: "text", text: `Run ${id}:` }] }],
});

function setup(page: ReportNode, d: ReportData = data()) {
  const onChange = vi.fn();
  const onRemoveEvidence = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data: d, onRemoveEvidence }}>
        <ReportEditor doc={page} onChange={onChange} onReady={(e) => (ref.editor = e)} />
      </ReportDataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, onChange, onRemoveEvidence, editor: () => ref.editor! };
}

const lastDoc = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as ReportNode;
const undo = (editor: Editor) => act(() => void fireEvent.keyDown(editor.view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true }));

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ machines: ["Kali (VM)"] } as Settings);
  m.attachmentGet.mockResolvedValue({ id: "a1", mime: "image/png", dataBase64: "AAAA" });
});

describe("ReportEditor copied text", () => {
  it("marks text copied from an entry that is now private or deleted in amber, and only those", async () => {
    const note = (entryId: string, text: string): ReportNode => ({ type: "paragraph", attrs: { source: `entry:${entryId}:note` }, content: [{ type: "text", text }] });
    const shell: ReportNode = { type: "codeBlock", attrs: { language: "", source: "entry:e1:0:command" }, content: [{ type: "text", text: "whoami" }] };
    const hidden = entry({ id: "n1", kind: "note", private: true, content: { kind: "note", text: "kept" } });
    const { container } = setup(doc(note("n1", "now private"), note("n9", "deleted note"), note("e1", "still here"), shell), data({ log: [hidden, entry({})] }));
    await waitFor(() => expect(container.querySelector("[data-source-gone]")).toBeTruthy());
    const marked = [...container.querySelectorAll("[data-source-gone]")].map((el) => [el.getAttribute("data-source-gone"), el.textContent]);
    expect(marked).toEqual([
      ["private", "now private"],
      ["deleted", "deleted note"],
    ]);
  });
});

describe("ReportEditor removing evidence", () => {
  it("Backspace on a selected figure removes it and reports the entry; undo brings it back", async () => {
    const figure: ReportNode = { type: "figure", attrs: { attachmentId: "a1", entryId: "e1", source: "entry:e1" } };
    const { onChange, onRemoveEvidence, editor } = setup(doc(figure, para("after")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "Backspace", code: "Backspace", keyCode: 8 });
    });
    expect(onRemoveEvidence).toHaveBeenCalledWith("e1");
    await waitFor(() => expect(lastDoc(onChange).content?.some((n) => n.type === "figure")).toBe(false));
    // jsdom's navigator is not a Mac, so Mod-z is Ctrl-z here (⌘Z in the app).
    undo(editor());
    await waitFor(() => expect(lastDoc(onChange).content?.[0]).toMatchObject({ type: "figure", attrs: { entryId: "e1" } }));
    expect(onRemoveEvidence).toHaveBeenCalledTimes(1);
  });

  it("a list item taken off the page reports its entry; an insert, its removeExact Undo and ⌘Z of an insert never do", async () => {
    const { onRemoveEvidence, editor } = setup(doc(para("intro"), stepOf("e1")));
    await waitFor(() => expect(editor()).toBeTruthy());
    let added: ReturnType<typeof insertBlocksAt> = [];
    act(() => {
      added = collectInserted(editor(), () => void insertBlocksAt(editor(), 2, [stepOf("e3")]));
    });
    expect(JSON.stringify(editor().getDocJSON())).toContain("entry:e3");
    act(() => void removeExact(editor(), added));
    expect(JSON.stringify(editor().getDocJSON())).not.toContain("entry:e3");
    act(() => void insertBlocksAt(editor(), 2, [stepOf("e3")]));
    undo(editor());
    expect(JSON.stringify(editor().getDocJSON())).not.toContain("entry:e3");
    expect(onRemoveEvidence).not.toHaveBeenCalled();
    // The owner deleting the item holding e1 is a removal.
    const view = editor().view;
    const at = view.state.doc.child(0).nodeSize;
    act(() => view.dispatch(view.state.tr.delete(at, at + view.state.doc.nodeAt(at)!.nodeSize)));
    expect(onRemoveEvidence.mock.calls).toEqual([["e1"]]);
    // Its undo is not a removal either.
    undo(editor());
    expect(JSON.stringify(editor().getDocJSON())).toContain("entry:e1");
    expect(onRemoveEvidence.mock.calls).toEqual([["e1"]]);
  });
});

describe("ReportEditor moving blocks and helpers", () => {
  it("Alt-ArrowDown and Alt-ArrowUp move the selected block by one", async () => {
    const { onChange, editor } = setup(doc(code("nmap"), para("a"), para("b")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "ArrowDown", code: "ArrowDown", keyCode: 40, altKey: true });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["paragraph", "codeBlock", "paragraph"]));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "ArrowUp", code: "ArrowUp", keyCode: 38, altKey: true });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["codeBlock", "paragraph", "paragraph"]));
  });

  it("removeExact takes exactly the inserted blocks off, and leaves one the owner has since edited", async () => {
    const { onChange, editor } = setup(doc(para("own")));
    await waitFor(() => expect(editor()).toBeTruthy());
    let added: ReturnType<typeof insertBlocksAt> = [];
    act(() => {
      added = collectInserted(editor(), () => void insertBlocksAt(editor(), 1, [para("added")]));
    });
    await waitFor(() => expect(lastDoc(onChange).content).toHaveLength(2));
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.insertText("Typed ", view.state.doc.child(0).nodeSize + 1)));
    act(() => {
      expect(removeExact(editor(), added)).toBe(false);
    });
    await waitFor(() => expect(lastDoc(onChange).content).toHaveLength(2));
  });

  it("posAtPath names the block at an index path, and selectBlockAt selects it", async () => {
    const { editor } = setup(doc(para("a"), { type: "list", attrs: { kind: "bullet" }, content: [para("x"), code("y")] }));
    await waitFor(() => expect(editor()).toBeTruthy());
    const top = editor().state.doc;
    expect(posAtPath(top, "0")).toBe(0);
    expect(posAtPath(top, "1")).toBe(top.child(0).nodeSize);
    const inner = posAtPath(top, "1.1")!;
    expect(top.nodeAt(inner)?.type.name).toBe("codeBlock");
    expect(posAtPath(top, "1.5")).toBeNull();
    expect(posAtPath(top, "2")).toBeNull();
    act(() => selectBlockAt(editor(), inner));
    const sel = editor().state.selection;
    expect(sel instanceof NodeSelection && sel.node.type.name).toBe("codeBlock");
  });
});

describe("ReportEditor block tools", () => {
  it("counts the page as touched only once the owner clicks or focuses into it, not on ProseMirror's default selection", async () => {
    const { editor } = setup(doc(code("nmap"), para("a")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    expect(hasPageCursor(editor())).toBe(false);
    fireEvent.pointerDown(view.dom);
    expect(hasPageCursor(editor())).toBe(true);
  });
});

describe("ReportEditor numbered sub-sections", () => {
  it("numbers a report-level page's drafted sub-sections, never a heading the owner added", async () => {
    const h = (text: string): ReportNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
    const page = doc(h("Information Gathering"), h("My own notes"), h("Service Enumeration"));
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <ReportDataContext.Provider value={{ data: data(), onRemoveEvidence: vi.fn() }}>
          <ReportEditor
            title="Methodologies"
            titleNumber="3"
            subNumbers={(d) => subsectionNumbers("methodology", "3", d)}
            doc={page}
            onChange={vi.fn()}
            onReady={vi.fn()}
          />
        </ReportDataContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByText("Information Gathering");
    expect([...container.querySelectorAll(".ProseMirror > h2")].map((el) => el.getAttribute("data-number"))).toEqual(["3.1", null, "3.2"]);
  });
});
