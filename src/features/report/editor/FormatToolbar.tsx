import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Code,
  CodeBlock,
  Link,
  ListBullets,
  ListNumbers,
  TextB,
  TextItalic,
  type Icon,
} from "@phosphor-icons/react";
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { defineBasicExtension } from "prosekit/basic";
import { Priority, type Editor } from "prosekit/core";
import { NodeSelection } from "prosekit/pm/state";
import { useEditor, useKeymap } from "prosekit/react";
import { cx } from "../../../lib/cx";
import { IconButton, Input, Toolbar } from "../../../ui";

type BasicEditor = Editor<ReturnType<typeof defineBasicExtension>>;

/** The href of the link the cursor is in, or "". */
function linkAt(editor: BasicEditor): string {
  const { $from, from, to, empty } = editor.state.selection;
  const type = editor.schema.marks.link;
  const marks = empty ? [...$from.marks()] : [];
  if (!empty) editor.state.doc.nodesBetween(from, to, (n) => void marks.push(...n.marks));
  return (marks.find((m) => m.type === type)?.attrs.href as string | undefined) ?? "";
}

/** Links the selection (or the link the cursor is in) to `href`; an empty one unlinks. With no selection, the address goes in as linked text. */
function applyLink(editor: BasicEditor, href: string) {
  const { empty } = editor.state.selection;
  const inLink = linkAt(editor) !== "";
  if (empty && inLink) editor.commands.expandLink();
  if (href === "") {
    if (inLink) editor.commands.removeLink();
    return;
  }
  if (editor.state.selection.empty) {
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr
          .insertText(href)
          .addMark(state.selection.from, state.selection.from + href.length, state.schema.marks.link.create({ href })),
      );
      return true;
    });
    return;
  }
  editor.commands.addLink({ href });
}

interface Tool {
  icon: Icon;
  label: string;
  shortcut?: string;
  run(editor: BasicEditor): void;
  active?(editor: BasicEditor): boolean;
}

const MARKS: Tool[] = [
  {
    icon: TextB,
    label: "Bold",
    shortcut: "⌘B",
    run: (e) => e.commands.toggleBold(),
    active: (e) => e.marks.bold.isActive(),
  },
  {
    icon: TextItalic,
    label: "Italic",
    shortcut: "⌘I",
    run: (e) => e.commands.toggleItalic(),
    active: (e) => e.marks.italic.isActive(),
  },
  {
    icon: Code,
    label: "Inline code",
    shortcut: "⌘E",
    run: (e) => e.commands.toggleCode(),
    active: (e) => e.marks.code.isActive(),
  },
];
const BLOCKS: Tool[] = [
  {
    icon: ListBullets,
    label: "Bulleted list",
    run: (e) => e.commands.toggleList({ kind: "bullet" }),
    active: (e) => e.nodes.list.isActive({ kind: "bullet" }),
  },
  {
    icon: ListNumbers,
    label: "Numbered list",
    run: (e) => e.commands.toggleList({ kind: "ordered" }),
    active: (e) => e.nodes.list.isActive({ kind: "ordered" }),
  },
  {
    icon: CodeBlock,
    label: "Code block",
    run: (e) => e.commands.toggleCodeBlock(),
    active: (e) => e.nodes.codeBlock.isActive(),
  },
];

/** Buttons keep the page's focus and selection: the press runs on the selection the owner made. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The bar pinned to the top of the page pane (Ink chrome, not paper): the page's formatting controls, shown once the
 * owner has put a cursor on the page, and the page's own action (`end`, Add new evidence) at the right, always shown.
 * Section headings are structural, so there is no heading control.
 */
export function FormatToolbar({ shown, end }: { shown: boolean; end?: ReactNode }) {
  const editor = useEditor<ReturnType<typeof defineBasicExtension>>({
    update: true,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const block = editor.mounted && editor.state.selection instanceof NodeSelection;

  const openLink = () => {
    setHref(linkAt(editor));
    setLinkOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const closeLink = () => {
    setLinkOpen(false);
    editor.focus();
  };
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
  useKeymap(keymap, { priority: Priority.high });

  const button = (t: Tool) => (
    <IconButton
      key={t.label}
      icon={t.icon}
      label={t.label}
      shortcut={t.shortcut}
      disabled={block}
      active={editor.mounted && !block ? (t.active?.(editor) ?? false) : false}
      onMouseDown={keepFocus}
      onClick={() => {
        t.run(editor);
        editor.focus();
      }}
    />
  );
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

  return (
    // The pane's 24px top padding is part of the sticky inset, so -top-6 pins the bar to the pane's very top edge.
    <div className="sticky -top-6 z-20 -mx-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line bg-bg px-6 py-1">
      <div
        role="toolbar"
        aria-label="Formatting"
        inert={!shown}
        className={cx("grid grid-cols-[auto_auto_auto_minmax(0,1fr)] items-center gap-4", !shown && "invisible")}
      >
        <Toolbar>
          {MARKS.map(button)}
          <IconButton
            icon={Link}
            label="Link"
            shortcut="⌘⇧K"
            disabled={block}
            active={linkOpen || (editor.mounted && !block && linkAt(editor) !== "")}
            onMouseDown={keepFocus}
            onClick={() => (linkOpen ? closeLink() : openLink())}
          />
        </Toolbar>
        <Toolbar>{BLOCKS.map(button)}</Toolbar>
        <Toolbar>
          <IconButton
            icon={ArrowCounterClockwise}
            label="Undo"
            shortcut="⌘Z"
            disabled={!editor.mounted || !editor.commands.undo.canExec()}
            onMouseDown={keepFocus}
            onClick={() => editor.commands.undo()}
          />
          <IconButton
            icon={ArrowClockwise}
            label="Redo"
            shortcut="⇧⌘Z"
            disabled={!editor.mounted || !editor.commands.redo.canExec()}
            onMouseDown={keepFocus}
            onClick={() => editor.commands.redo()}
          />
        </Toolbar>
        <div className="grid grid-cols-[minmax(0,320px)]">
          {linkOpen && (
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
          )}
        </div>
      </div>
      {end}
    </div>
  );
}
