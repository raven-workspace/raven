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
import { useEffect, useMemo, useRef, useState } from "react";
import { entryIdsIn, type ReportNode } from "../../../engines/report";
import type { LogEntry } from "../../../types/log";
import { cx } from "../../../lib/cx";
import { labelClass } from "../../../ui";
import { KIND_LABELS } from "../../log/kindLabels";
import { inPageHeading, insertTable, setBlockKind, type PageEditor } from "./commands";
import type { EditingExtension } from "./extension";
import { insertEntry, usePageActions } from "./pageActions";
import { usePageContext } from "./ReportDataContext";

interface BlockItem {
  id: string;
  icon: Icon;
  label: string;
  /** Words it also answers to. */
  keywords: string;
  /** The markdown that makes it as you type, shown as the hint. */
  markdown?: string;
  /** It changes the line it's typed in (a heading, a list), so it is left out in the page's numbered headings. */
  retypes?: boolean;
  run(editor: PageEditor, actions: ReturnType<typeof usePageActions>): void;
}

const BLOCK_ITEMS: BlockItem[] = [
  { id: "paragraph", retypes: true, icon: TextT, label: "Paragraph", keywords: "text plain", run: (e) => setBlockKind(e, "paragraph") },
  { id: "h1", retypes: true, icon: TextHOne, label: "Heading 1", keywords: "title section", markdown: "#", run: (e) => setBlockKind(e, "h1") },
  { id: "h2", retypes: true, icon: TextHTwo, label: "Heading 2", keywords: "title subsection", markdown: "##", run: (e) => setBlockKind(e, "h2") },
  { id: "h3", retypes: true, icon: TextHThree, label: "Heading 3", keywords: "title subheading", markdown: "###", run: (e) => setBlockKind(e, "h3") },
  { id: "bullet", retypes: true, icon: ListBullets, label: "Bulleted list", keywords: "unordered ul", markdown: "-", run: (e) => e.commands.wrapInList({ kind: "bullet" }) },
  { id: "ordered", retypes: true, icon: ListNumbers, label: "Numbered list", keywords: "ordered ol steps", markdown: "1.", run: (e) => e.commands.wrapInList({ kind: "ordered" }) },
  { id: "task", retypes: true, icon: CheckSquare, label: "Task list", keywords: "todo checkbox", markdown: "[ ]", run: (e) => e.commands.wrapInList({ kind: "task" }) },
  { id: "quote", retypes: true, icon: Quotes, label: "Quote", keywords: "blockquote", markdown: ">", run: (e) => setBlockKind(e, "quote") },
  { id: "code", retypes: true, icon: CodeBlock, label: "Code block", keywords: "pre snippet", markdown: "```", run: (e) => setBlockKind(e, "code") },
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
  const onPage = entryIdsIn(doc);
  return log
    .filter((e) => !e.private && !onPage.has(e.id) && e.hostIds.some((h) => hostIds.includes(h)))
    .sort((a, b) => b.at - a.at || b.createdAt - a.createdAt);
}

const searchText = (e: LogEntry) =>
  `${e.title} ${e.content.kind === "command" ? e.content.blocks.map((b) => b.command).join(" ") : e.content.kind === "note" ? e.content.text : ""}`;

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: number) => `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`;

/** What opening the evidence picker from the toolbar put on the page: where its `/` is and whether it added a
 *  paragraph for it, so closing without a pick takes them away again. */
interface Opened {
  slash: number;
  newParagraph: boolean;
}

/** Pages in "evidence only" mode (opened from the toolbar's Insert evidence): the menu lists only log entries. */
const evidenceOnly = new WeakMap<Editor, Opened>();

/**
 * Opens the slash menu on log entries alone (the toolbar's Insert evidence): a `/` in the empty line the cursor is in,
 * else in a new paragraph after the cursor's block (the entry takes its place). Closing without a pick removes them.
 */
export function openEvidenceSearch(editor: Editor) {
  editor.exec((state, dispatch) => {
    const sel = state.selection;
    const parent = sel.$from.parent;
    if (sel instanceof TextSelection && sel.empty && parent.type.name === "paragraph" && parent.content.size === 0) {
      evidenceOnly.set(editor, { slash: sel.from, newParagraph: false });
      dispatch?.(triggerAutocomplete(state.tr.insertText("/")).scrollIntoView());
      return true;
    }
    const at = sel.$from.depth === 0 ? sel.from : sel.$from.after(1);
    evidenceOnly.set(editor, { slash: at + 1, newParagraph: true });
    const tr = state.tr.insert(at, state.schema.nodes.paragraph.create(null, state.schema.text("/")));
    dispatch?.(triggerAutocomplete(tr.setSelection(TextSelection.create(tr.doc, at + 2))).scrollIntoView());
    return true;
  });
  editor.focus();
}

/** Takes away what `openEvidenceSearch` put on the page (the `/`, what was typed after it, the paragraph it added). */
function undoOpened(editor: Editor, opened: Opened) {
  editor.exec((state, dispatch) => {
    const $slash = state.doc.resolve(Math.min(opened.slash, state.doc.content.size));
    const block = $slash.parent;
    if (!block.isTextblock || !block.textContent.startsWith("/")) return false;
    if (dispatch) {
      const from = $slash.start();
      const tr = opened.newParagraph ? state.tr.delete($slash.before(), $slash.after()) : state.tr.delete(from, from + block.content.size);
      dispatch(tr.setMeta("addToHistory", false));
    }
    return true;
  });
}

/**
 * `/` at the very start of a line, then the query: letters, digits and dashes, up to four words. A path or address
 * ("/etc/passwd", "/admin.php") or a `/` mid-sentence never opens it.
 */
const SLASH = /^\/([^\s/.]*(?: [^\s/.]*){0,3})$/u;
/** The query as typed, after the `/`. */
const rawQuery = (match: RegExpExecArray) => match[1] ?? "";

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well a block item matches the query: every word of the query must start a word of its label, id or keywords
 * (its aliases), never a loose subsequence, so "/etc" is not "Heading 1" (h-e-a-d… t-itle s-e-c-tion). Higher is
 * better: the label's first word, then any label word, then an alias. Null is no match.
 */
export function blockScore(query: string, item: { id: string; label: string; keywords: string }): number | null {
  const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (q.length === 0) return 0;
  const label = words(item.label);
  const all = [...label, item.id.toLowerCase(), ...words(item.keywords)];
  if (!q.every((w) => all.some((h) => h.startsWith(w)))) return null;
  const first = q[0];
  return label[0]?.startsWith(first) ? 3 : label.some((h) => h.startsWith(first)) ? 2 : 1;
}

/** Whether every word after the first is the start of some word in `text`: a sentence typed after `/x` doesn't match. */
function laterWordsMatch(query: string, text: string): boolean {
  const [, ...rest] = query.trim().toLowerCase().split(/\s+/);
  const have = words(text);
  return rest.every((w) => have.some((h) => h.startsWith(w)));
}

const ITEM =
  "grid min-h-8 cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 text-body text-fg-2 data-highlighted:bg-surface-hi data-highlighted:text-fg";

/**
 * The slash menu (ProseKit's autocomplete, Ink chrome): `/` at the start of a line lists the blocks to insert, each
 * with the markdown that makes it as you type (matched by the start of a label word or alias), then this target's log
 * entries not yet on the page, fuzzy-matched on title and command. A log entry is never the item ↵ takes on its own unless the query (3 characters or more) starts
 * its title: otherwise the first item keeps what was typed as text. ↑↓ move, ↵ inserts, Esc closes.
 */
export function SlashMenu() {
  const editor = useEditor<EditingExtension>();
  const actions = usePageActions();
  const { data, target, reportMeta } = usePageContext();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  const picked = useRef(false);
  // The query as last typed: the menu's own query is cleared as it closes, before a pick runs.
  const typed = useRef("");
  const wasOpen = useRef(false);

  const structural = open && editor.mounted && inPageHeading(editor);
  const blocks = useMemo(() => {
    if (onlyEvidence) return [];
    return BLOCK_ITEMS.filter((b) => !(structural && b.retypes))
      .map((b) => ({ b, s: blockScore(query, b) }))
      .filter((x): x is { b: BlockItem; s: number } => x.s !== null)
      .sort((x, y) => (query ? y.s - x.s : 0))
      .map((x) => x.b);
  }, [query, onlyEvidence, structural]);
  const entries = useMemo(() => {
    if (!open || !target || !editor.mounted) return [];
    const all = candidates(data.log, target.hostIds, editor.getDocJSON() as ReportNode);
    if (query.trim() === "") return all.slice(0, onlyEvidence ? 12 : 5);
    return all
      .map((e) => ({ e, s: fuzzyScore(query, searchText(e)) }))
      .filter((x): x is { e: LogEntry; s: number } => x.s !== null && laterWordsMatch(query, searchText(x.e)))
      .sort((x, y) => y.s - x.s)
      .slice(0, 8)
      .map((x) => x.e);
  }, [open, target, editor, data.log, query, onlyEvidence]);

  const q = query.trim().toLowerCase();
  // ↵ takes the first item: a log entry only when the owner has clearly named it.
  const entryFirstOk = onlyEvidence || (q.length >= 3 && entries.length > 0 && entries[0].title.toLowerCase().startsWith(q));
  const keepFirst = !onlyEvidence && blocks.length === 0 && entries.length > 0 && !entryFirstOk;
  // A second word that starts nothing listed: the owner is writing a sentence, so the menu steps aside.
  const nothing = blocks.length === 0 && entries.length === 0;
  useEffect(() => {
    if (open && nothing && q.includes(" ") && editor.mounted)
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: false, cancelable: true }));
  }, [open, nothing, q, editor]);

  return (
    <AutocompleteRoot
      className="contents"
      regex={SLASH}
      filter={null}
      queryBuilder={rawQuery}
      onQueryChange={(e) => {
        if (e.detail !== "") typed.current = e.detail;
        setQuery(e.detail);
      }}
      onOpenChange={(e) => {
        // Fired on every keystroke while open: only a real opening starts afresh.
        if (e.detail === wasOpen.current) return;
        wasOpen.current = e.detail;
        setOpen(e.detail);
        if (e.detail) {
          picked.current = false;
          setOnlyEvidence(evidenceOnly.has(editor));
          return;
        }
        const opened = evidenceOnly.get(editor);
        evidenceOnly.delete(editor);
        if (opened && !picked.current) undoOpened(editor, opened);
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
          {keepFirst && (
            <AutocompleteItem
              value="keep-text"
              className={ITEM}
              onSelect={() => {
                // The pick took the typed `/query` away: put it back as text.
                picked.current = true;
                editor.exec((state, dispatch) => {
                  dispatch?.(state.tr.insertText(`/${typed.current}`));
                  return true;
                });
              }}
            >
              <TextT size={16} aria-hidden />
              <span className="truncate">{`Keep “/${query}” as text`}</span>
              <span />
            </AutocompleteItem>
          )}
          {blocks.map((b) => (
            <AutocompleteItem
              key={b.id}
              value={b.id}
              className={ITEM}
              onSelect={() => {
                picked.current = true;
                b.run(editor, actions);
              }}
            >
              <b.icon size={16} aria-hidden />
              <span className="truncate">{b.label}</span>
              {b.markdown ? <span className="font-mono text-code text-muted">{b.markdown}</span> : <span />}
            </AutocompleteItem>
          ))}
          {entries.length > 0 && (
            <div role="presentation" className={cx(labelClass, "px-2 pt-2 pb-1")}>
              {q ? "From the log" : "Latest from the log"}
            </div>
          )}
          {entries.map((e) => {
            const command = e.content.kind === "command" ? e.content.blocks[0]?.command : undefined;
            return (
              <AutocompleteItem
                key={e.id}
                value={`entry:${e.id}`}
                className="grid min-h-11 cursor-default grid-cols-[40px_minmax(0,1fr)] items-start gap-3 rounded-sm px-2 py-1 data-highlighted:bg-surface-hi"
                onSelect={() => {
                  picked.current = true;
                  if (target) insertEntry(editor, data, target, e, true, reportMeta);
                }}
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
