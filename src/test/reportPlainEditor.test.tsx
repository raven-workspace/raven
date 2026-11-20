import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createEditor, type Editor, type NodeJSON } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { TextSelection } from "prosekit/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { blockHash, buildPlainTarget, buildSectionDraft, type ReportNode, type ReportTarget } from "../engines/report";
import { defineReportExtension } from "../features/report/editor/extension";
import { deleteBlockAt } from "../features/report/editor/pageActions";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { keepCopiedText, ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import { RavenError } from "../types/errors";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E = "eng";
const data = garnetFixtures(1_700_000_000_000);
const target: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };

const doc = (content: ReportNode[]): ReportNode => ({ type: "doc", content });
const text = (t: string): ReportNode => ({ type: "text", text: t });
const figure = (attachmentId: string, caption: string, entryId: string): ReportNode => ({
  type: "figure",
  attrs: { attachmentId, entryId, source: `entry:${entryId}` },
  content: caption ? [text(caption)] : [],
});

const garnetDraft = buildPlainTarget(data, target, {});
const summaryDraft = buildSectionDraft("summary", data, {} as Settings);
const ownerPage = doc([
  { type: "heading", attrs: { level: 1 }, content: [text("Lessons")] },
  { type: "paragraph", content: [text("What I would do again.")] },
  { type: "list", attrs: { kind: "bullet" }, content: [{ type: "paragraph", content: [text("Enumerate every port")] }] },
  { type: "codeBlock", attrs: { language: "bash" }, content: [text("nmap -p- 10.0.0.5")] },
]);

const all = (n: ReportNode): ReportNode[] => [n, ...(n.content ?? []).flatMap(all)];
/** Every hidden attr a page's blocks carry, in order. */
const sources = (n: ReportNode) =>
  all(n)
    .filter((b) => b.attrs?.source || b.attrs?.gen || b.attrs?.hint || b.attrs?.also)
    .map((b) => [b.type, b.attrs!.source ?? null, b.attrs!.gen ?? null, b.attrs!.hint ?? null, b.attrs!.also ?? null]);
/** The text of every textblock on a page, in order. */
const textblocks = (n: ReportNode): string[] => {
  const out: string[] = [];
  const walk = (b: ReportNode) => {
    if (["paragraph", "heading", "codeBlock", "figure"].includes(b.type)) out.push(JSON.stringify(b.content ?? []));
    else (b.content ?? []).forEach(walk);
  };
  walk(n);
  return out;
};
const changedBlocks = (before: ReportNode, after: ReportNode) => {
  const a = textblocks(before);
  const b = textblocks(after);
  expect(b).toHaveLength(a.length);
  return a.filter((t, i) => t !== b[i]);
};

function typeAt(editor: Editor, pos: number, t: string) {
  act(() => {
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    for (const ch of t) {
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  });
}

/** The position inside the first node (in document order) that `pick` accepts: the start of its text. */
function inside(editor: Editor, pick: (node: PMNode, parent: PMNode | null) => boolean): number {
  let at = -1;
  editor.state.doc.descendants((node, pos, parent) => {
    if (at >= 0) return false;
    if (pick(node, parent)) at = pos + 1;
    return at < 0;
  });
  expect(at).toBeGreaterThan(0);
  return at;
}

let qc = makeQueryClient();
function page(content: ReportNode) {
  const ref: { editor: Editor | null } = { editor: null };
  qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ReportDataContext.Provider value={{ data, onRemoveEvidence: vi.fn(), target }}>
        <ReportEditor doc={content} onChange={vi.fn()} onReady={(e) => (ref.editor = e)} />
      </ReportDataContext.Provider>
    </QueryClientProvider>,
  );
  return () => ref.editor!;
}

async function ready(content: ReportNode) {
  const editor = page(content);
  await waitFor(() => expect(editor()?.mounted).toBe(true));
  return editor();
}

// jsdom has no layout for ranges: commands that scroll the selection into view measure one.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ machines: ["Kali (VM)"] } as Settings);
  m.attachmentGet.mockResolvedValue({ id: "a1", mime: "image/png", dataBase64: "AAAA" });
  m.logList.mockResolvedValue(data.log);
  m.findingsList.mockResolvedValue(data.findings);
  m.findingFilesList.mockResolvedValue(data.findingFiles);
});
afterEach(() => vi.restoreAllMocks());

describe("one plain schema for every page", () => {
  it("a plain target, a plain summary and an owner page all load in the one schema", () => {
    expect(sources(garnetDraft).length).toBeGreaterThan(0);
    expect(sources(summaryDraft).some(([, , , hint]) => hint)).toBe(true);
    for (const d of [garnetDraft, summaryDraft, ownerPage]) {
      const e = createEditor({ extension: defineReportExtension(), defaultContent: d as NodeJSON });
      expect(() => e.state.doc.check()).not.toThrow();
      expect(sources(e.getDocJSON() as ReportNode)).toEqual(sources(d)); // every source, gen, hint and also survives
    }
  });

  it("keeps a block's `also` (the entries it already shows) through the editor and its HTML", () => {
    const withAlso = doc([{ type: "codeBlock", attrs: { language: "", source: "entry:l-1:0:output", also: ["l-flag", "l-2"] }, content: [text("whoami")] }]);
    const e = createEditor({ extension: defineReportExtension(), defaultContent: withAlso as NodeJSON });
    expect((e.getDocJSON() as ReportNode).content![0].attrs?.also).toEqual(["l-flag", "l-2"]);
    const html = e.getDocHTML();
    expect(html).toContain('data-also="l-flag l-2"');
    const back = createEditor({ extension: defineReportExtension() });
    back.setContent(html);
    expect((back.getDocJSON() as ReportNode).content![0].attrs?.also).toEqual(["l-flag", "l-2"]);
  });

  it("blockHash matches after a schema round trip", () => {
    const e = createEditor({ extension: defineReportExtension(), defaultContent: garnetDraft as NodeJSON });
    e.state.doc.forEach((n, _o, i) => expect(blockHash(n.toJSON() as ReportNode)).toBe(blockHash(garnetDraft.content![i])));
  });

  it("editing every block type changes only the page: the log, findings and files are untouched", async () => {
    const editor = await ready(doc([...garnetDraft.content!, { type: "paragraph", attrs: { hint: "Wrap-up" } }]));
    const beforeDoc = editor.getDocJSON() as ReportNode;
    const before = JSON.stringify([await api.logList(E), await api.findingsList(E), await api.findingFilesList(E)]);
    const top = (parent: PMNode | null) => parent === editor.state.doc;
    const finders: ((n: PMNode, p: PMNode | null) => boolean)[] = [
      (n, p) => n.type.name === "paragraph" && top(p) && n.content.size > 0,
      (n, p) => n.type.name === "paragraph" && p?.type.name === "list" && p.attrs.kind === "ordered" && n.content.size > 0,
      (n) => n.type.name === "codeBlock",
      (n) => n.type.name === "table" && String(n.attrs.source).startsWith("ports:"),
      (n) => n.type.name === "figure",
      (n) => n.type.name === "paragraph" && n.attrs.hint === "Wrap-up",
    ];
    for (const find of finders) {
      let at = inside(editor, find);
      // A table: its first body row's last cell (Notes), inside its paragraph.
      if (editor.state.doc.resolve(at).parent.type.name === "table") {
        const table = editor.state.doc.resolve(at).parent;
        const row = table.child(1);
        at = at + table.child(0).nodeSize + 1 + (row.content.size - row.lastChild!.nodeSize) + 2;
        expect(editor.state.doc.resolve(at).parent.type.name).toBe("paragraph");
      }
      typeAt(editor, at, "X");
    }
    expect(changedBlocks(beforeDoc, editor.getDocJSON() as ReportNode)).toHaveLength(6);
    expect(JSON.stringify([await api.logList(E), await api.findingsList(E), await api.findingFilesList(E)])).toBe(before);
    // Nothing on the page wrote to the log, a finding or a file: only reads went out.
    const called = Object.entries(m).filter(([, f]) => typeof f === "function" && "mock" in f && f.mock.calls.length > 0).map(([k]) => k);
    expect(called.filter((k) => !["settingsGet", "attachmentGet", "logList", "findingsList", "findingFilesList"].includes(k))).toEqual([]);
  });

  it("a hint paragraph shows its hint until typed in", async () => {
    const editor = await ready(doc([{ type: "paragraph", attrs: { hint: "What the engagement was" } }]));
    expect(document.querySelector('.report-page p.report-hint[data-hint="What the engagement was"]')).not.toBeNull();
    // The cursor in it shows the hint, not the page's own placeholder.
    act(() => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1))));
    expect(document.querySelector(".report-page .prosekit-placeholder")).toBeNull();
    typeAt(editor, 1, "We tested");
    expect(document.querySelector(".report-page p.report-hint")).toBeNull();
    expect((editor.getDocJSON() as ReportNode).content![0].attrs?.hint).toBe("What the engagement was");
  });

  it("serialises a figure with its image and caption for the PDF; source, gen and hint print no text", () => {
    const html = createEditor({
      extension: defineReportExtension(),
      defaultContent: doc([figure("a-1", "Root shell", "l-1"), { type: "paragraph", attrs: { hint: "Wrap-up", source: "summary", gen: "abc" } }]) as NodeJSON,
    }).getDocHTML();
    expect(html).toMatch(/<figure data-report="figure" data-attachment="a-1"[^>]*><img data-attachment="a-1" alt=""><figcaption>Root shell<\/figcaption><\/figure>/);
    expect(html).not.toContain(">Wrap-up<");
    expect(html).not.toContain(">summary<");
    expect(html).not.toContain(">abc<");
  });

  it("a resized figure keeps its width for the PDF; a bad width is full width", () => {
    const sized = { ...figure("a-1", "Root shell", "l-1"), attrs: { attachmentId: "a-1", entryId: "l-1", width: 420 } };
    const odd = { ...figure("a-2", "Other", "l-1"), attrs: { attachmentId: "a-2", entryId: "l-1", width: -3 } };
    const html = createEditor({ extension: defineReportExtension(), defaultContent: doc([sized, odd]) as NodeJSON }).getDocHTML();
    expect(html).toContain('data-width="420"');
    expect(html).toContain('<img data-attachment="a-1" alt="" style="width: 420px; max-width: 100%;">');
    expect(html).toContain('<img data-attachment="a-2" alt="">');
    const back = createEditor({ extension: defineReportExtension(), defaultContent: doc([]) as NodeJSON });
    back.setContent(html);
    expect(back.state.doc.child(0).attrs.width).toBe(420);
    expect(back.state.doc.child(1).attrs.width).toBeNull();
  });

  it("a screenshot on the page has a corner to resize it", async () => {
    m.attachmentGet.mockResolvedValue({ id: "a-1", mime: "image/png", dataBase64: "AAAA" });
    await ready(doc([{ ...figure("a-1", "Root shell", "l-1"), attrs: { attachmentId: "a-1", entryId: "l-1", width: 420 } }]));
    await waitFor(() => expect(document.querySelector(".report-plain-figure img")).not.toBeNull());
    expect(document.querySelector('.report-plain-figure .report-resizable [aria-label="Resize the screenshot"]')).not.toBeNull();
  });

  it("a figure whose screenshot file is missing says so and stays editable", async () => {
    m.attachmentGet.mockRejectedValue(new RavenError("not_found", "gone"));
    const editor = await ready(doc([figure("a-missing", "Root shell", "l-1")]));
    const line = await screen.findByText("This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.");
    // The page's amber ink (readable on the paper), not the dark UI's warn colour.
    expect(line).toHaveClass("report-missing");
    expect(line).not.toHaveClass("text-warn");
    typeAt(editor, 1 + "Root shell".length, " on web01");
    expect((editor.getDocJSON() as ReportNode).content![0].content![0].text).toBe("Root shell on web01");
    act(() => void deleteBlockAt(editor, { node: editor.state.doc.child(0), pos: 0 }));
    expect(editor.state.doc.childCount).toBe(1); // an empty paragraph remains
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
  });

  it("a missing screenshot shows again once its file loads", async () => {
    m.attachmentGet.mockRejectedValue(new RavenError("not_found", "gone"));
    await ready(doc([figure("a-back", "Root shell", "l-1")]));
    const words = "This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.";
    await screen.findByText(words);
    m.attachmentGet.mockResolvedValue({ id: "a-back", mime: "image/png", dataBase64: "AAAA" });
    await act(() => qc.invalidateQueries({ queryKey: ["attachment", "a-back"] }));
    await waitFor(() => expect(screen.queryByText(words)).toBeNull());
    expect(document.querySelector(".report-plain-figure img")).not.toBeNull();
  });

  it("Keep the text clears the entry from nested blocks and from a figure that names it only by entryId", () => {
    const e = createEditor({
      extension: defineReportExtension(),
      defaultContent: doc([
        {
          type: "list",
          attrs: { kind: "ordered", source: "entry:l-1:title" },
          content: [
            { type: "paragraph", attrs: { source: "entry:l-1:title" }, content: [text("Run it")] },
            { type: "codeBlock", attrs: { language: "", source: "entry:l-1:0:command", gen: "abc" }, content: [text("whoami")] },
          ],
        },
        { type: "figure", attrs: { attachmentId: "a-1", entryId: "l-1" }, content: [text("Shot")] },
        { type: "paragraph", attrs: { source: "entry:l-2:note" }, content: [text("Other")] },
      ]) as NodeJSON,
    });
    expect(keepCopiedText(e, "l-1")).toBe(true);
    const left = all(e.getDocJSON() as ReportNode).filter((n) => n.attrs?.source || n.attrs?.gen || n.attrs?.entryId);
    expect(left.map((n) => [n.type, n.attrs?.source ?? null, n.attrs?.entryId ?? null])).toEqual([["paragraph", "entry:l-2:note", null]]);
  });
});
