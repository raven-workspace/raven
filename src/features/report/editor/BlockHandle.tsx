import { DotsSixVertical, DotsThree } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import type { Node as PMNode } from "prosekit/pm/model";
import { useEditor } from "prosekit/react";
import { BlockHandleDraggable, BlockHandlePopup, BlockHandlePositioner, BlockHandleRoot } from "prosekit/react/block-handle";
import { DropIndicator } from "prosekit/react/drop-indicator";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AppendixPlacement } from "../../../engines/report";
import { Tooltip } from "../../../ui";
import { moveLabel } from "./nodes/parts";
import { blockMovable, deleteBlockAt, setBlockAppendix } from "./pageActions";
import { useReportData } from "./ReportDataContext";

type Hovered = { node: PMNode; pos: number } | null;

const ITEM =
  "grid h-7 items-center rounded-sm border-0 bg-transparent px-2 text-left text-body text-fg-2 outline-none hover:bg-surface-hi hover:text-fg focus-visible:bg-surface-hi focus-visible:text-fg";

/** ↑↓ walk a menu's items, wrapping. */
function walkItems(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/**
 * The page's drag handle: hovering a block shows it in the left gutter, and dragging it moves the block (attrs and
 * all, in one undoable step) to where the drop line shows. Beside it, ⋯ opens the block's menu: Move to appendix (or
 * Back inline) where the block can move, and Delete. No add button: insertion stays in the evidence rail.
 */
export function BlockHandle() {
  const editor = useEditor();
  const { canMove = false, data } = useReportData();
  // The block the handle is beside, and the one the open menu acts on (held while the pointer is in the menu).
  const hovered = useRef<Hovered>(null);
  const [menu, setMenu] = useState<Hovered>(null);

  const movable = menu !== null && canMove && blockMovable(menu.node, data);
  const place = (menu?.node.attrs.appendix as AppendixPlacement | undefined) ?? "inline";
  const done = () => {
    setMenu(null);
    editor.focus();
  };
  // The handle hides while the page scrolls, and its menu would lose its anchor (Radix then pins it to the window's
  // corner): a scroll closes the menu, as the pointer leaving a hovered block does not.
  const open = menu !== null;
  useEffect(() => {
    if (!open) return;
    const close = () => setMenu(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);

  return (
    <>
      <BlockHandleRoot className="report-handle-root" onStateChange={(e) => (hovered.current = e.detail)}>
        <BlockHandlePositioner placement="left" offset={8} className="report-handle">
          <BlockHandlePopup className="report-handle-popup">
            <Tooltip
              side="left"
              content={
                <>
                  <span>Drag to move</span>
                  <span className="ml-2 font-mono text-muted">⌥↑ ⌥↓</span>
                </>
              }
            >
              <BlockHandleDraggable aria-label="Drag to move" className="report-handle-grip">
                <DotsSixVertical size={16} weight="bold" aria-hidden />
              </BlockHandleDraggable>
            </Tooltip>
            <Popover.Root open={menu !== null} onOpenChange={(open) => setMenu(open ? hovered.current : null)}>
              <Tooltip side="left" content="Block actions">
                <Popover.Trigger asChild>
                  <button type="button" aria-label="Block actions" className="report-handle-grip report-handle-menu">
                    <DotsThree size={16} weight="bold" aria-hidden />
                  </button>
                </Popover.Trigger>
              </Tooltip>
              <Popover.Portal>
                <Popover.Content
                  side="left"
                  align="start"
                  sideOffset={4}
                  role="menu"
                  aria-label="Block actions"
                  onKeyDown={walkItems}
                  className="z-50 grid min-w-40 gap-1 rounded-md border border-line-strong bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,.6)]"
                >
                  {movable && (
                    <button
                      type="button"
                      role="menuitem"
                      className={ITEM}
                      onClick={() => {
                        setBlockAppendix(editor, menu, place === "inline" ? "moved" : "inline");
                        done();
                      }}
                    >
                      {moveLabel(place)}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={`${ITEM} hover:text-warn focus-visible:text-warn`}
                    onClick={() => {
                      if (menu) deleteBlockAt(editor, menu);
                      done();
                    }}
                  >
                    Delete
                  </button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </BlockHandlePopup>
        </BlockHandlePositioner>
      </BlockHandleRoot>
      <DropIndicator className="report-drop" />
    </>
  );
}
