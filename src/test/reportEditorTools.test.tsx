import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "prosekit/core";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportNode } from "../engines/report";
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
    credentials: [], credAttempts: [],
  }) as unknown as ReportData;

/** A plain page's blocks: a paragraph, a code block and a screenshot figure (by log entry). */
const para = (text?: string): ReportNode => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });
const code = (text: string): ReportNode => ({ type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text }] });
const figure = (entryId: string): ReportNode => ({ type: "figure", attrs: { attachmentId: "a1", entryId } });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });

function setup(page: ReportNode, log: LogEntry[] = [entry({})], services: unknown[] = [], subNumbers?: (doc: ReportNode) => Map<number, string>) {
  const onChange = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data: { ...data(log), services } as ReportData, onRemoveEvidence: vi.fn() }}>
        <ReportEditor doc={page} subNumbers={subNumbers} onChange={onChange} onReady={(e) => (ref.editor = e)} />
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
  editor.state.doc.forEach((n) => out.push(n.type.name === "figure" ? (n.attrs.entryId as string) : n.type.name));
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
    const { container, editor } = setup(doc(para("Intro"), code("nmap -p-"), para()));
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
    const { editor, onChange } = setup(doc(para("Intro"), figure("e1"), para("After"), figure("s1")), log);
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
    expect(topLevel(editor())).toEqual(["paragraph", "s1", "e1", "paragraph"]);
    expect(editor().state.doc.child(1).attrs).toEqual(before);
    expect(onChange).toHaveBeenCalled();

    fireEvent.keyDown(view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(topLevel(editor())).toEqual(["paragraph", "e1", "paragraph", "s1"]);
  });
});

describe("Formatting toolbar", () => {
  async function ready(page: ReportNode, subNumbers?: (doc: ReportNode) => Map<number, string>) {
    const s = setup(page, undefined, undefined, subNumbers);
    await waitFor(() => expect(s.editor()?.mounted).toBe(true));
    fireEvent.focusIn(s.editor().view.dom);
    return s;
  }

  it("is there before the owner touches the page, its tools off while the selection is a block", async () => {
    const { editor } = setup(doc(code("nmap -p-"), para("Intro")));
    await waitFor(() => expect(editor()?.mounted).toBe(true));
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(bar).not.toHaveAttribute("inert");
    expect(bar).not.toHaveClass("invisible");
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 2)));
    });
    await waitFor(() => expect(within(bar).getByRole("button", { name: "Bold" })).toBeEnabled());
  });

  it("keeps the page's numbered headings out of lists, headings and block types", async () => {
    const numbered = () => new Map([[0, "3.3"]]);
    const { editor } = await ready(doc({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Penetration" }] }, para("x")), numbered);
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    for (const name of ["Bulleted list", "Numbered list", "Task list", "Heading 1", "Heading 2", "Heading 3"])
      await waitFor(() => expect(bar.getByRole("button", { name })).toBeDisabled());
    expect(bar.getByRole("combobox", { name: "Block type" })).toBeDisabled();
    expect(bar.getByRole("button", { name: "Bold" })).toBeEnabled();
  });

  it("Block type turns a paragraph into a code block, and Paragraph back into prose", async () => {
    const user = userEvent.setup();
    const { editor } = await ready(doc(para("id; whoami")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    await waitFor(() => expect(bar.getByRole("combobox", { name: "Block type" })).toHaveTextContent("Paragraph"));
    await user.click(bar.getByRole("combobox", { name: "Block type" }));
    await user.click(await screen.findByRole("option", { name: "Code block" }));
    expect(editor().getDocJSON().content?.[0]).toMatchObject({ type: "codeBlock", content: [{ text: "id; whoami" }] });
    await waitFor(() => expect(bar.getByRole("combobox", { name: "Block type" })).toHaveTextContent("Code block"));
    await user.click(bar.getByRole("combobox", { name: "Block type" }));
    await user.click(await screen.findByRole("option", { name: "Heading 2" }));
    expect(editor().getDocJSON().content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 }, content: [{ text: "id; whoami" }] });
    await user.click(bar.getByRole("combobox", { name: "Block type" }));
    await user.click(await screen.findByRole("option", { name: "Paragraph" }));
    expect(editor().getDocJSON().content?.[0]).toMatchObject({ type: "paragraph", content: [{ text: "id; whoami" }] });
  });

  it("Bold toggles the bold mark on a text selection, and shows as pressed", async () => {
    const { editor } = await ready(doc(para("Port 22 is open")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)));
    });
    const bold = within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bold);
    expect(editor().getDocJSON().content?.[0].content?.[0]).toMatchObject({ text: "Port", marks: [{ type: "bold" }] });
    await waitFor(() => expect(bold).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(bold);
    expect(editor().getDocJSON().content?.[0].content?.[0]).not.toHaveProperty("marks");
  });

  it("Numbered list wraps the paragraph in an ordered list", async () => {
    const { editor } = await ready(doc(para("First step")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    fireEvent.click(bar.getByRole("button", { name: "Numbered list" }));
    const top = editor().getDocJSON().content?.[0];
    expect(top).toMatchObject({ type: "list", attrs: { kind: "ordered" }, content: [{ type: "paragraph" }] });
    await waitFor(() => expect(bar.getByRole("button", { name: "Numbered list" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("disables formatting while a block is selected", async () => {
    const { editor } = await ready(doc(para("Intro"), code("nmap -p-")));
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize)));
    });
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    const marks = ["Bold", "Italic", "Underline", "Strikethrough", "Inline code", "Highlight", "Subscript", "Superscript", "Link"];
    for (const name of [...marks, "Bulleted list", "Numbered list", "Task list"])
      await waitFor(() => expect(bar.getByRole("button", { name })).toBeDisabled());
    expect(bar.getByRole("combobox", { name: "Block type" })).toBeDisabled();
  });

  it("⌘⇧K opens the link field, and Enter links the selection", async () => {
    const { editor } = await ready(doc(para("the login page")));
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
