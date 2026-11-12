import {
  CheckSquare,
  CodeBlock,
  Image,
  ListBullets,
  ListNumbers,
  Minus,
  Quotes,
  Table,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextT,
  type Icon,
} from "@phosphor-icons/react";
import type { Editor } from "prosekit/core";
import { triggerAutocomplete } from "prosekit/extensions/autocomplete";
import { TextSelection } from "prosekit/pm/state";
import { AutocompleteEmpty, AutocompleteItem, AutocompletePopup, AutocompletePositioner, AutocompleteRoot } from "prosekit/react/autocomplete";
import { useEditor } from "prosekit/react";
import { useMemo, useState } from "react";
import { evidenceIdsIn, type ReportNode } from "../../../engines/report";
import type { LogEntry } from "../../../types/log";
import { cx } from "../../../lib/cx";
import { labelClass } from "../../../ui";
import { KIND_LABELS } from "../../log/kindLabels";
import { insertTable, setBlockKind, type PageEditor } from "./commands";
import type { EditingExtension } from "./extension";
import { placeEntry, usePageActions } from "./pageActions";
import { useReportData } from "./ReportDataContext";

interface BlockItem {
  id: string;
  icon: Icon;
  label: string;
  /** Words it also answers to. */
  keywords: string;
  /** The markdown that makes it as you type, shown as the hint. */
  markdown?: string;
  run(editor: PageEditor, actions: ReturnType<typeof usePageActions>): void;
}

const BLOCK_ITEMS: BlockItem[] = [
  { id: "paragraph", icon: TextT, label: "Paragraph", keywords: "text plain", run: (e) => setBlockKind(e, "paragraph") },
  { id: "h1", icon: TextHOne, label: "Heading 1", keywords: "title section", markdown: "#", run: (e) => setBlockKind(e, "h1") },
  { id: "h2", icon: TextHTwo, label: "Heading 2", keywords: "title subsection", markdown: "##", run: (e) => setBlockKind(e, "h2") },
  { id: "h3", icon: TextHThree, label: "Heading 3", keywords: "title subheading", markdown: "###", run: (e) => setBlockKind(e, "h3") },
  { id: "bullet", icon: ListBullets, label: "Bulleted list", keywords: "unordered ul", markdown: "-", run: (e) => e.commands.wrapInList({ kind: "bullet" }) },
  { id: "ordered", icon: ListNumbers, label: "Numbered list", keywords: "ordered ol steps", markdown: "1.", run: (e) => e.commands.wrapInList({ kind: "ordered" }) },
  { id: "task", icon: CheckSquare, label: "Task list", keywords: "todo checkbox", markdown: "[ ]", run: (e) => e.commands.wrapInList({ kind: "task" }) },
  { id: "quote", icon: Quotes, label: "Quote", keywords: "blockquote", markdown: ">", run: (e) => setBlockKind(e, "quote") },
  { id: "code", icon: CodeBlock, label: "Code block", keywords: "pre snippet", markdown: "```", run: (e) => setBlockKind(e, "code") },
  { id: "table", icon: Table, label: "Table", keywords: "grid credentials", run: (e) => insertTable(e) },
  { id: "divider", icon: Minus, label: "Divider", keywords: "horizontal rule hr line", markdown: "---", run: (e) => e.commands.insertHorizontalRule() },
  { id: "image", icon: Image, label: "Image", keywords: "screenshot picture", run: (_e, a) => a.pickImage() },
];

/** How well `query` matches `text` as a subsequence: higher is better, null is no match. Words starting the match win. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q === "") return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(query.toLowerCase().trim());
  if (direct !== -1) return 1000 - direct;
  let score = 0;
  let at = -1;
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1);
    if (next === -1) return null;
    score += next === at + 1 ? 3 : /\W/.test(t[next - 1] ?? " ") ? 2 : 1;
    at = next;
  }
  return score;
}

/** Evidence the slash menu offers: this target's non-private entries not on the page yet. */
function candidates(log: LogEntry[], hostIds: string[], doc: ReportNode): LogEntry[] {
  const onPage = evidenceIdsIn(doc);
  return log
    .filter((e) => !e.private && !onPage.has(e.id) && e.hostIds.some((h) => hostIds.includes(h)))
    .sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
}

const searchText = (e: LogEntry) =>
  `${e.title} ${e.content.kind === "command" ? e.content.blocks.map((b) => b.command).join(" ") : e.content.kind === "note" ? e.content.text : ""}`;

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: number) => `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`;

/** Pages in "evidence only" mode: opened from the toolbar's Insert evidence, the menu lists only log entries. */
const evidenceOnly = new WeakMap<Editor, boolean>();

/**
 * Opens the slash menu on log entries alone (the toolbar's Insert evidence): a `/` typed where the cursor is when it
 * starts a word in the owner's text, else in a new paragraph after the cursor's block (the entry takes its place).
 */
export function openEvidenceSearch(editor: Editor) {
  evidenceOnly.set(editor, true);
  editor.exec((state, dispatch) => {
    const sel = state.selection;
    const parent = sel.$from.parent.type.name;
    const before = sel.$from.parent.textBetween(0, sel.$from.parentOffset);
    if (sel instanceof TextSelection && sel.empty && (parent === "paragraph" || parent === "slot") && (before === "" || /\s$/.test(before))) {
      dispatch?.(triggerAutocomplete(state.tr.insertText("/")).scrollIntoView());
      return true;
    }
    const at = sel.$from.depth === 0 ? sel.from : sel.$from.after(1);
    const tr = state.tr.insert(at, state.schema.nodes.paragraph.create(null, state.schema.text("/")));
    dispatch?.(triggerAutocomplete(tr.setSelection(TextSelection.create(tr.doc, at + 2))).scrollIntoView());
    return true;
  });
  editor.focus();
}

/** `/` at a line's start or after a space, then the query: up to four words, so a sentence typed after it closes it. */
const SLASH = /(?<=^|\s)\/(\S*(?: \S*){0,3})$/u;

const ITEM =
  "grid min-h-8 cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 text-body text-fg-2 data-highlighted:bg-surface-hi data-highlighted:text-fg";

/**
 * The slash menu (ProseKit's autocomplete, Ink chrome): `/` in the page's text lists the blocks to insert, each with
 * the markdown that makes it as you type, then this target's log entries not yet on the page, fuzzy-matched on title
 * and command. ↑↓ move, ↵ inserts, Esc closes.
 */
export function SlashMenu() {
  const editor = useEditor<EditingExtension>();
  const actions = usePageActions();
  const { data, target } = useReportData();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [onlyEvidence, setOnlyEvidence] = useState(false);

  const blocks = useMemo(() => {
    if (onlyEvidence) return [];
    return BLOCK_ITEMS.map((b) => ({ b, s: fuzzyScore(query, `${b.label} ${b.keywords}`) }))
      .filter((x): x is { b: BlockItem; s: number } => x.s !== null)
      .sort((x, y) => (query ? y.s - x.s : 0))
      .map((x) => x.b);
  }, [query, onlyEvidence]);
  const entries = useMemo(() => {
    if (!open || !target || !editor.mounted) return [];
    const all = candidates(data.log, target.hostIds, editor.getDocJSON() as ReportNode);
    if (query === "") return all.slice(0, onlyEvidence ? 12 : 5);
    return all
      .map((e) => ({ e, s: fuzzyScore(query, searchText(e)) }))
      .filter((x): x is { e: LogEntry; s: number } => x.s !== null)
      .sort((x, y) => y.s - x.s)
      .slice(0, 8)
      .map((x) => x.e);
  }, [open, target, editor, data.log, query, onlyEvidence]);

  return (
    <AutocompleteRoot className="contents"
      regex={SLASH}
      filter={null}
      onQueryChange={(e) => setQuery(e.detail)}
      onOpenChange={(e) => {
        setOpen(e.detail);
        if (e.detail) setOnlyEvidence(evidenceOnly.get(editor) ?? false);
        else evidenceOnly.delete(editor);
      }}
    >
      <AutocompletePositioner className="z-30 block data-[state=closed]:hidden [&:not([data-state])]:hidden">
        <AutocompletePopup
          aria-label="Insert"
          className="grid max-h-96 w-80 content-start gap-1 overflow-y-auto rounded-md border border-line-strong bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,.6)]"
        >
          <AutocompleteEmpty className="px-2 py-2 text-meta text-muted-2">
            {onlyEvidence ? "Nothing logged on this target matches." : "Nothing matches. Esc to close."}
          </AutocompleteEmpty>
          {blocks.map((b) => (
            <AutocompleteItem key={b.id} value={b.id} className={ITEM} onSelect={() => b.run(editor, actions)}>
              <b.icon size={16} aria-hidden />
              <span className="truncate">{b.label}</span>
              {b.markdown ? <span className="font-mono text-code text-muted">{b.markdown}</span> : <span />}
            </AutocompleteItem>
          ))}
          {entries.length > 0 && (
            <div role="presentation" className={cx(labelClass, "px-2 pt-2 pb-1")}>
              {query ? "From the log" : "Latest from the log"}
            </div>
          )}
          {entries.map((e) => {
            const command = e.content.kind === "command" ? e.content.blocks[0]?.command : undefined;
            return (
              <AutocompleteItem
                key={e.id}
                value={`entry:${e.id}`}
                className="grid min-h-11 cursor-default grid-cols-[40px_minmax(0,1fr)] items-start gap-3 rounded-sm px-2 py-1 data-highlighted:bg-surface-hi"
                onSelect={() => placeEntry(editor, e)}
              >
                <span className="font-mono text-code text-muted tabular-nums">{clock(e.at)}</span>
                <span className="grid min-w-0 gap-1">
                  <span className="truncate text-body text-fg" title={e.title}>
                    {e.title}
                  </span>
                  <span className="truncate text-meta text-muted-2">{command ? <span className="font-mono text-code">{command}</span> : KIND_LABELS[e.kind]}</span>
                </span>
              </AutocompleteItem>
            );
          })}
        </AutocompletePopup>
      </AutocompletePositioner>
    </AutocompleteRoot>
  );
}
