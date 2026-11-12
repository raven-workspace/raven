import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppendixIndex, ReportData, ReportNode } from "../engines/report";
import { ReportDataContext } from "../features/report/editor/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor";
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
    content: { kind: "command", blocks: [{ command: "nmap -p- 10.0.0.5", output: "22/tcp open ssh" }] },
    ...o,
  }) as unknown as LogEntry;
const shot = (id: string, title: string) =>
  entry({ id, title, kind: "screenshot", content: { kind: "screenshot", attachmentId: "a1", caption: title, fileName: "x.png" } });

const data = (log: LogEntry[]) =>
  ({
    engagement: { id: "eng", kind: "exam-sim" },
    hosts: [host],
    services: [],
    log,
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
    credentials: [],
  }) as unknown as ReportData;

const ev = (entryId: string, extra: Record<string, unknown> = {}): ReportNode => ({
  type: "evidence",
  attrs: { entryId, block: null, keep: null, emphasis: [], appendix: "inline", ...extra },
});
const slot = (text?: string): ReportNode => ({
  type: "slot",
  attrs: { hint: "What this shows" },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const noRefs: AppendixIndex = { entries: [], refFor: () => null };

function setup(page: ReportNode, log: LogEntry[] = [entry({})], services: unknown[] = []) {
  const onChange = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data: { ...data(log), services } as ReportData, appendix: noRefs, sectionMeta: {}, onRemoveEvidence: vi.fn() }}>
        <ReportEditor sectionId="s1" doc={page} onChange={onChange} onReady={(e) => (ref.editor = e)} />
      </ReportDataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, onChange, editor: () => ref.editor! };
}

/** jsdom has no layout: lay the page's top-level blocks out as 90px rows, 100px apart, 800px wide. */
function layOut(editor: Editor) {
  const dom = editor.view.dom;
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === dom) return new DOMRect(0, 0, 800, dom.children.length * 100);
    const i = Array.prototype.indexOf.call(dom.children, this);
    return i >= 0 ? new DOMRect(0, i * 100, 800, 90) : new DOMRect(0, 0, 0, 0);
  });
}

/** A pointer event at (x, y); ProseKit's hover reads `x`/`y`, which jsdom's events don't carry. */
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: type !== "pointerenter" });
  Object.defineProperties(event, { x: { value: x }, y: { value: y } });
  return event;
}

const dataTransfer = () => {
  const store = new Map<string, string>();
  return {
    files: [],
    types: [] as string[],
    effectAllowed: "all",
    dropEffect: "move",
    clearData: () => store.clear(),
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? "",
    setDragImage: () => {},
  };
};

const topLevel = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.type.name === "evidence" ? (n.attrs.entryId as string) : n.type.name));
  return out;
};

// jsdom has no layout for ranges: commands that scroll the selection into view measure one.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ machines: ["Kali (VM)"] } as Settings);
  m.attachmentGet.mockResolvedValue({ id: "a1", mime: "image/png", dataBase64: "AAAA" });
});
afterEach(() => vi.restoreAllMocks());

describe("Block handle", () => {
  it("shows a Drag to move handle beside the hovered block", async () => {
    const { container, editor } = setup(doc(slot("Intro"), ev("e1"), slot()));
    await waitFor(() => expect(editor()?.mounted).toBe(true));
    const grip = screen.getByLabelText("Drag to move");
    const positioner = container.querySelector(".report-handle")!;
    expect(positioner).not.toHaveAttribute("data-state", "open");
    layOut(editor());
    act(() => void editor().view.dom.dispatchEvent(pointer("pointerenter", 400, 140)));
    await waitFor(() => expect(positioner).toHaveAttribute("data-state", "open"));
    expect(grip.closest(".report-handle")).toBe(positioner);
  });

  it("drags a screenshot to after the first block, attrs unchanged, and undo puts it back", async () => {
    const log = [entry({}), shot("s1", "Login page")];
    const moved = ev("s1", { emphasis: [], appendix: "inline", keep: null });
    const { editor, onChange } = setup(doc(slot("Intro"), ev("e1"), slot("After"), moved), log);
    await waitFor(() => expect(editor()?.mounted).toBe(true));
    const view = editor().view;
    const before = editor().state.doc.child(3).attrs;
    layOut(editor());

    // Hover the screenshot (4th block, y 300..390), then drag its handle.
    act(() => void view.dom.dispatchEvent(pointer("pointerenter", 400, 340)));
    const grip = screen.getByLabelText("Drag to move");
    await waitFor(() => expect(grip.closest(".report-handle")).toHaveAttribute("data-state", "open"));
    const transfer = dataTransfer();
    fireEvent.dragStart(grip, { dataTransfer: transfer, clientX: 0, clientY: 340 });
    expect(view.dragging?.move).toBe(true);

    // Drop on the line under the first block (its bottom edge is at y 90).
    view.posAtCoords = () => ({ pos: editor().state.doc.child(0).nodeSize, inside: -1 });
    const drop = new MouseEvent("drop", { clientX: 400, clientY: 90, bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: transfer });
    act(() => void view.dom.dispatchEvent(drop));
    expect(topLevel(editor())).toEqual(["slot", "s1", "e1", "slot"]);
    expect(editor().state.doc.child(1).attrs).toEqual(before);
    expect(onChange).toHaveBeenCalled();

    fireEvent.keyDown(view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(topLevel(editor())).toEqual(["slot", "e1", "slot", "s1"]);
  });
});

describe("Formatting toolbar", () => {
  async function ready(page: ReportNode) {
    const s = setup(page);
    await waitFor(() => expect(s.editor()?.mounted).toBe(true));
    fireEvent.focusIn(s.editor().view.dom);
    return s;
  }

  it("is there before the owner touches the page, its tools off while the selection is a block", async () => {
    const { editor } = setup(doc(ev("e1"), slot("Intro")));
    await waitFor(() => expect(editor()?.mounted).toBe(true));
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(bar).not.toHaveAttribute("inert");
    expect(bar).not.toHaveClass("invisible");
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 2)));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toBeEnabled());
  });

  it("keeps structural headings out of lists and code blocks", async () => {
    const { editor } = await ready(doc({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Penetration" }] }, slot("x")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    for (const name of ["Bulleted list", "Numbered list", "Code block"])
      await waitFor(() => expect(screen.getByRole("button", { name })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Bold" })).toBeEnabled();
  });

  it("Code block turns a slot into a code block and back into a slot, never a paragraph", async () => {
    const { editor } = await ready(doc(slot("id; whoami")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    const code = screen.getByRole("button", { name: "Code block" });
    fireEvent.click(code);
    expect(editor().getDocJSON().content?.[0]).toMatchObject({ type: "codeBlock", content: [{ text: "id; whoami" }] });
    await waitFor(() => expect(code).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(code);
    expect(editor().getDocJSON().content?.[0]).toMatchObject({ type: "slot", content: [{ text: "id; whoami" }] });
  });

  it("Bold toggles the bold mark on a text selection in a slot, and shows as pressed", async () => {
    const { editor } = await ready(doc(slot("Port 22 is open")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)));
    });
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    expect(editor().getDocJSON().content?.[0].content?.[0]).toMatchObject({ text: "Port", marks: [{ type: "bold" }] });
    await waitFor(() => expect(bold).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(bold);
    expect(editor().getDocJSON().content?.[0].content?.[0]).not.toHaveProperty("marks");
  });

  it("Numbered list wraps the slot in an ordered list", async () => {
    const { editor } = await ready(doc(slot("First step")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    fireEvent.click(screen.getByRole("button", { name: "Numbered list" }));
    const top = editor().getDocJSON().content?.[0];
    expect(top).toMatchObject({ type: "list", attrs: { kind: "ordered" }, content: [{ type: "slot" }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Numbered list" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("disables formatting while a block is selected", async () => {
    const { editor } = await ready(doc(slot("Intro"), ev("e1")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize)));
    });
    for (const name of ["Bold", "Italic", "Inline code", "Link", "Bulleted list", "Numbered list", "Code block"])
      await waitFor(() => expect(screen.getByRole("button", { name })).toBeDisabled());
  });

  it("⌘⇧K opens the link input, and Enter links the selection", async () => {
    const { editor } = await ready(doc(slot("the login page")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 15)));
    });
    expect(screen.queryByLabelText("Link address")).toBeNull();
    fireEvent.keyDown(editor().view.dom, { key: "K", code: "KeyK", keyCode: 75, ctrlKey: true, shiftKey: true });
    const input = await screen.findByLabelText("Link address");
    fireEvent.change(input, { target: { value: "http://10.0.0.5/login" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor().getDocJSON().content?.[0].content).toEqual([
      { type: "text", text: "the " },
      { type: "text", text: "login page", marks: [{ type: "link", attrs: expect.objectContaining({ href: "http://10.0.0.5/login" }) }] },
    ]);
    expect(screen.queryByLabelText("Link address")).toBeNull();
  });
});

describe("Generated tables", () => {
  it("keeps the IP address on one line, as wide as its content; Ports Open takes the slack", async () => {
    const svc = { id: "s1", hostId: "h1", port: 3000, protocol: "tcp" };
    const { container } = setup(doc({ type: "generated", attrs: { kind: "port-scan", hostId: "h1", appendix: "inline" } }), [entry({})], [svc]);
    await waitFor(() => expect(container.querySelector("td.report-fit")).toBeTruthy());
    expect(container.querySelector("th.report-fit")).toHaveTextContent("IP Address");
    expect(container.querySelectorAll("td.report-fit")).toHaveLength(1);
  });
});
