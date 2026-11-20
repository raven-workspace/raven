import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { TextSelection } from "prosekit/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import {
  buildPlainTarget,
  entryBlocks,
  missingEntries,
  missingTested,
  PAGE_NODE_TYPES,
  phaseInsertAt,
  sourceBlocks,
  sourceOf,
  type ReportData,
  type ReportNode,
  type ReportTarget,
} from "../engines/report";
import { AddEvidenceButton } from "../features/report/AddEvidenceButton/AddEvidenceButton";
import { unusedEntries } from "../features/report/EvidenceRail/EvidenceRail";
import { deleteBlockAt, insertEntry, insertFigure, isEdited, refreshLabel, refreshRun, sourceRun } from "../features/report/editor/pageActions";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { pruneRemoved } from "../features/report/saveQueue";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { LogEntry } from "../types/log";
import type { Settings } from "../types/settings";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const garnet = garnetFixtures(1_700_000_000_000);
const target: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
const draft = buildPlainTarget(garnet, target, {});
const id = (name: string) => `l-garnet-${name}`;
const entry = (data: ReportData, name: string) => data.log.find((e) => e.id === id(name))!;

/** garnet's log with one entry changed. */
const withEntry = (name: string, change: (e: LogEntry) => LogEntry | null): ReportData => ({
  ...garnet,
  log: garnet.log.flatMap((e) => (e.id === id(name) ? [change(e)].filter((x): x is LogEntry => x !== null) : [e])),
});
/** The output of an entry's first command block, changed. */
const newOutput = (name: string, output: string) =>
  withEntry(name, (e) => (e.content.kind === "command" ? { ...e, content: { ...e.content, blocks: [{ ...e.content.blocks[0], output }, ...e.content.blocks.slice(1)] } } : e));

/** Whether a top-level block holds any block of the entry. */
const holds = (n: ReportNode, name: string): boolean => (sourceOf(n) ?? "").startsWith(`entry:${id(name)}`) || (n.content ?? []).some((c) => holds(c, name));
/** The draft without the steps (and anything else) of these entries. */
const without = (...names: string[]): ReportNode => ({ ...draft, content: draft.content!.filter((n) => !names.some((x) => holds(n, x))) });

function page(content: ReportNode, data: ReportData = garnet) {
  const ref: { editor: Editor | null } = { editor: null };
  const onRemoveEvidence = vi.fn();
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <ReportDataContext.Provider value={{ data, onRemoveEvidence, target, reportMeta: {} }}>
          <ReportEditor doc={content} onChange={vi.fn()} onReady={(e) => (ref.editor = e)} />
        </ReportDataContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onRemoveEvidence, editor: () => ref.editor! };
}

async function ready(content: ReportNode, data: ReportData = garnet) {
  const p = page(content, data);
  await waitFor(() => expect(p.editor()?.mounted).toBe(true));
  return p;
}

const json = (editor: Editor) => editor.getDocJSON() as ReportNode;
const types = (n: ReportNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];

/** The first node (document order) `pick` accepts, with its position. */
function find(editor: Editor, pick: (node: PMNode) => boolean): { node: PMNode; pos: number } {
  let found: { node: PMNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (pick(node)) found = { node, pos };
    return !found;
  });
  expect(found).not.toBeNull();
  return found!;
}
const bySource = (source: string) => (n: PMNode) => n.attrs.source === source;

/** The owner clicks into the page and puts the cursor at `pos`. */
function cursorAt(editor: Editor, pos: number) {
  act(() => {
    editor.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  });
}

function typeAt(editor: Editor, pos: number, t: string) {
  act(() => {
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    for (const ch of t) {
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  });
}

/** What hovering a block does: the handle's root says which block it is beside. jsdom has no layout for a real hover. */
function hover(container: HTMLElement, block: { node: PMNode; pos: number }) {
  const root = container.querySelector("prosekit-block-handle-root")!;
  act(() => void root.dispatchEvent(Object.assign(new Event("stateChange"), { detail: block })));
}
async function menuFor(container: HTMLElement, block: { node: PMNode; pos: number }) {
  hover(container, block);
  fireEvent.click(screen.getByRole("button", { name: "Block actions", hidden: true }));
  await screen.findByRole("menu", { name: "Block actions" });
  return screen.getAllByRole("menuitem").map((b) => b.textContent);
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

describe("insertEntry: the rail's + add", () => {
  it("+ add with the cursor in a step puts the entry's blocks after the cursor's block, inside that step", async () => {
    const { editor } = await ready(draft);
    const ftp = entry(garnet, "ftp");
    // Step 2 (Download the repository): the cursor in its sentence.
    const sentence = find(editor(), bySource(`entry:${id("dump")}:title`));
    cursorAt(editor(), sentence.pos + 3);
    const added: PMNode[] = [];
    act(() => void added.push(...insertEntry(editor(), garnet, target, ftp, true)));

    const step = json(editor()).content!.find((n) => n.type === "list" && holds(n, "dump"))!;
    const wanted = entryBlocks(garnet, ftp).map(sourceOf);
    expect(step.content!.map(sourceOf)).toEqual([
      `entry:${id("dump")}:title`,
      ...wanted,
      `entry:${id("dump")}:0:command`,
      `entry:${id("dump")}:0:output`,
    ]);
    expect(wanted).toEqual([`entry:${id("ftp")}:title`, `entry:${id("ftp")}:0:command`, `entry:${id("ftp")}:0:output`]);
    expect(added.map((n) => n.attrs.source)).toEqual(wanted);
  });

  it("+ add in an empty paragraph replaces it; a hint paragraph is never replaced", async () => {
    const empty: ReportNode = { type: "list", attrs: { kind: "ordered" }, content: [{ type: "paragraph" }] };
    const hinted: ReportNode = { type: "paragraph", attrs: { hint: "Say what this step does" } };
    const { editor } = await ready({ type: "doc", content: [empty, hinted] });
    const ftp = entry(garnet, "ftp");
    cursorAt(editor(), 2);
    act(() => void insertEntry(editor(), garnet, target, ftp, true));
    expect(json(editor()).content![0].content!.map(sourceOf)).toEqual(entryBlocks(garnet, ftp).map(sourceOf));

    const hint = find(editor(), (n) => n.attrs.hint === "Say what this step does");
    cursorAt(editor(), hint.pos + 1);
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "head"), true));
    const top = json(editor()).content!;
    expect(top[1].attrs?.hint).toBe("Say what this step does");
    expect(top.slice(2).map(sourceOf)).toEqual(entryBlocks(garnet, entry(garnet, "head")).map(sourceOf));
  });

  it("+ add with the cursor in a table cell puts the blocks after the table, never in a cell", async () => {
    const { editor } = await ready(draft);
    const table = find(editor(), (n) => n.type.name === "table");
    const cell = find(editor(), (n) => n.type.name === "tableCell");
    cursorAt(editor(), cell.pos + 2);
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "ftp"), true));
    const top = json(editor()).content!;
    const at = top.findIndex((n) => n.type === "table");
    expect(top[at + 1].attrs?.source).toBe(`entry:${id("ftp")}:title`);
    expect(JSON.stringify(top[at])).not.toContain(id("ftp"));
    expect(table.node.type.name).toBe("table");
  });

  it("+ add with no cursor appends a numbered step at the end of its phase, before the next heading", async () => {
    const { editor } = await ready(without("fuse"));
    const fuse = entry(garnet, "fuse");
    expect(phaseInsertAt(json(editor()), garnet, target, fuse).before).toEqual([]);
    act(() => void insertEntry(editor(), garnet, target, fuse, false));
    const top = json(editor()).content!;
    const additional = top.findIndex((n) => sourceOf(n) === `phase:${GARNET_HOST}:additional`);
    const step = top[additional - 1];
    expect(step).toMatchObject({ type: "list", attrs: { kind: "ordered" } });
    expect(step.content!.map(sourceOf)).toEqual(entryBlocks(garnet, fuse).map(sourceOf));
    expect(sourceOf(step.content![0])).toBe(`entry:${id("fuse")}:observations`);
  });

  it("+ add for a phase with no heading yet adds the heading and Steps to reproduce first", async () => {
    // garnet without its privilege escalation section: the kernel check has no heading to go under.
    const content = draft.content!;
    const from = content.findIndex((n) => (sourceOf(n) ?? "").startsWith(`phase:${GARNET_HOST}:privesc`));
    const to = content.findIndex((n) => sourceOf(n) === `phase:${GARNET_HOST}:additional`);
    const { editor } = await ready({ ...draft, content: [...content.slice(0, from), ...content.slice(to)] });
    const kernel = entry(garnet, "kernel");
    act(() => void insertEntry(editor(), garnet, target, kernel, false));
    const top = json(editor()).content!;
    const at = top.findIndex((n) => sourceOf(n) === `phase:${GARNET_HOST}:privesc`);
    expect(at).toBe(from);
    expect(top[at]).toMatchObject({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Privilege escalation" }] });
    expect(top[at + 1]).toMatchObject({ type: "paragraph", attrs: { source: `phase-steps:${GARNET_HOST}` }, content: [{ text: "Steps to reproduce:" }] });
    expect(top[at + 2].content!.map(sourceOf)).toEqual(entryBlocks(garnet, kernel).map(sourceOf));
    expect(sourceOf(top[at + 3])).toBe(`phase:${GARNET_HOST}:additional`);

    // A second entry of that phase goes after it, with no second heading or label.
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "build"), false));
    const after = json(editor()).content!;
    expect(after.filter((n) => sourceOf(n) === `phase:${GARNET_HOST}:privesc`)).toHaveLength(1);
    expect(after.filter((n) => sourceOf(n) === `phase-steps:${GARNET_HOST}`)).toHaveLength(2);
    expect(holds(after[at + 3], "build")).toBe(true);
  });

  it("the entry a lead's block shows is no longer unused once the lead is added", async () => {
    const { editor } = await ready(without("ssh"));
    expect(unusedEntries(garnet, target, json(editor())).map((e) => e.id)).toContain(id("local"));
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "ssh"), false));
    expect(unusedEntries(garnet, target, json(editor())).map((e) => e.id)).not.toContain(id("local"));
  });

  it("with the cursor in a heading, + add places by phase, as with no cursor", async () => {
    const { editor } = await ready(without("fuse"));
    cursorAt(editor(), find(editor(), (n) => n.type.name === "heading" && String(n.attrs.source).startsWith(`phase:${GARNET_HOST}:foothold`)).pos + 2);
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "fuse"), true));
    const top = json(editor()).content!;
    const additional = top.findIndex((n) => sourceOf(n) === `phase:${GARNET_HOST}:additional`);
    expect(holds(top[additional - 1], "fuse")).toBe(true);
  });

  it("with no cursor, a screenshot that came along with a step joins the step holding its companion", async () => {
    const content = draft.content!.map((n) => (holds(n, "ssh") ? { ...n, content: n.content!.filter((b) => b.type !== "figure") } : n));
    const { editor } = await ready({ ...draft, content });
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "local-shot"), false));
    const step = json(editor()).content!.find((n) => holds(n, "ssh"))!;
    expect(step.content!.map((b) => b.type)).toEqual(["paragraph", "codeBlock", "codeBlock", "figure"]);
    expect(json(editor()).content).toHaveLength(content.length);
  });

  it("typing right after an insert is its own undo step", async () => {
    const { editor } = await ready(without("fuse"));
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "fuse"), false));
    const inserted = json(editor());
    typeAt(editor(), find(editor(), bySource(`entry:${id("fuse")}:observations`)).pos + 1, "X");
    fireEvent.keyDown(editor().view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(json(editor())).toEqual(inserted);
  });

  it("each insert is one undoable step", async () => {
    const { editor } = await ready(without("fuse"));
    const before = json(editor());
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "fuse"), false));
    expect(json(editor())).not.toEqual(before);
    fireEvent.keyDown(editor().view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(json(editor())).toEqual(before);
  });
});

describe("the block menu: Refresh and Delete", () => {
  it("Refresh on an unedited block replaces it without asking", async () => {
    const data = newOutput("head", "ref: refs/heads/dev\n\n");
    const { container, editor } = await ready(draft, data);
    const items = await menuFor(container, find(editor(), bySource(`entry:${id("head")}:0:output`)));
    expect(items).toEqual(["Refresh from log", "Delete"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from log" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(find(editor(), bySource(`entry:${id("head")}:0:output`)).node.textContent).toBe("ref: refs/heads/dev");
  });

  it("Refresh on an edited block asks; Cancel keeps it; Replace swaps only its run; undo restores", async () => {
    const data = newOutput("head", "ref: refs/heads/dev");
    const { container, editor } = await ready(draft, data);
    const output = find(editor(), bySource(`entry:${id("head")}:0:output`));
    typeAt(editor(), output.pos + 1, "MY ");
    const edited = json(editor());
    const ask = async () => {
      await menuFor(container, find(editor(), bySource(`entry:${id("head")}:0:output`)));
      fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from log" }));
      return screen.findByRole("dialog", { name: "Replace this block with the current version?" });
    };

    const dialog = await ask();
    expect(dialog).toHaveTextContent("Your edits to this block are replaced. ⌘Z brings them back.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(json(editor())).toEqual(edited);

    await ask();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const step = (doc: ReportNode) => doc.content!.find((n) => n.type === "list" && holds(n, "head"))!;
    const now = json(editor());
    expect(find(editor(), bySource(`entry:${id("head")}:0:output`)).node.textContent).toBe("ref: refs/heads/dev");
    // Only that block changed: its neighbours, and every other block of the page, are as they were.
    expect(step(now).content!.slice(0, 2)).toEqual(step(edited).content!.slice(0, 2));
    expect(now.content!.filter((n) => !holds(n, "head"))).toEqual(edited.content!.filter((n) => !holds(n, "head")));

    fireEvent.keyDown(editor().view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(json(editor())).toEqual(edited);
    expect(find(editor(), bySource(`entry:${id("head")}:0:output`)).node.textContent).toContain("MY ");
  });

  it("a confirmed run that moved is found again by its source and asked about again, never whatever sits at its old place", async () => {
    const data = newOutput("head", "ref: refs/heads/dev");
    const { container, editor } = await ready(draft, data);
    typeAt(editor(), find(editor(), bySource(`entry:${id("head")}:0:output`)).pos + 1, "MY ");
    await menuFor(container, find(editor(), bySource(`entry:${id("head")}:0:output`)));
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from log" }));
    await screen.findByRole("dialog", { name: "Replace this block with the current version?" });
    // The page shifts under the dialog: a paragraph lands at the top.
    act(() => editor().view.dispatch(editor().state.tr.insert(0, editor().state.schema.nodes.paragraph.create(null, editor().state.schema.text("New")))));
    const shifted = json(editor());
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    // Asked again about the run where it stands now; nothing changed yet.
    expect(await screen.findByRole("dialog", { name: "Replace this block with the current version?" })).toBeInTheDocument();
    expect(json(editor())).toEqual(shifted);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(find(editor(), bySource(`entry:${id("head")}:0:output`)).node.textContent).toBe("ref: refs/heads/dev");
    expect(json(editor()).content![0]).toEqual(shifted.content![0]);
  });

  it("typing right after a Replace is its own undo step", async () => {
    const data = newOutput("head", "ref: refs/heads/dev");
    const { container, editor } = await ready(draft, data);
    await menuFor(container, find(editor(), bySource(`entry:${id("head")}:0:output`)));
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from log" }));
    const refreshed = json(editor());
    typeAt(editor(), find(editor(), bySource(`entry:${id("head")}:0:output`)).pos + 1, "X");
    fireEvent.keyDown(editor().view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(json(editor())).toEqual(refreshed);
  });

  it("a flattened block (no gen) counts as edited, so Refresh asks", async () => {
    const plain: ReportNode = { type: "doc", content: [{ type: "codeBlock", attrs: { language: "", source: `entry:${id("head")}:0:output` }, content: [{ type: "text", text: "ref: refs/heads/main" }] }] };
    const { container, editor } = await ready(plain);
    expect(isEdited([editor().state.doc.child(0)])).toBe(true);
    await menuFor(container, { node: editor().state.doc.child(0), pos: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from log" }));
    expect(await screen.findByRole("dialog", { name: "Replace this block with the current version?" })).toBeInTheDocument();
  });

  it("Refresh replaces the whole run of an observations source, nothing else", async () => {
    const said = "The repository holds an old commit.\n\nIts parent removed the password.";
    const data = withEntry("show", (e) => ({ ...e, observations: said }));
    const obs = `entry:${id("show")}:observations`;
    const page: ReportNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        {
          type: "list",
          attrs: { kind: "ordered" },
          content: [
            { type: "paragraph", attrs: { source: obs }, content: [{ type: "text", text: "Old one" }] },
            { type: "paragraph", attrs: { source: obs }, content: [{ type: "text", text: "Old two" }] },
            { type: "codeBlock", attrs: { language: "", source: `entry:${id("show")}:0:command` }, content: [{ type: "text", text: "git log" }] },
          ],
        },
      ],
    };
    const { editor } = await ready(page, data);
    const before = json(editor());
    const run = sourceRun(editor().state.doc, find(editor(), (n) => n.textContent === "Old two").pos)!;
    expect(run.nodes.map((n) => n.textContent)).toEqual(["Old one", "Old two"]);
    expect(run.source).toBe(obs);
    act(() => void refreshRun(editor(), run, data, target, {}));
    const after = json(editor());
    const fresh = sourceBlocks(obs, data, target, {})!;
    expect(fresh.length).toBeGreaterThan(1);
    expect(after.content![0]).toEqual(before.content![0]);
    expect(after.content![1].content!.map((n) => n.content?.map((t) => t.text).join(""))).toEqual([...fresh.map((n) => n.content?.map((t) => t.text).join("")), "git log"]);
    expect(after.content![1].content!.slice(0, -1).map(sourceOf)).toEqual(fresh.map(sourceOf));
  });

  it("a block whose entry is private or deleted offers no Refresh", async () => {
    const data = { ...withEntry("head", (e) => ({ ...e, private: true })), log: withEntry("head", (e) => ({ ...e, private: true })).log.filter((e) => e.id !== id("dump")) };
    const { container, editor } = await ready(draft, data);
    expect(await menuFor(container, find(editor(), bySource(`entry:${id("head")}:0:output`)))).toEqual(["Delete"]);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Block actions" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(await menuFor(container, find(editor(), bySource(`entry:${id("dump")}:0:command`)))).toEqual(["Delete"]);
  });

  it("a heading or an owner paragraph offers no Refresh", async () => {
    const owner: ReportNode = { type: "paragraph", content: [{ type: "text", text: "My own words" }] };
    const { container, editor } = await ready({ ...draft, content: [...draft.content!, owner] });
    expect(await menuFor(container, find(editor(), (n) => n.type.name === "heading" && String(n.attrs.source).startsWith("phase:")))).toEqual(["Delete"]);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Block actions" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(await menuFor(container, find(editor(), (n) => n.textContent === "My own words"))).toEqual(["Delete"]);
  });

  it("an entry's sentence refreshes as one: a title becomes the observations written since, and back", async () => {
    const said = "The web root serves a .git folder.";
    const written = withEntry("head", (e) => ({ ...e, observations: said }));
    const { container, editor } = await ready(draft, written);
    const title = find(editor(), bySource(`entry:${id("head")}:title`));
    expect(await menuFor(container, title)).toEqual(["Refresh from log", "Delete"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from log" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const now = find(editor(), bySource(`entry:${id("head")}:observations`));
    expect(now.node.textContent).toBe(said);
    expect(editor().state.doc.nodeAt(now.pos + now.node.nodeSize)?.attrs.source).toBe(`entry:${id("head")}:0:command`);
    // And back: with the observations cleared, the title sentence returns in their place.
    const run = sourceRun(editor().state.doc, now.pos)!;
    act(() => void refreshRun(editor(), run, garnet, target, {}));
    const back = find(editor(), bySource(`entry:${id("head")}:title`));
    const title0 = sourceBlocks(`entry:${id("head")}:title`, garnet, target, {})![0];
    expect([back.node.textContent, back.node.attrs.gen]).toEqual([title0.content!.map((t) => t.text).join(""), title0.attrs!.gen]);
    expect(isEdited([back.node])).toBe(false);
  });

  it("a block that regenerates to nothing offers no Refresh and is never taken away by one", async () => {
    const data = newOutput("head", "");
    const { container, editor } = await ready(draft, data);
    const output = find(editor(), bySource(`entry:${id("head")}:0:output`));
    expect(await menuFor(container, output)).toEqual(["Delete"]);
    const before = json(editor());
    expect(refreshRun(editor(), sourceRun(editor().state.doc, output.pos)!, data, target, {})).toBe(false);
    expect(json(editor())).toEqual(before);
  });

  it("a result line or port table with nothing to show offers no Refresh", async () => {
    const bare: ReportData = { ...garnet, services: [], grants: [], log: garnet.log.filter((e) => e.content.kind !== "flag") };
    const result = draft.content!.find((n) => sourceOf(n) === `result:${GARNET_HOST}`)!;
    const ports = draft.content!.find((n) => sourceOf(n) === `ports:${GARNET_HOST}`)!;
    expect(result && ports).toBeTruthy();
    const { container, editor } = await ready({ type: "doc", content: [result, ports] }, bare);
    expect(await menuFor(container, find(editor(), bySource(`result:${GARNET_HOST}`)))).toEqual(["Delete"]);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Block actions" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(await menuFor(container, find(editor(), bySource(`ports:${GARNET_HOST}`)))).toEqual(["Delete"]);
  });

  it("an empty hint paragraph is not edited: Refresh replaces it without asking", async () => {
    const hint: ReportNode = { type: "paragraph", attrs: { hint: "No findings recorded yet", source: "table:findings" } };
    const { container, editor } = await ready({ type: "doc", content: [hint] });
    expect(isEdited([editor().state.doc.child(0)])).toBe(false);
    expect(await menuFor(container, { node: editor().state.doc.child(0), pos: 0 })).toEqual(["Refresh from Raven", "Delete"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh from Raven" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor().state.doc.child(0).type.name).toBe("table");
  });

  it("the block menu never offers Move to appendix", async () => {
    const { container, editor } = await ready(draft);
    for (const pick of [(n: PMNode) => n.type.name === "figure", (n: PMNode) => n.type.name === "table", bySource(`entry:${id("head")}:0:output`)]) {
      const items = await menuFor(container, find(editor(), pick));
      expect(items).not.toContain("Move to appendix");
      expect(items).not.toContain("Back inline");
      fireEvent.keyDown(screen.getByRole("menu", { name: "Block actions" }), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
  });

  it("names its source: the log, a finding (or its file), else Raven", () => {
    expect(refreshLabel("entry:l-1:0:output")).toBe("Refresh from log");
    expect(refreshLabel("entry:l-1")).toBe("Refresh from log");
    expect(refreshLabel("finding:f-1:fix")).toBe("Refresh from finding");
    expect(refreshLabel("file:ff-1")).toBe("Refresh from finding");
    expect(refreshLabel("ports:h-1")).toBe("Refresh from Raven");
    expect(refreshLabel("table:msf")).toBe("Refresh from Raven");
  });
});

describe("Add new evidence", () => {
  function addButton(editor: Editor, removed: string[], onAdded = vi.fn()) {
    render(
      <TooltipProvider>
        <AddEvidenceButton editor={editor} data={garnet} target={target} meta={{}} removed={removed} onAdded={onAdded} />
      </TooltipProvider>,
    );
    return onAdded;
  }

  it("adds what the draft would place and isn't on the page or removed; Undo takes off exactly that", async () => {
    const { editor, onRemoveEvidence } = await ready(without("fuse", "dump"));
    const before = json(editor());
    expect(missingEntries(before, garnet, target, {}, [id("dump")]).map((e) => e.id)).toEqual([id("fuse")]);
    const onAdded = addButton(editor(), [id("dump")]);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Added 1 entry")).toBeInTheDocument();
    expect(onAdded).toHaveBeenCalled();
    const top = json(editor()).content!;
    const additional = top.findIndex((n) => sourceOf(n) === `phase:${GARNET_HOST}:additional`);
    expect(holds(top[additional - 1], "fuse")).toBe(true);
    expect(top.some((n) => holds(n, "dump"))).toBe(false);
    expect(top.filter((n) => holds(n, "fuse"))).toHaveLength(1);

    // The page's own Undo button, beside the notice (the editor's toolbar has one too).
    fireEvent.click(within(screen.getByText("Added 1 entry").closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Undo" }));
    expect(json(editor())).toEqual(before);
    // The page's own Undo is never the owner's removal.
    expect(onRemoveEvidence).not.toHaveBeenCalled();
  });

  it("an entry the draft shows inside another's block is placed with it once: the flag value printed once, never its own step", async () => {
    const { editor, onRemoveEvidence } = await ready(without("ssh"));
    addButton(editor(), []);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    // The login, and its screenshot in the same step; local.txt is shown by the login's output.
    expect(await screen.findByText("Added 2 entries")).toBeInTheDocument();
    const check = () => {
      const page = json(editor());
      const text = JSON.stringify(page);
      // As often as the draft prints it: the Result line and the login's output.
      expect(text.split("4c1d8e2f9a7b3065e2c4a9f1d7b80e36")).toHaveLength(JSON.stringify(draft).split("4c1d8e2f9a7b3065e2c4a9f1d7b80e36").length);
      expect(text).not.toContain(`entry:${id("local")}:`);
      expect(text).not.toContain("Read local.txt:");
      const step = page.content!.find((n) => holds(n, "ssh"))!;
      expect(step.content!.map((b) => b.type)).toEqual(["paragraph", "codeBlock", "codeBlock", "figure"]);
      expect(step.content![2].attrs?.also).toEqual([id("local")]);
      expect(step.content![3].attrs?.entryId).toBe(id("local-shot"));
      expect(missingEntries(page, garnet, target, {}, [])).toEqual([]);
    };
    check();
    // A later Refresh of every block keeps it so.
    const sources = new Set<string>();
    editor().state.doc.descendants((n) => void (typeof n.attrs.source === "string" && n.attrs.source && sources.add(n.attrs.source)));
    for (const source of sources) {
      const run = sourceRun(editor().state.doc, find(editor(), bySource(source)).pos);
      if (run) act(() => void refreshRun(editor(), run, garnet, target, {}));
    }
    check();
    expect(onRemoveEvidence).not.toHaveBeenCalled();
  });

  it("Undo takes off exactly what one run added, a screenshot that joined a step added in the same run included", async () => {
    const { editor, onRemoveEvidence } = await ready(without("ssh"));
    const before = json(editor());
    addButton(editor(), []);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    await screen.findByText("Added 2 entries");
    fireEvent.click(within(screen.getByText("Added 2 entries").closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Undo" }));
    expect(json(editor())).toEqual(before);
    expect(onRemoveEvidence).not.toHaveBeenCalled();
  });

  it("restores a machine's Also tested list when the page has none; Undo takes it off too", async () => {
    const page = { ...draft, content: draft.content!.filter((n) => !(sourceOf(n) ?? "").includes("tested")) };
    const { editor } = await ready(page);
    const before = json(editor());
    addButton(editor(), []);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Added the Also tested list")).toBeInTheDocument();
    const tail = json(editor()).content!.slice(-2);
    expect(tail.map(sourceOf)).toEqual([`phase:${GARNET_HOST}:tested`, `tested:${GARNET_HOST}`]);
    const words = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(words).join("");
    expect(tail.map(words)).toEqual(draft.content!.slice(-2).map(words));
    fireEvent.click(within(screen.getByText("Added the Also tested list").closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Undo" }));
    expect(json(editor())).toEqual(before);
  });

  it("says Nothing new to add when the page holds everything the draft would place", async () => {
    const { editor } = await ready(draft);
    addButton(editor(), []);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Nothing new to add")).toBeInTheDocument();
    expect(json(editor()).content).toHaveLength(draft.content!.length);
  });

  it("adds several in time order, each at the end of its phase", async () => {
    const { editor } = await ready(without("head", "kernel", "fuse"));
    addButton(editor(), []);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Added 3 entries")).toBeInTheDocument();
    const top = json(editor()).content!;
    const at = (name: string) => top.findIndex((n) => holds(n, name));
    const privesc = top.findIndex((n) => (sourceOf(n) ?? "").startsWith(`phase:${GARNET_HOST}:privesc`));
    expect(at("head")).toBeLessThan(privesc);
    expect(at("kernel")).toBeGreaterThan(privesc);
    expect(at("fuse")).toBe(at("kernel") + 1);
  });
});

describe("removal tracking", () => {
  it("deleting a machine's whole Also tested list records it; undo un-records it; Add new evidence leaves it deleted", async () => {
    const { editor, onRemoveEvidence } = await ready(draft);
    const key = `tested:${GARNET_HOST}`;
    const tail = () => {
      const doc = editor().state.doc;
      let from = 0;
      doc.forEach((n, offset) => void (n.attrs.source === `phase:${GARNET_HOST}:tested` && (from = offset)));
      return { from, to: doc.content.size };
    };
    act(() => {
      const { from, to } = tail();
      editor().view.dispatch(editor().state.tr.delete(from, to));
    });
    expect(onRemoveEvidence).toHaveBeenCalledWith(key);
    expect(pruneRemoved(json(editor()), { removedEntryIds: [key] })).toEqual({ removedEntryIds: [key] });
    // Recorded: Add new evidence won't bring it back.
    expect(missingTested(json(editor()), garnet, target, {}, GARNET_HOST, [key])).toBeNull();
    expect(missingTested(json(editor()), garnet, target, {}, GARNET_HOST, [])).not.toBeNull();
    render(
      <TooltipProvider>
        <AddEvidenceButton editor={editor()} data={garnet} target={target} meta={{}} removed={[key]} onAdded={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Nothing new to add")).toBeInTheDocument();
    // Undo brings it back: the save drops it from the removed list.
    fireEvent.keyDown(editor().view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(pruneRemoved(json(editor()), { removedEntryIds: [key] })).toEqual({ removedEntryIds: [] });
    expect(onRemoveEvidence).toHaveBeenCalledTimes(1);
  });

  it("deleting every block of an entry records it as removed; undo un-records it", async () => {
    const { editor, onRemoveEvidence } = await ready(draft);
    // One block of the step: the entry is still on the page.
    act(() => void deleteBlockAt(editor(), find(editor(), bySource(`entry:${id("dump")}:0:output`))));
    expect(onRemoveEvidence).not.toHaveBeenCalled();
    // The rest of it.
    act(() => void deleteBlockAt(editor(), find(editor(), (n) => n.type.name === "list" && n.textContent.startsWith("Download the repository"))));
    expect(onRemoveEvidence).toHaveBeenCalledWith(id("dump"));
    expect(onRemoveEvidence).toHaveBeenCalledTimes(1);
    const removed = { removedEntryIds: [id("dump")] };
    expect(pruneRemoved(json(editor()), removed)).toEqual(removed);

    // Undo brings the step back: the save drops it from the removed list.
    fireEvent.keyDown(editor().view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    expect(onRemoveEvidence).toHaveBeenCalledTimes(1);
    expect(pruneRemoved(json(editor()), removed)).toEqual({ removedEntryIds: [] });
  });

  it("an entry a block names only in `also` or a figure stays placed while that block does", async () => {
    const { editor, onRemoveEvidence } = await ready(draft);
    // local.txt is placed by the login step's output (`also`); deleting the step's screenshot leaves it there.
    act(() => void deleteBlockAt(editor(), find(editor(), (n) => n.type.name === "figure" && n.attrs.entryId === id("local-shot"))));
    expect(onRemoveEvidence).toHaveBeenCalledWith(id("local-shot"));
    expect(onRemoveEvidence).not.toHaveBeenCalledWith(id("local"));
    act(() => void deleteBlockAt(editor(), find(editor(), (n) => Array.isArray(n.attrs.also) && (n.attrs.also as string[]).includes(id("local")))));
    expect(onRemoveEvidence).toHaveBeenCalledWith(id("local"));
  });

  it("a Refresh that swaps an entry's blocks is not the owner's removal", async () => {
    const data = withEntry("head", (e) => ({ ...e, observations: "Seen." }));
    const { editor, onRemoveEvidence } = await ready({ type: "doc", content: [{ type: "paragraph", attrs: { source: `entry:${id("head")}:title` }, content: [{ type: "text", text: "x" }] }] }, data);
    const run = sourceRun(editor().state.doc, 0)!;
    act(() => void refreshRun(editor(), run, data, target, {}));
    expect(editor().state.doc.child(0).attrs.source).toBe(`entry:${id("head")}:observations`);
    expect(onRemoveEvidence).not.toHaveBeenCalled();
  });
});

describe("every insert path keeps the page in the plain schema", () => {
  const plainOnly = (doc: ReportNode) => expect(types(doc).filter((t) => !PAGE_NODE_TYPES.includes(t))).toEqual([]);

  it("+ add at the cursor, at the end of a phase, under a new heading, a pasted image, Add new evidence and Refresh insert only PAGE_NODE_TYPES", async () => {
    const { editor } = await ready(without("fuse", "kernel", "ftp"));
    const ftp = entry(garnet, "ftp");
    cursorAt(editor(), find(editor(), bySource(`entry:${id("dump")}:title`)).pos + 2);
    act(() => void insertEntry(editor(), garnet, target, ftp, true));
    plainOnly(json(editor()));
    act(() => void insertEntry(editor(), garnet, target, entry(garnet, "fuse"), false));
    plainOnly(json(editor()));
    // A screenshot: a figure, its caption the page's to write.
    const shot = entry(garnet, "proof-shot");
    let figure: PMNode[] = [];
    act(() => void (figure = insertFigure(editor(), shot, 1)));
    expect(figure.map((n) => [n.type.name, n.attrs.entryId, n.content.size])).toEqual([["figure", shot.id, 0]]);
    plainOnly(json(editor()));
    // Every entry the log holds, at the cursor and by phase.
    for (const e of garnet.log) {
      act(() => void insertEntry(editor(), garnet, target, e, false));
      act(() => void insertEntry(editor(), garnet, target, e, true));
    }
    plainOnly(json(editor()));
    addAndRefresh(editor());
    plainOnly(json(editor()));
  });

  function addAndRefresh(editor: Editor) {
    render(
      <TooltipProvider>
        <AddEvidenceButton editor={editor} data={garnet} target={target} meta={{}} removed={[]} onAdded={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    const sources = new Set<string>();
    editor.state.doc.descendants((n) => void (typeof n.attrs.source === "string" && n.attrs.source && sources.add(n.attrs.source)));
    for (const s of sources) {
      const at = find(editor, bySource(s)).pos;
      const run = sourceRun(editor.state.doc, at);
      if (run) act(() => void refreshRun(editor, run, garnet, target, {}));
    }
  }
});
