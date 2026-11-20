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
import { cx } from "../../../../lib/cx";
import { hasHeaderRow, toggleHeaderRow, type PageEditor } from "../commands";
import type { EditingExtension } from "../extension";
import "./TableHandles.scss";

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

const GRIP = "table-handles__grip";
const MENU = "table-handles__menu-positioner";
const MENU_POPUP = "table-handles__menu";
const ITEM = "table-handles__item";

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
        <MenuItem key={a.label} className={cx(ITEM, a.tone === "destructive" && "table-handles__item--destructive")} onSelect={() => a.run(editor)}>
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
    <TableHandleRoot className="table-handles">
      <TableHandleDragPreview />
      <TableHandleDropIndicator className="report-table-drop" />
      <TableHandleColumnPositioner placement="top" offset={-12} className="table-handles__positioner">
        <TableHandleColumnPopup className="table-handles__popup">
          <TableHandleColumnMenuRoot className="table-handles">
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
      <TableHandleRowPositioner placement="left" offset={-12} className="table-handles__positioner">
        <TableHandleRowPopup className="table-handles__popup">
          <TableHandleRowMenuRoot className="table-handles">
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
