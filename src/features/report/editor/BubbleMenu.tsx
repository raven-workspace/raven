import {
  Code,
  Copy,
  HighlighterCircle,
  Link,
  LinkBreak,
  PencilSimple,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
  type Icon,
} from "@phosphor-icons/react";
import { InlinePopoverPopup, InlinePopoverPositioner, InlinePopoverRoot } from "prosekit/react/inline-popover";
import { Priority } from "prosekit/core";
import { TextSelection } from "prosekit/pm/state";
import { useEditor, useKeymap } from "prosekit/react";
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { copyPlain } from "../../../lib/clipboard";
import { IconButton, Input, Toolbar } from "../../../ui";
import { applyLink, blockKindAt, inPageHeading, linkAt, toggleHeading, type PageEditor } from "./commands";
import type { EditingExtension } from "./extension";

export interface MarkTool {
  icon: Icon;
  label: string;
  shortcut: string;
  run(editor: PageEditor): void;
  active(editor: PageEditor): boolean;
}

/** The text marks, in the order the bubble menu and the toolbar show them. */
export const TEXT_MARKS: MarkTool[] = [
  { icon: TextB, label: "Bold", shortcut: "⌘B", run: (e) => e.commands.toggleBold(), active: (e) => e.marks.bold.isActive() },
  { icon: TextItalic, label: "Italic", shortcut: "⌘I", run: (e) => e.commands.toggleItalic(), active: (e) => e.marks.italic.isActive() },
  {
    icon: TextUnderline,
    label: "Underline",
    shortcut: "⌘U",
    run: (e) => e.commands.toggleUnderline(),
    active: (e) => e.marks.underline.isActive(),
  },
  {
    icon: TextStrikethrough,
    label: "Strikethrough",
    shortcut: "⌘⇧S",
    run: (e) => e.commands.toggleStrike(),
    active: (e) => e.marks.strike.isActive(),
  },
  { icon: Code, label: "Inline code", shortcut: "⌘E", run: (e) => e.commands.toggleCode(), active: (e) => e.marks.code.isActive() },
  {
    icon: HighlighterCircle,
    label: "Highlight",
    shortcut: "⌘⇧H",
    run: (e) => e.commands.toggleHighlight(),
    active: (e) => e.marks.highlight.isActive(),
  },
];

/** A link on the page: its element (the popover's anchor) and address. */
interface LinkHere {
  el: HTMLElement;
  href: string;
}

/** The link the cursor sits in with nothing selected, if any. */
function linkUnderCursor(editor: PageEditor): LinkHere | null {
  const sel = editor.state.selection;
  const href = linkAt(editor);
  if (!sel.empty || href === "") return null;
  const at = editor.view.domAtPos(sel.from);
  const node = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : (at.node as HTMLElement);
  const el = node?.closest("a");
  return el ? { el, href } : null;
}

/** The owner's headings, one click each; the same button again turns the line back into a paragraph. */
export const HEADING_TOOLS: MarkTool[] = (
  [
    [TextHOne, "h1", "Heading 1", "⌥⌘1"],
    [TextHTwo, "h2", "Heading 2", "⌥⌘2"],
    [TextHThree, "h3", "Heading 3", "⌥⌘3"],
  ] as const
).map(([icon, kind, label, shortcut]) => ({
  icon,
  label,
  shortcut,
  run: (e) => toggleHeading(e, kind),
  active: (e) => blockKindAt(e) === kind,
}));

/** Buttons keep the page's focus and selection: the press runs on the selection the owner made. */
export const keepFocus = (e: MouseEvent) => e.preventDefault();

const POPUP = "grid rounded-md border border-line-strong bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,.6)]";
const POSITIONER = "z-30 block data-[state=closed]:hidden [&:not([data-state])]:hidden";

/** The link address field: Enter applies (empty unlinks), Esc goes back to the page. */
function LinkField({ initial, onDone }: { initial: string; onDone(href: string | null): void }) {
  const [href, setHref] = useState(initial);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone(href.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone(null);
    }
  };
  return (
    <Input
      autoFocus
      mono
      width="w-80"
      aria-label="Link address"
      placeholder="https://… then ↵, empty to unlink"
      value={href}
      onChange={(e) => setHref(e.target.value)}
      onKeyDown={onKey}
    />
  );
}

/**
 * The bubble menu over a text selection (ProseKit's inline popover, Ink chrome): the text marks and Link. Link swaps the
 * marks for the address field in place. With the cursor in a link and nothing selected, a second popover shows the
 * address with Edit, Copy and Remove.
 */
export function BubbleMenu() {
  const editor = useEditor<EditingExtension>({ update: true });
  const [editing, setEditing] = useState(false);
  // The link whose address is being edited: kept while its field has focus, wherever the page's cursor is.
  const [pinned, setPinned] = useState<LinkHere | null>(null);

  const done = (href: string | null) => {
    if (href !== null) applyLink(editor, href);
    setEditing(false);
    editor.focus();
  };

  const href = editor.mounted ? linkAt(editor) : "";
  // While the page has focus: the popover is about where the owner is typing.
  const link = pinned ?? (editor.mounted && editor.view.hasFocus() ? linkUnderCursor(editor) : null);

  // ⌘⇧K edits the selection's link in the bubble, or the link the cursor is in; elsewhere the toolbar's field takes it.
  const keymap = useMemo(
    () => ({
      "Mod-Shift-k": () => {
        const { selection } = editor.state;
        if (!(selection instanceof TextSelection)) return false;
        if (!selection.empty) {
          setEditing(true);
          return true;
        }
        const here = linkUnderCursor(editor);
        if (!here) return false;
        setPinned(here);
        return true;
      },
    }),
    [editor],
  );
  useKeymap(keymap, { priority: Priority.high });

  return (
    <>
      <InlinePopoverRoot
        className="contents"
        onOpenChange={(e) => {
          if (!e.detail) setEditing(false);
        }}
      >
        <InlinePopoverPositioner placement="top" className={POSITIONER}>
          <InlinePopoverPopup aria-label="Text formatting" className={POPUP}>
            {editing ? (
              <LinkField initial={href} onDone={done} />
            ) : (
              <Toolbar gap={2}>
                {TEXT_MARKS.map((t) => (
                  <IconButton
                    key={t.label}
                    icon={t.icon}
                    label={t.label}
                    shortcut={t.shortcut}
                    active={editor.mounted ? t.active(editor) : false}
                    onMouseDown={keepFocus}
                    onClick={() => t.run(editor)}
                  />
                ))}
                <IconButton
                  icon={Link}
                  label="Link"
                  shortcut="⌘⇧K"
                  active={href !== ""}
                  onMouseDown={keepFocus}
                  onClick={() => setEditing(true)}
                />
                {editor.mounted && !inPageHeading(editor) && (
                  <>
                    <span aria-hidden className="mx-1 h-5 w-px bg-line-2" />
                    {HEADING_TOOLS.map((t) => (
                      <IconButton
                        key={t.label}
                        icon={t.icon}
                        label={t.label}
                        shortcut={t.shortcut}
                        active={t.active(editor)}
                        onMouseDown={keepFocus}
                        onClick={() => t.run(editor)}
                      />
                    ))}
                  </>
                )}
              </Toolbar>
            )}
          </InlinePopoverPopup>
        </InlinePopoverPositioner>
      </InlinePopoverRoot>
      {link && <LinkPopover anchor={link.el} href={link.href} editing={pinned !== null} onEditing={(on) => setPinned(on ? link : null)} />}
    </>
  );
}

/** The link the cursor is in: its address, then Edit (the field in place), Copy and Remove. */
function LinkPopover({ anchor, href, editing, onEditing }: { anchor: HTMLElement; href: string; editing: boolean; onEditing(on: boolean): void }) {
  const editor = useEditor<EditingExtension>();
  const done = (next: string | null) => {
    if (next !== null) {
      // Back in the link first: the field took the cursor out of the page.
      editor.focus();
      applyLink(editor, next);
    }
    onEditing(false);
    editor.focus();
  };
  return (
    <InlinePopoverRoot className="contents" anchor={anchor} open>
      <InlinePopoverPositioner placement="bottom-start" offset={4} className={POSITIONER}>
        <InlinePopoverPopup aria-label="Link here" className={POPUP}>
          {editing ? (
            <LinkField initial={href} onDone={done} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pl-2">
              <span className="max-w-80 truncate font-mono text-code text-fg-2" title={href}>
                {href}
              </span>
              <Toolbar gap={2}>
                <IconButton icon={PencilSimple} label="Edit link" shortcut="⌘⇧K" onMouseDown={keepFocus} onClick={() => onEditing(true)} />
                <IconButton icon={Copy} label="Copy link" onMouseDown={keepFocus} onClick={() => void copyPlain(href)} />
                <IconButton
                  icon={LinkBreak}
                  label="Remove link"
                  onMouseDown={keepFocus}
                  onClick={() => {
                    applyLink(editor, "");
                    editor.focus();
                  }}
                />
              </Toolbar>
            </div>
          )}
        </InlinePopoverPopup>
      </InlinePopoverPositioner>
    </InlinePopoverRoot>
  );
}
