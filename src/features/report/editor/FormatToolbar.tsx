import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CheckSquare,
  DotsThree,
  FileMagnifyingGlass,
  Image,
  Link,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  Minus,
  Table,
  TextSubscript,
  TextSuperscript,
} from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Priority } from "prosekit/core";
import { NodeSelection } from "prosekit/pm/state";
import { useEditor, useKeymap } from "prosekit/react";
import { cx } from "../../../lib/cx";
import { IconButton, Input, Select, Toolbar } from "../../../ui";
import { HEADING_TOOLS, keepFocus, TEXT_MARKS, type MarkTool } from "./BubbleMenu";
import { applyLink, BLOCK_KINDS, blockKindAt, inPageHeading, insertTable, linkAt, setBlockKind, type BlockKind, type PageEditor } from "./commands";
import type { EditingExtension } from "./extension";
import { fromPicker, LANGUAGE_OPTIONS, toPicker } from "./nodes/CodeBlockView";
import { usePageActions } from "./pageActions";
import { openEvidenceSearch } from "./SlashMenu";

const SCRIPTS: MarkTool[] = [
  {
    icon: TextSubscript,
    label: "Subscript",
    shortcut: "⌘,",
    run: (e) => e.commands.toggleSubscript(),
    active: (e) => e.marks.subscript.isActive(),
  },
  {
    icon: TextSuperscript,
    label: "Superscript",
    shortcut: "⌘.",
    run: (e) => e.commands.toggleSuperscript(),
    active: (e) => e.marks.superscript.isActive(),
  },
];

const LISTS: { icon: MarkTool["icon"]; label: string; shortcut: string; kind: "bullet" | "ordered" | "task" }[] = [
  { icon: ListBullets, label: "Bulleted list", shortcut: "- ", kind: "bullet" },
  { icon: ListNumbers, label: "Numbered list", shortcut: "1. ", kind: "ordered" },
  { icon: CheckSquare, label: "Task list", shortcut: "[ ] ", kind: "task" },
];

/** The select's label for where the cursor is, when it isn't one of the block types it sets. */
const OTHER = "other";

/**
 * The bar pinned to the top of the page pane (Ink chrome, not paper), in groups: block type (and a code block's
 * language) | marks | lists | insert (table, image, divider, evidence) | find | undo, redo; the page's own action
 * (`end`, Add new evidence) at the right. Controls act on the page's selection and disable themselves where they don't
 * apply. The page's own headings are structural: they never change type, become lists or take a code block.
 * The find bar, when open, is the bar's second row.
 */
export function FormatToolbar({
  end,
  className,
  findBar,
  onFind,
}: {
  end?: ReactNode;
  className?: string;
  /** The find bar, shown under the controls while open. */
  findBar?: ReactNode;
  onFind(): void;
}) {
  const editor = useEditor<EditingExtension>({ update: true });
  const actions = usePageActions();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = editor.mounted;
  const block = ready && editor.state.selection instanceof NodeSelection;
  const pageHeading = ready && inPageHeading(editor);
  const kind: BlockKind | null = ready ? blockKindAt(editor) : null;
  const inCode = kind === "code";

  const openLink = () => {
    setHref(linkAt(editor));
    setLinkOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const closeLink = () => {
    setLinkOpen(false);
    editor.focus();
  };
  // ⌘⇧K with nothing selected and no link under the cursor: the address goes in here (the bubble menu takes the rest).
  const keymap = useMemo(
    () => ({
      "Mod-Shift-k": () => {
        if (editor.state.selection instanceof NodeSelection) return false;
        openLink();
        return true;
      },
    }),
    // openLink only reads the editor and sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );
  useKeymap(keymap, { priority: Priority.default });

  const run = (fn: (e: PageEditor) => void) => () => {
    fn(editor);
    editor.focus();
  };
  const mark = (t: MarkTool, off: boolean) => (
    <IconButton
      key={t.label}
      icon={t.icon}
      label={t.label}
      shortcut={t.shortcut}
      disabled={!ready || off}
      active={ready && !off ? t.active(editor) : false}
      onMouseDown={keepFocus}
      onClick={run(t.run)}
    />
  );
  const marksOff = block || inCode;
  // The room the groups have: the bar's width less the page's own action. Unknown until measured (all shown).
  const roomRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = roomRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setRoom(w > 0 ? w : null);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const onLinkKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyLink(editor, href.trim());
      closeLink();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeLink();
    }
  };

  const blockLabel = ready && pageHeading ? "Heading" : "Text";
  const markBy = (label: string) => [...TEXT_MARKS, ...SCRIPTS].find((t) => t.label === label)!;
  const headingOff = block || inCode || pageHeading;
  const listOff = !ready || block || pageHeading || inCode;
  const list = (l: (typeof LISTS)[number]) => (
    <IconButton
      key={l.kind}
      icon={l.icon}
      label={l.label}
      shortcut={l.shortcut}
      disabled={listOff}
      active={ready && !listOff && editor.nodes.list.isActive({ kind: l.kind })}
      onMouseDown={keepFocus}
      onClick={run((e) => e.commands.toggleList({ kind: l.kind }))}
    />
  );
  // Every control, in the bar's order (grouped), with how long it holds its place as the pane narrows: the highest
  // priority folds into More last. Bold, Italic, Inline code, Link, the headings, the two lists and Undo/Redo stay at a
  // 760px pane; sub- and superscript, strikethrough, underline, highlight, the block type, divider, table, image and
  // find fold first.
  const items: Item[] = [
    {
      id: "block",
      group: "block",
      priority: 30,
      // Measured with the code language picker in, always: the bar doesn't re-fold as the cursor enters a code block.
      width: 128 + 8 + 128,
      node: (
        <Fragment key="block">
          <Select
            aria-label="Block type"
            className="h-7 w-32"
            disabled={!ready || kind === null}
            // Where the cursor isn't in a block it sets (a selected block, a numbered page heading), the select names
            // what is there and stays off.
            options={kind === null ? [{ value: OTHER, label: blockLabel }] : BLOCK_KINDS.map((b) => ({ value: b.value, label: b.label }))}
            value={kind ?? OTHER}
            onValueChange={(v) => {
              setBlockKind(editor, v as BlockKind);
              editor.focus();
            }}
          />
          {inCode && (
            <Select
              aria-label="Code language"
              className="h-7 w-32"
              options={LANGUAGE_OPTIONS}
              value={toPicker((editor.state.selection.$from.parent.attrs.language as string) ?? "")}
              onValueChange={(v) => {
                editor.commands.setCodeBlockAttrs({ language: fromPicker(v) });
                editor.focus();
              }}
            />
          )}
        </Fragment>
      ),
    },
    ...HEADING_TOOLS.map((t, i): Item => ({ id: t.label, group: "headings", priority: 96 - i, width: 28, node: mark(t, headingOff) })),
    { id: "Bold", group: "marks", priority: 100, width: 28, node: mark(markBy("Bold"), marksOff) },
    { id: "Italic", group: "marks", priority: 99, width: 28, node: mark(markBy("Italic"), marksOff) },
    { id: "Underline", group: "marks", priority: 20, width: 28, node: mark(markBy("Underline"), marksOff) },
    { id: "Strikethrough", group: "marks", priority: 15, width: 28, node: mark(markBy("Strikethrough"), marksOff) },
    { id: "Inline code", group: "marks", priority: 98, width: 28, node: mark(markBy("Inline code"), marksOff) },
    { id: "Highlight", group: "marks", priority: 25, width: 28, node: mark(markBy("Highlight"), marksOff) },
    { id: "Subscript", group: "marks", priority: 10, width: 28, node: mark(markBy("Subscript"), marksOff) },
    { id: "Superscript", group: "marks", priority: 10, width: 28, node: mark(markBy("Superscript"), marksOff) },
    {
      id: "Link",
      group: "marks",
      priority: 97,
      width: 28,
      node: (
        <IconButton
          key="link"
          icon={Link}
          label="Link"
          shortcut="⌘⇧K"
          disabled={!ready || marksOff}
          active={linkOpen || (ready && !marksOff && linkAt(editor) !== "")}
          onMouseDown={keepFocus}
          onClick={() => (linkOpen ? closeLink() : openLink())}
        />
      ),
    },
    { id: "bullet", group: "lists", priority: 93, width: 28, node: list(LISTS[0]) },
    { id: "ordered", group: "lists", priority: 92, width: 28, node: list(LISTS[1]) },
    { id: "task", group: "lists", priority: 55, width: 28, node: list(LISTS[2]) },
    {
      id: "table",
      group: "insert",
      priority: 40,
      width: 28,
      node: <IconButton key="table" icon={Table} label="Insert table" disabled={!ready} onMouseDown={keepFocus} onClick={run(insertTable)} />,
    },
    {
      id: "image",
      group: "insert",
      priority: 45,
      width: 28,
      node: <IconButton key="image" icon={Image} label="Insert image" shortcut="⌘V" disabled={!ready} onMouseDown={keepFocus} onClick={() => actions.pickImage()} />,
    },
    {
      id: "divider",
      group: "insert",
      priority: 35,
      width: 28,
      node: (
        <IconButton
          key="divider"
          icon={Minus}
          label="Insert divider"
          shortcut="---"
          disabled={!ready}
          onMouseDown={keepFocus}
          onClick={run((e) => e.commands.insertHorizontalRule())}
        />
      ),
    },
    {
      id: "evidence",
      group: "insert",
      priority: 60,
      width: 28,
      node: (
        <IconButton
          key="evidence"
          icon={FileMagnifyingGlass}
          label="Insert evidence"
          shortcut="/"
          disabled={!ready}
          onMouseDown={keepFocus}
          onClick={() => openEvidenceSearch(editor)}
        />
      ),
    },
    {
      id: "find",
      group: "find",
      priority: 50,
      width: 28,
      node: <IconButton key="find" icon={MagnifyingGlass} label="Find and replace" shortcut="⌘F" disabled={!ready} onClick={onFind} />,
    },
    {
      id: "undo",
      group: "history",
      priority: 91,
      width: 28,
      node: (
        <IconButton
          key="undo"
          icon={ArrowCounterClockwise}
          label="Undo"
          shortcut="⌘Z"
          disabled={!ready || !editor.commands.undo.canExec()}
          onMouseDown={keepFocus}
          onClick={() => editor.commands.undo()}
        />
      ),
    },
    {
      id: "redo",
      group: "history",
      priority: 91,
      width: 28,
      node: (
        <IconButton
          key="redo"
          icon={ArrowClockwise}
          label="Redo"
          shortcut="⇧⌘Z"
          disabled={!ready || !editor.commands.redo.canExec()}
          onMouseDown={keepFocus}
          onClick={() => editor.commands.redo()}
        />
      ),
    },
  ];
  const { inline, more } = fitItems(items, room);

  return (
    // The pane's 24px top padding is part of the sticky inset, so -top-6 pins the bar to the pane's very top edge.
    <div className={cx("sticky -top-6 z-20 -mx-6 grid border-b border-line bg-bg px-6", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-1">
        {/* The row the groups share: the ones that fit, in order of use, then More with the rest (narrow panes). */}
        <div ref={roomRef} role="toolbar" aria-label="Formatting" className="grid grid-flow-col items-center justify-start gap-4">
          {inline.map((g) => (
            <Toolbar key={g.group}>{g.items.map((i) => i.node)}</Toolbar>
          ))}
          {more.length > 0 && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <IconButton icon={DotsThree} label="More formatting" disabled={!ready} />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="start"
                  sideOffset={4}
                  aria-label="More formatting"
                  className="z-50 grid gap-2 rounded-md border border-line-strong bg-surface p-2 shadow-[0_12px_32px_rgba(0,0,0,.6)]"
                >
                  {more.map((g) => (
                    <Toolbar key={g.group}>{g.items.map((i) => i.node)}</Toolbar>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
        {end}
      </div>
      {linkOpen && (
        <div className="grid grid-cols-[minmax(0,320px)] border-t border-line py-1">
          <Input
            ref={inputRef}
            mono
            aria-label="Link address"
            placeholder="https://… then ↵, empty to unlink"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={onLinkKey}
            onBlur={() => setLinkOpen(false)}
          />
        </div>
      )}
      {findBar}
    </div>
  );
}

/** One control of the bar: its group, how long it holds its place (higher folds later) and its width in px. */
interface Item {
  id: string;
  group: string;
  priority: number;
  width: number;
  node: ReactNode;
}

interface ItemGroup {
  group: string;
  items: Item[];
}

/** Gaps: 8px between a group's controls, 16px between groups. */
const GAP_IN = 8;
const GAP_GROUP = 16;
/** The More button and the gap before it. */
const MORE = GAP_GROUP + 28;

/** Items in bar order, grouped (a group's items stay together, in order). */
function grouped(items: Item[]): ItemGroup[] {
  const out: ItemGroup[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last?.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

/** How wide a set of groups lays out. */
const widthOf = (groups: ItemGroup[]) =>
  groups.reduce((n, g, i) => n + (i > 0 ? GAP_GROUP : 0) + g.items.reduce((w, it, j) => w + (j > 0 ? GAP_IN : 0) + it.width, 0), 0);

/**
 * The controls that fit `room` (px), the rest for More: the lowest priority folds first, until what is left (and More)
 * fits. Unmeasured (null) room fits everything. Both keep the bar's order and grouping.
 */
export function fitItems(items: Item[], room: number | null): { inline: ItemGroup[]; more: ItemGroup[] } {
  if (room === null || widthOf(grouped(items)) <= room) return { inline: grouped(items), more: [] };
  const folded = new Set<Item>();
  const byPriority = [...items].sort((a, b) => a.priority - b.priority);
  for (const item of byPriority) {
    if (widthOf(grouped(items.filter((i) => !folded.has(i)))) + MORE <= room) break;
    folded.add(item);
  }
  return { inline: grouped(items.filter((i) => !folded.has(i))), more: grouped(items.filter((i) => folded.has(i))) };
}
