import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "prosekit/core";
import { TextSelection } from "prosekit/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportNode, ReportTarget } from "../engines/report";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { openFindBar, ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { blockScore, fuzzyScore } from "../features/report/editor/SlashMenu/SlashMenu";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Report } from "../types/report";
import type { LogEntry, LogEntryInput } from "../types/log";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const host = (id: string, name: string) => ({ id, name, ip: "10.0.0.5", os: "windows", access: "root", adSetEffective: false }) as Host;
const entry = (o: Record<string, unknown>) =>
  ({
    id: "e1",
    kind: "command",
    title: "Full port scan",
    ranOn: "Kali (VM)",
    private: false,
    hostIds: ["h1"],
    observations: null,
    returnedNothing: false,
    at: 1000,
    createdAt: 1000,
    content: { kind: "command", blocks: [{ command: "nmap -p- 10.0.0.5", output: "PORT   STATE SERVICE\n22/tcp open  ssh\n80/tcp open  http" }] },
    ...o,
  }) as unknown as LogEntry;
const shot = (id: string, caption: string) =>
  entry({ id, kind: "screenshot", title: caption, content: { kind: "screenshot", attachmentId: "a1", caption, fileName: "x.png" } });
const data = (log: LogEntry[], hosts: Host[] = [host("h1", "ms01")], attempts: unknown[] = []) =>
  ({
    engagement: { id: "eng", kind: "exam-sim" },
    hosts,
    services: [],
    log,
    checklist: [],
    findings: [],
    findingFiles: [],
    attempts,
    ruledOut: [],
    grants: [],
    usernames: [],
    hops: [],
    cleanup: [],
    notes: [],
    credentials: [], credAttempts: [],
  }) as unknown as ReportData;

const para = (text?: string): ReportNode => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });
const code = (text: string): ReportNode => ({ type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text }] });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const standalone: ReportTarget = { key: "h1", kind: "standalone", hostIds: ["h1"] };

type Opts = { target?: ReportTarget; hosts?: Host[]; attempts?: unknown[]; subNumbers?: (doc: ReportNode) => Map<number, string> };
function setup(page: ReportNode, log: LogEntry[] = [entry({})], opts: Opts = {}) {
  const onChange = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const qc = makeQueryClient();
  qc.setQueryData(["log", "eng"], log);
  const utils = render(
    <QueryClientProvider client={qc}>
      <ReportDataContext.Provider
        value={{ data: data(log, opts.hosts, opts.attempts), onRemoveEvidence: vi.fn(), target: opts.target ?? standalone }}
      >
        <ReportEditor doc={page} subNumbers={opts.subNumbers} onChange={onChange} onReady={(e) => (ref.editor = e)} />
      </ReportDataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, onChange, qc, editor: () => ref.editor! };
}

async function ready(page: ReportNode, log?: LogEntry[], opts?: Opts) {
  const s = setup(page, log, opts);
  await waitFor(() => expect(s.editor()?.mounted).toBe(true));
  fireEvent.focusIn(s.editor().view.dom);
  return s;
}

const json = (editor: Editor) => editor.getDocJSON() as ReportNode;
const cursorAt = (editor: Editor, pos: number, to = pos) =>
  act(() => {
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, to)));
  });

/** Types text as the keyboard does: each character through ProseMirror's text input (where input rules run). */
function type(editor: Editor, text: string) {
  const view = editor.view;
  for (const ch of text) {
    act(() => {
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    });
  }
}

// jsdom has no layout for ranges: commands that scroll the selection into view measure one.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ machines: ["Kali (VM)"] } as Settings);
  m.attachmentGet.mockResolvedValue({ id: "a1", mime: "image/png", dataBase64: "AAAA" });
});
afterEach(() => vi.restoreAllMocks());

describe("Markdown shortcuts", () => {
  const cases: [string, string, Partial<ReportNode>][] = [
    ["# ", "Heading 1", { type: "heading", attrs: { level: 1 } }],
    ["## ", "Heading 2", { type: "heading", attrs: { level: 2 } }],
    ["### ", "Heading 3", { type: "heading", attrs: { level: 3 } }],
    ["- ", "bullet", { type: "list", attrs: expect.objectContaining({ kind: "bullet" }) }],
    ["1. ", "numbered", { type: "list", attrs: expect.objectContaining({ kind: "ordered" }) }],
    ["[ ] ", "task", { type: "list", attrs: expect.objectContaining({ kind: "task" }) }],
    ["> ", "quote", { type: "blockquote" }],
    ["``` ", "code block", { type: "codeBlock" }],
  ];
  for (const [typed, name, expected] of cases)
    it(`"${typed.trim()}" at a line's start makes a ${name}`, async () => {
      const { editor } = await ready(doc(para()));
      cursorAt(editor(), 1);
      type(editor(), typed);
      expect(json(editor()).content?.[0]).toMatchObject(expected);
    });

  it('"# " in a list item\'s second paragraph makes the heading there, not at the top of the page', async () => {
    const item: ReportNode = { type: "list", attrs: { kind: "ordered" }, content: [para("Read the notes"), para()] };
    const { editor } = await ready(doc(para("Intro"), item));
    // Intro is 7 wide (0..7); the list opens at 7, its first paragraph at 8 ("Read the notes", 14 chars),
    // so the empty second paragraph's inside is at 8 + 16 + 1.
    cursorAt(editor(), 25);
    type(editor(), "# Owner");
    const top = json(editor()).content!;
    expect(top[0]).toMatchObject({ type: "paragraph", content: [{ text: "Intro" }] });
    expect(top[1].content?.[1]).toMatchObject({ type: "heading", content: [{ text: "Owner" }] });
  });

  it("stops at heading 3: #### stays text", async () => {
    const { editor } = await ready(doc(para()));
    cursorAt(editor(), 1);
    type(editor(), "#### ");
    expect(json(editor()).content?.[0]).toMatchObject({ type: "paragraph", content: [{ text: "#### " }] });
  });

  it("--- makes a divider", async () => {
    const { editor } = await ready(doc(para()));
    cursorAt(editor(), 1);
    type(editor(), "---");
    expect(json(editor()).content?.map((n) => n.type)).toContain("horizontalRule");
  });

  it("**x**, *x*, `x` and ==x== mark the text", async () => {
    const { editor } = await ready(doc(para()));
    cursorAt(editor(), 1);
    type(editor(), "a **bold** b *it* c `id` d ==key== ");
    const marked = (json(editor()).content?.[0].content ?? []).filter((t) => t.marks).map((t) => [t.text, t.marks![0].type]);
    expect(marked).toEqual([
      ["bold", "bold"],
      ["it", "italic"],
      ["id", "code"],
      ["key", "highlight"],
    ]);
  });
});

// jsdom lays nothing out, so ProseKit's positioners count their anchor as scrolled away and keep open popovers
// display:none: queries reach into them with `hidden: true`.
describe("Bubble menu", () => {
  it("offers the text marks and a link on a text selection", async () => {
    const { editor } = await ready(doc(para("Port 22 is open")));
    act(() => editor().view.focus());
    cursorAt(editor(), 1, 5);
    const bubble = await screen.findByLabelText("Text formatting");
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Inline code", "Highlight", "Link"])
      expect(within(bubble).getByRole("button", { name, hidden: true })).toBeInTheDocument();
    fireEvent.click(within(bubble).getByRole("button", { name: "Underline", hidden: true }));
    fireEvent.click(within(bubble).getByRole("button", { name: "Highlight", hidden: true }));
    expect(json(editor()).content?.[0].content?.[0]).toMatchObject({ text: "Port", marks: expect.arrayContaining([{ type: "underline" }, { type: "highlight" }]) });
  });

  it("edits, copies and removes the link the cursor is in", async () => {
    const { editor } = await ready(doc({ type: "paragraph", content: [{ type: "text", text: "login", marks: [{ type: "link", attrs: { href: "http://10.0.0.5/login" } }] }] }));
    act(() => editor().view.focus());
    cursorAt(editor(), 3);
    const popover = await screen.findByLabelText("Link here");
    expect(within(popover).getByText("http://10.0.0.5/login")).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole("button", { name: "Edit link", hidden: true }));
    const field = await screen.findByLabelText("Link address");
    fireEvent.change(field, { target: { value: "http://10.0.0.5/admin" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(json(editor()).content?.[0].content?.[0].marks?.[0]).toMatchObject({ type: "link", attrs: { href: "http://10.0.0.5/admin" } });
    cursorAt(editor(), 3);
    fireEvent.click(within(await screen.findByLabelText("Link here")).getByRole("button", { name: "Remove link", hidden: true }));
    expect(json(editor()).content?.[0].content?.[0]).not.toHaveProperty("marks");
  });
});

describe("Slash menu", () => {
  async function slash(page: ReportNode = doc(para()), log?: LogEntry[]) {
    const s = await ready(page, log);
    act(() => s.editor().view.focus());
    cursorAt(s.editor(), 1);
    type(s.editor(), "/");
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Insert", hidden: true }).closest("[data-state]")).toHaveAttribute("data-state", "open"));
    return s;
  }
  // jsdom lays nothing out, so the positioner counts the cursor as scrolled away and keeps the open menu display:none.
  const pick = async (name: string | RegExp) => fireEvent.click(await screen.findByRole("option", { name, hidden: true }));

  for (const [name, expected] of [
    ["Heading 1", { type: "heading", attrs: { level: 1 } }],
    ["Heading 2", { type: "heading", attrs: { level: 2 } }],
    ["Heading 3", { type: "heading", attrs: { level: 3 } }],
    ["Quote", { type: "blockquote" }],
    ["Code block", { type: "codeBlock" }],
    ["Bulleted list", { type: "list", attrs: expect.objectContaining({ kind: "bullet" }) }],
    ["Numbered list", { type: "list", attrs: expect.objectContaining({ kind: "ordered" }) }],
    ["Task list", { type: "list", attrs: expect.objectContaining({ kind: "task" }) }],
    ["Table", { type: "table" }],
    ["Divider", { type: "horizontalRule" }],
  ] as const)
    it(`inserts ${name}, and the / goes`, async () => {
      const { editor } = await slash();
      await pick(new RegExp(`^${name}`));
      const top = json(editor()).content ?? [];
      expect(top.find((n) => n.type === expected.type)).toMatchObject(expected);
      expect(JSON.stringify(top)).not.toContain('"/"');
    });

  it("a table has a header row and two rows to fill", async () => {
    const { editor } = await slash();
    await pick(/^Table/);
    const table = json(editor()).content?.find((n) => n.type === "table");
    expect(table?.content?.map((r) => r.content?.map((c) => c.type))).toEqual([
      ["tableHeaderCell", "tableHeaderCell", "tableHeaderCell"],
      ["tableCell", "tableCell", "tableCell"],
      ["tableCell", "tableCell", "tableCell"],
    ]);
  });

  it("searches this target's log, fuzzily, and inserts the entry's blocks in place of the empty line", async () => {
    const log = [entry({}), shot("s1", "Admin panel"), entry({ id: "other", title: "Other host", hostIds: ["h9"] })];
    const { editor } = await ready(doc(para("Scanned it"), para()), log);
    act(() => editor().view.focus());
    cursorAt(editor(), editor().state.doc.child(0).nodeSize + 1);
    type(editor(), "/nmp");
    const list = await screen.findByRole("listbox", { name: "Insert", hidden: true });
    await waitFor(() => expect(within(list).getByRole("option", { name: /Full port scan/, hidden: true })).toBeInTheDocument());
    expect(within(list).queryByRole("option", { name: /Other host/, hidden: true })).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: /Full port scan/, hidden: true }));
    // Plain blocks with their sources, where the empty line was.
    expect(json(editor()).content?.map((n) => n.attrs?.source ?? n.content?.[0]?.text)).toEqual(["Scanned it", "entry:e1:title", "entry:e1:0:command", "entry:e1:0:output"]);
  });

  it("offers what the evidence rail offers: an entry behind an operator-reason attempt stays out", async () => {
    const log = [entry({}), entry({ id: "op", title: "Typo in the payload" })];
    const attempts = [{ id: "a1", logEntryId: "op", private: false, reasonKind: "operator" }];
    const { editor } = await ready(doc(para()), log, { attempts });
    act(() => editor().view.focus());
    cursorAt(editor(), 1);
    type(editor(), "/");
    const list = await screen.findByRole("listbox", { name: "Insert", hidden: true });
    await waitFor(() => expect(within(list).getByRole("option", { name: /Full port scan/, hidden: true })).toBeInTheDocument());
    expect(within(list).queryByRole("option", { name: /Typo in the payload/, hidden: true })).toBeNull();
  });

  it("the toolbar's Insert evidence opens it on log entries alone", async () => {
    const { editor } = await ready(doc(para("Next we scanned")), [entry({}), shot("s1", "Admin panel")]);
    act(() => editor().view.focus());
    cursorAt(editor(), 1 + "Next we scanned".length);
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name: "Insert evidence" }));
    const list = await screen.findByRole("listbox", { name: "Insert", hidden: true });
    await waitFor(() => expect(within(list).getByRole("option", { name: /Admin panel/, hidden: true })).toBeInTheDocument());
    expect(within(list).queryByRole("option", { name: /Heading 3/, hidden: true })).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: /Admin panel/, hidden: true }));
    expect(json(editor()).content?.map((n) => n.attrs?.source ?? n.content?.[0]?.text)).toEqual(["Next we scanned", "entry:s1:title", "entry:s1"]);
    expect(json(editor()).content?.[2]).toMatchObject({ type: "figure", attrs: { entryId: "s1", attachmentId: "a1" } });
  });

  it("never opens mid-sentence: a path typed in a sentence and ↵ stay as text", async () => {
    const { editor } = await ready(doc(para()));
    act(() => editor().view.focus());
    cursorAt(editor(), 1);
    type(editor(), "Read /etc/passwd");
    expect(document.querySelector("prosekit-autocomplete-popup")).not.toHaveAttribute("data-state", "open");
    act(() => void fireEvent.keyDown(editor().view.dom, { key: "Enter", code: "Enter", keyCode: 13 }));
    expect(json(editor()).content?.[0].content?.[0].text).toBe("Read /etc/passwd");
  });

  it("closes on a path or file name typed at a line's start", async () => {
    const { editor } = await slash();
    type(editor(), "admin.php");
    await waitFor(() => expect(document.querySelector("prosekit-autocomplete-popup")).not.toHaveAttribute("data-state", "open"));
    expect(json(editor()).content?.[0].content?.[0].text).toBe("/admin.php");
  });

  it("↵ keeps the typed text when only a log entry matches loosely", async () => {
    const { editor } = await slash(doc(para()), [entry({})]);
    type(editor(), "nmap");
    const keep = await screen.findByRole("option", { name: /Keep “\/nmap” as text/, hidden: true });
    expect(keep).toHaveAttribute("data-highlighted");
    fireEvent.click(keep);
    expect(json(editor()).content?.map((n) => n.type)).toEqual(["paragraph"]);
    expect(json(editor()).content?.[0].content?.[0].text).toBe("/nmap");
  });

  it("a log entry named by the start of its title is the one ↵ takes", async () => {
    const { editor } = await slash(doc(para()), [entry({})]);
    type(editor(), "full");
    const option = await screen.findByRole("option", { name: /Full port scan/, hidden: true });
    await waitFor(() => expect(option).toHaveAttribute("data-highlighted"));
    expect(screen.queryByRole("option", { name: /Keep/, hidden: true })).toBeNull();
    expect(editor()).toBeTruthy();
  });

  it("the evidence picker closed with Esc takes its / (and the line it added) away again", async () => {
    const { editor } = await ready(doc(para("Next we scanned")), [entry({})]);
    act(() => editor().view.focus());
    cursorAt(editor(), 1 + "Next we scanned".length);
    const before = json(editor());
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name: "Insert evidence" }));
    await waitFor(() => expect(document.querySelector("prosekit-autocomplete-popup")).toHaveAttribute("data-state", "open"));
    expect(json(editor()).content).toHaveLength(2);
    act(() => void fireEvent.keyDown(editor().view.dom, { key: "Escape", code: "Escape", keyCode: 27 }));
    await waitFor(() => expect(json(editor())).toEqual(before));
  });

  it("/etc then ↵ stays text: block items match a label word or alias by its start, never a loose subsequence", async () => {
    const { editor } = await slash();
    type(editor(), "etc");
    await waitFor(() => expect(screen.queryByRole("option", { name: /^Heading 1/, hidden: true })).toBeNull());
    act(() => void fireEvent.keyDown(editor().view.dom, { key: "Enter", code: "Enter", keyCode: 13 }));
    const top = json(editor()).content ?? [];
    expect(top.some((n) => n.type === "heading")).toBe(false);
    expect(JSON.stringify(top)).toContain("/etc");
    expect(blockScore("etc", { id: "h1", label: "Heading 1", keywords: "title section" })).toBeNull();
    expect(blockScore("h1", { id: "h1", label: "Heading 1", keywords: "title section" })).not.toBeNull();
    expect(blockScore("head", { id: "h1", label: "Heading 1", keywords: "title section" })).toBe(3);
    expect(blockScore("sec", { id: "h1", label: "Heading 1", keywords: "title section" })).toBe(1);
  });

  it("matches words out of order of their letters, never unrelated text", () => {
    expect(fuzzyScore("nmp", "Full port scan nmap -p-")).not.toBeNull();
    expect(fuzzyScore("zzz", "Full port scan")).toBeNull();
    expect(fuzzyScore("scan", "Full port scan")! > fuzzyScore("fps", "Full port scan")!).toBe(true);
  });
});

describe("Headings", () => {
  it("Heading 1, 2 and 3 are one click each on the toolbar, pressed while on, and a second click goes back to a paragraph", async () => {
    const { editor } = await ready(doc(para("Foothold notes")));
    cursorAt(editor(), 2);
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    for (const level of [1, 2, 3]) {
      const button = bar.getByRole("button", { name: `Heading ${level}` });
      fireEvent.click(button);
      expect(json(editor()).content?.[0]).toMatchObject({ type: "heading", attrs: { level }, content: [{ text: "Foothold notes" }] });
      await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    }
    fireEvent.click(bar.getByRole("button", { name: "Heading 3" }));
    expect(json(editor()).content?.[0]).toMatchObject({ type: "paragraph", content: [{ text: "Foothold notes" }] });
  });

  it("⌥⌘1, ⌥⌘2 and ⌥⌘3 set them from the keyboard", async () => {
    const { editor } = await ready(doc(para("Privesc")));
    cursorAt(editor(), 2);
    for (const level of [1, 2, 3]) {
      act(() => void fireEvent.keyDown(editor().view.dom, { key: String(level), code: `Digit${level}`, ctrlKey: true, altKey: true }));
      expect(json(editor()).content?.[0]).toMatchObject({ type: "heading", attrs: { level } });
    }
  });

  it("leave the page's numbered headings as they are: keys, markdown and the slash menu don't retype them", async () => {
    const heading = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Introduction" }] };
    const { editor } = await ready(doc(heading, para("x")), undefined, { subNumbers: () => new Map([[0, "1.1"]]) });
    cursorAt(editor(), 1);
    for (const level of [0, 1, 3]) act(() => void fireEvent.keyDown(editor().view.dom, { key: String(level), code: `Digit${level}`, ctrlKey: true, altKey: true }));
    type(editor(), "# ");
    expect(json(editor()).content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 }, content: [{ text: "# Introduction" }] });
  });

  for (const md of ["- ", "* ", "1. ", "> ", "[ ] "])
    it(`keep "${md}" typed at a numbered heading's start as text, never a list or quote`, async () => {
      const heading = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Introduction" }] };
      const { editor } = await ready(doc(heading, para("x")), undefined, { subNumbers: () => new Map([[0, "1.1"]]) });
      cursorAt(editor(), 1);
      type(editor(), md);
      expect(json(editor()).content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 }, content: [{ text: `${md}Introduction` }] });
    });

  it("still turns list markdown into a list in the owner's own text", async () => {
    const { editor } = await ready(doc(para()), undefined, { subNumbers: () => new Map([[0, "1.1"]]) });
    cursorAt(editor(), 1);
    type(editor(), "- ");
    expect(json(editor()).content?.[0].type).toBe("list");
  });

  it("are in the bubble menu too", async () => {
    const { editor } = await ready(doc(para("Privesc")));
    act(() => editor().view.focus());
    cursorAt(editor(), 1, 4);
    const bubble = await screen.findByLabelText("Text formatting");
    fireEvent.click(within(bubble).getByRole("button", { name: "Heading 2", hidden: true }));
    expect(json(editor()).content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
  });
});

describe("Toolbar inserts", () => {
  it("Insert table, then the header row turns off and back on from its row menu's command", async () => {
    const { editor } = await ready(doc(para("x")));
    cursorAt(editor(), 2);
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    fireEvent.click(bar.getByRole("button", { name: "Insert table" }));
    const table = () => json(editor()).content?.find((n) => n.type === "table");
    expect(table()?.content?.[0].content?.[0].type).toBe("tableHeaderCell");
    const { toggleHeaderRow } = await import("../features/report/editor/commands");
    act(() => void editor().exec(toggleHeaderRow));
    expect(table()?.content?.[0].content?.map((c) => c.type)).toEqual(["tableCell", "tableCell", "tableCell"]);
    act(() => void (editor() as unknown as { commands: { addTableRowBelow(): void } }).commands.addTableRowBelow());
    expect(table()?.content).toHaveLength(4);
  });

  it("puts the cursor in a new table's first cell; Tab walks the cells and adds a row at the end", async () => {
    const { editor } = await ready(doc(para("x")));
    cursorAt(editor(), 2);
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Formatting" })).getByRole("button", { name: "Insert table" }));
    type(editor(), "User");
    const tab = (shift = false) => act(() => void fireEvent.keyDown(editor().view.dom, { key: "Tab", code: "Tab", keyCode: 9, shiftKey: shift }));
    tab();
    type(editor(), "Hash");
    tab(true);
    type(editor(), "name");
    const table = () => json(editor()).content?.find((n) => n.type === "table");
    expect(table()?.content?.[0].content?.map((c) => c.content?.[0].content?.[0]?.text)).toEqual(["Username", "Hash", undefined]);
    for (let i = 0; i < 9; i++) tab();
    expect(table()?.content).toHaveLength(4);
  });

  it("sets a code block's language, kept on the page, and colours it with highlight.js", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await ready(doc({ type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text: "import os\nprint(os.getuid())" }] }));
    cursorAt(editor(), 2);
    const bar = within(screen.getByRole("toolbar", { name: "Formatting" }));
    await user.click(await bar.findByRole("combobox", { name: "Code language" }));
    await user.click(await screen.findByRole("option", { name: "Python" }));
    expect(json(editor()).content?.[0].attrs).toMatchObject({ language: "python" });
    expect((onChange.mock.lastCall![0] as ReportNode).content?.[0].attrs).toMatchObject({ language: "python" });
    await waitFor(() => expect(editor().view.dom.querySelector(".hljs-keyword")).toHaveTextContent("import"));
  });
});

describe("Images", () => {
  beforeEach(() => {
    m.logCreate.mockImplementation(async (_e, input: LogEntryInput) =>
      entry({ ...input, id: "new-shot", kind: "screenshot", content: { ...input.content, attachmentId: "att-9" } }),
    );
  });
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
  function paste(editor: Editor, file: File) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [file], items: [], types: ["Files"], getData: () => "" } });
    act(() => void editor.view.dom.dispatchEvent(event));
  }

  it("a pasted image becomes a screenshot entry of this target, on the page as a figure with a caption to write", async () => {
    const { editor, qc } = await ready(doc(para("Uploaded the shell"), para()));
    cursorAt(editor(), editor().state.doc.child(0).nodeSize + 1);
    paste(editor(), png());
    await waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0][0]).toBe("eng");
    expect(m.logCreate.mock.calls[0][1]).toMatchObject({
      hostIds: ["h1"],
      private: false,
      content: { kind: "screenshot", caption: "", fileName: "shot.png" },
      attachment: { mime: "image/png", dataBase64: expect.any(String) },
    });
    // In place of the empty line.
    await waitFor(() => expect(json(editor()).content?.map((n) => n.type)).toEqual(["paragraph", "figure"]));
    const figure = json(editor()).content![1];
    expect(figure.attrs).toMatchObject({ entryId: "new-shot", attachmentId: "att-9", source: "entry:new-shot" });
    expect(figure.content ?? []).toEqual([]);
    expect(qc.getQueryData<LogEntry[]>(["log", "eng"])?.some((e) => e.id === "new-shot")).toBe(true);
  });

  it("lands where it was pasted, though the owner typed above it while it saved", async () => {
    let save: (e: LogEntry) => void = () => {};
    m.logCreate.mockImplementation(() => new Promise((r) => (save = r)));
    const { editor } = await ready(doc(para("First"), para("Uploaded the shell"), para("Last")));
    const d = editor().state.doc;
    cursorAt(editor(), d.child(0).nodeSize + 2);
    paste(editor(), png());
    await waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    // A new paragraph at the top moves everything down while the image saves.
    act(() => editor().view.dispatch(editor().view.state.tr.insert(0, editor().state.schema.nodes.paragraph.create(null, editor().state.schema.text("Added")))));
    cursorAt(editor(), editor().state.doc.content.size - 2);
    await act(async () => save(entry({ id: "new-shot", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a9", caption: "", fileName: "shot.png" } })));
    await waitFor(() => expect(json(editor()).content?.map((n) => n.attrs?.entryId ?? n.content?.[0]?.text)).toEqual(["Added", "First", "Uploaded the shell", "new-shot", "Last"]));
  });

  it("on an AD set's page, goes to the machine whose section the cursor is in", async () => {
    const target: ReportTarget = { key: "ad", kind: "ad-set", hostIds: ["h1", "h2"] };
    const page = doc(
      { type: "heading", attrs: { level: 1, source: "facts:h1" }, content: [{ type: "text", text: "ms01" }] },
      para("one"),
      { type: "heading", attrs: { level: 2, source: "phase:h2:foothold" }, content: [{ type: "text", text: "Initial access" }] },
      para("two"),
    );
    const { editor } = await ready(page, [entry({})], { target, hosts: [host("h1", "ms01"), host("h2", "dc01")] });
    const d = editor().state.doc;
    cursorAt(editor(), d.child(0).nodeSize + d.child(1).nodeSize + d.child(2).nodeSize + 2);
    paste(editor(), png());
    await waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0][1].hostIds).toEqual(["h2"]);
  });

  it("says so when the image can't be saved", async () => {
    m.logCreate.mockRejectedValue({ code: "validation", message: "attachment is larger than 25 MiB" });
    const { editor } = await ready(doc(para()));
    cursorAt(editor(), 1);
    paste(editor(), png());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the image as a screenshot: attachment is larger than 25 MiB");
  });
});

describe("Find and replace", () => {
  it("opens with ⌘F's opener, counts matches, steps through them and replaces them all", async () => {
    const { editor } = await ready(doc(para("port 22 and port 80"), para("one more port")));
    act(() => void openFindBar(editor()));
    const find = await screen.findByLabelText("Find");
    expect(find).toHaveFocus();
    fireEvent.change(find, { target: { value: "port" } });
    await waitFor(() => expect(screen.getByText("1 of 3")).toBeInTheDocument());
    fireEvent.keyDown(find, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("2 of 3")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "PORT" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(json(editor()).content?.map((p) => p.content?.[0].text)).toEqual(["PORT 22 and PORT 80", "one more PORT"]);
    fireEvent.keyDown(find, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Find")).toBeNull());
  });
});

describe("Find in code blocks", () => {
  it("counts and steps through matches in code blocks too, and Replace all changes them with the rest of the text", async () => {
    const { editor } = await ready(doc(para("the port list"), code("PORT   STATE SERVICE\n22/tcp open  ssh")));
    act(() => void openFindBar(editor()));
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "port" } });
    // "port" in the paragraph, "PORT" in the code block (case folded).
    await waitFor(() => expect(screen.getByText("1 of 2")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("2 of 2")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "SERVICE" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(json(editor()).content?.[0].content?.[0].text).toBe("the SERVICE list");
    expect(json(editor()).content?.[1].content?.[0].text).toBe("SERVICE   STATE SERVICE\n22/tcp open  ssh");
  });
});

describe("Table cells keep their words whole", () => {
  const cell = (type: string, text: string): ReportNode => ({ type, content: [para(text)] });
  const table = (rows: string[][]): ReportNode => ({
    type: "table",
    content: rows.map((r, i) => ({ type: "tableRow", content: r.map((t) => cell(i === 0 ? "tableHeaderCell" : "tableCell", t)) })),
  });
  const marked = (container: HTMLElement, cls: string) => [...container.querySelectorAll(`td .${cls}, th .${cls}`)].map((e) => e.textContent);

  it("keeps a short marked word on one line, breaks a long path between its parts, and a long bare word anywhere", async () => {
    const hash = "4c1d8e2f9a7b3065e2c4a9f1d7b80e36aa77";
    const { container } = await ready(
      doc(
        table([
          ["#", "Finding", "Item"],
          ["1", "SeImpersonatePrivilege abuse via sudo CVE-2021-3156", `C:\\Windows\\Tasks\\PrintSpoofer64.exe ${hash}`],
        ]),
        para("Outside a table CVE-2021-3156 is ordinary text."),
      ),
    );
    await waitFor(() => expect(marked(container, "report-cell-word")).toEqual(["CVE-2021-3156"]));
    // A plain word needs nothing: the cell breaks only at spaces, so its longest word is the column's floor.
    expect(marked(container, "report-cell-part")).toEqual(["C:\\", "Windows\\", "Tasks\\", "PrintSpoofer64.exe"]);
    expect(marked(container, "report-cell-long")).toEqual([hash]);
    expect(container.querySelectorAll(".ProseMirror > p [class^='report-cell']")).toHaveLength(0);
  });
});

describe("Placeholder", () => {
  it("an empty paragraph with the cursor in it says how to insert", async () => {
    const { editor } = await ready(doc(para("x"), para()));
    cursorAt(editor(), 4);
    await waitFor(() => expect(editor().view.dom.querySelector("[data-placeholder]")).toHaveAttribute("data-placeholder", "Write, or type / to insert"));
  });
});

describe("Report details", () => {
  it("caps each text field at the backend's 2000 characters", async () => {
    const { ReportDetails } = await import("../features/report/ReportDetails/ReportDetails");
    const report = { id: "r1", engagementId: "eng", candidateName: "", email: "", osid: "", title: "OSCP Exam Report", meta: {} } as unknown as Report;
    render(<ReportDetails report={report} engagement={{ id: "eng", kind: "exam-sim" } as Engagement} hosts={[]} includedHostIds={[]} onSave={vi.fn()} />);
    for (const label of ["Your name", "Email", "OSID", "Report title"]) expect(screen.getByLabelText(label)).toHaveAttribute("maxLength", "2000");
  });
});

describe("Formatting bar on a narrow pane", () => {
  it("folds the lowest priority first and keeps the bar's order", async () => {
    const { fitItems } = await import("../features/report/editor/FormatToolbar/FormatToolbar");
    const item = (id: string, group: string, priority: number, width = 28) => ({ id, group, priority, width, node: null });
    const items = [
      item("block", "block", 30, 128),
      item("H1", "headings", 96),
      item("Bold", "marks", 100),
      item("Sub", "marks", 10),
      item("Underline", "marks", 20),
      item("bullet", "lists", 93),
      item("find", "find", 50),
    ];
    expect(fitItems(items, null).more).toEqual([]);
    // Room for H1 | Bold | bullet and More: everything else folds, lowest first.
    const { inline, more } = fitItems(items, 28 + 16 + 28 + 16 + 28 + 16 + 28);
    expect(inline.map((g) => g.items.map((i) => i.id))).toEqual([["H1"], ["Bold"], ["bullet"]]);
    expect(more.map((g) => g.items.map((i) => i.id))).toEqual([["block"], ["Sub", "Underline"], ["find"]]);
  });
});

describe("Block handle menu", () => {
  /** What hovering a block does: the handle's root says which block it is beside. */
  function hover(container: HTMLElement, editor: Editor, type: string) {
    let found: { node: unknown; pos: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name === type) found = { node, pos };
      return true;
    });
    const root = container.querySelector("prosekit-block-handle-root")!;
    const event = Object.assign(new Event("stateChange"), { detail: found });
    act(() => void root.dispatchEvent(event));
  }
  // The handle shows on a real pointer hover, which jsdom has no layout for: its popup stays display:none here.
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Block actions", hidden: true }));

  it("a scroll closes the block menu, so it never stays open without its handle", async () => {
    const { container, editor } = await ready(doc(para("Intro"), code("nmap -p-")));
    hover(container, editor(), "paragraph");
    openMenu();
    expect(await screen.findByRole("menu", { name: "Block actions" })).toBeInTheDocument();
    act(() => void editor().view.dom.dispatchEvent(new Event("scroll")));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Block actions" })).toBeNull());
  });

  it("deletes the hovered block", async () => {
    const { container, editor } = await ready(doc(para("Intro"), code("nmap -p-")));
    hover(container, editor(), "paragraph");
    openMenu();
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(json(editor()).content?.map((n) => n.type)).toEqual(["codeBlock"]));
  });
});
