import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  DotsSix,
  DotsSixVertical,
  Rows,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { MenuItem, MenuPopup, MenuPositioner } from "prosekit/react/menu";
import {
  TableHandleColumnMenuRoot,
  TableHandleColumnMenuTrigger,
  TableHandleColumnPopup,
  TableHandleColumnPositioner,
  TableHandleDragPreview,
  TableHandleDropIndicator,
  TableHandleRoot,
  TableHandleRowMenuRoot,
  TableHandleRowMenuTrigger,
  TableHandleRowPopup,
  TableHandleRowPositioner,
} from "prosekit/react/table-handle";
import { useEditor } from "prosekit/react";
import { cx } from "../../../lib/cx";
import { hasHeaderRow, toggleHeaderRow, type PageEditor } from "./commands";
import type { EditingExtension } from "./extension";

interface Action {
  icon: Icon;
  label: string;
  run(editor: PageEditor): void;
  tone?: "destructive";
}

const COLUMN: Action[] = [
  { icon: ArrowLeft, label: "Insert column left", run: (e) => e.commands.addTableColumnBefore() },
  { icon: ArrowRight, label: "Insert column right", run: (e) => e.commands.addTableColumnAfter() },
  { icon: Trash, label: "Delete column", run: (e) => e.commands.deleteTableColumn(), tone: "destructive" },
  { icon: Trash, label: "Delete table", run: (e) => e.commands.deleteTable(), tone: "destructive" },
];
const ROW: Action[] = [
  { icon: ArrowUp, label: "Insert row above", run: (e) => e.commands.addTableRowAbove() },
  { icon: ArrowDown, label: "Insert row below", run: (e) => e.commands.addTableRowBelow() },
  { icon: Trash, label: "Delete row", run: (e) => e.commands.deleteTableRow(), tone: "destructive" },
  { icon: Trash, label: "Delete table", run: (e) => e.commands.deleteTable(), tone: "destructive" },
];

const GRIP =
  "grid h-6 min-w-6 cursor-default place-items-center rounded-sm border border-line-strong bg-surface text-fg-2 hover:bg-surface-hi hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const MENU = "z-40 block data-[state=closed]:hidden [&:not([data-state])]:hidden";
const MENU_POPUP = "grid w-56 gap-1 rounded-md border border-line-strong bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,.6)] outline-none";
const ITEM =
  "grid min-h-8 cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-3 rounded-sm px-2 text-body text-fg-2 outline-none data-highlighted:bg-surface-hi data-highlighted:text-fg";

function Items({ actions, editor, header }: { actions: Action[]; editor: PageEditor; header?: boolean }) {
  return (
    <>
      {header && (
        <MenuItem className={ITEM} onSelect={() => editor.exec(toggleHeaderRow)}>
          <Rows size={16} aria-hidden />
          <span>{hasHeaderRow(editor) ? "No header row" : "Header row"}</span>
        </MenuItem>
      )}
      {actions.map((a) => (
        <MenuItem key={a.label} className={cx(ITEM, a.tone === "destructive" && "data-highlighted:text-warn")} onSelect={() => a.run(editor)}>
          <a.icon size={16} aria-hidden />
          <span>{a.label}</span>
        </MenuItem>
      ))}
    </>
  );
}

/**
 * Handles on the owner's tables (ProseKit's table handle, Ink chrome): hovering a cell shows a grip above its column
 * and one left of its row. Drag a grip to move the column or row; click it for its menu (insert either side, header
 * row, delete). Arrow keys move in the menu, ↵ runs, Esc closes.
 */
export function TableHandles() {
  const editor = useEditor<EditingExtension>({ update: true });
  return (
    <TableHandleRoot className="contents">
      <TableHandleDragPreview />
      <TableHandleDropIndicator className="report-table-drop" />
      <TableHandleColumnPositioner placement="top" offset={-12} className="z-20 block data-[state=closed]:hidden [&:not([data-state])]:hidden">
        <TableHandleColumnPopup className="block">
          <TableHandleColumnMenuRoot className="contents">
            <TableHandleColumnMenuTrigger aria-label="Column" className={GRIP}>
              <DotsSix size={16} aria-hidden />
            </TableHandleColumnMenuTrigger>
            <MenuPositioner className={MENU}>
              <MenuPopup aria-label="Column" className={MENU_POPUP}>
                <Items actions={COLUMN} editor={editor} />
              </MenuPopup>
            </MenuPositioner>
          </TableHandleColumnMenuRoot>
        </TableHandleColumnPopup>
      </TableHandleColumnPositioner>
      <TableHandleRowPositioner placement="left" offset={-12} className="z-20 block data-[state=closed]:hidden [&:not([data-state])]:hidden">
        <TableHandleRowPopup className="block">
          <TableHandleRowMenuRoot className="contents">
            <TableHandleRowMenuTrigger aria-label="Row" className={GRIP}>
              <DotsSixVertical size={16} aria-hidden />
            </TableHandleRowMenuTrigger>
            <MenuPositioner className={MENU}>
              <MenuPopup aria-label="Row" className={MENU_POPUP}>
                <Items actions={ROW} editor={editor} header />
              </MenuPopup>
            </MenuPositioner>
          </TableHandleRowMenuRoot>
        </TableHandleRowPopup>
      </TableHandleRowPositioner>
    </TableHandleRoot>
  );
}
