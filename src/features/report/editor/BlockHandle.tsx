import { DotsSixVertical, DotsThree } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import type { Node as PMNode } from "prosekit/pm/model";
import { useEditor } from "prosekit/react";
import { BlockHandleDraggable, BlockHandlePopup, BlockHandlePositioner, BlockHandleRoot } from "prosekit/react/block-handle";
import { DropIndicator } from "prosekit/react/drop-indicator";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { refreshBlocks } from "../../../engines/report";
import { Button, Dialog, Tooltip } from "../../../ui";
import { currentRun, deleteBlockAt, isEdited, refreshLabel, refreshRun, sourceRun, type SourceRun } from "./pageActions";
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
 * all, in one undoable step) to where the drop line shows. Beside it, ⋯ opens the block's menu: Refresh (from the log,
 * a finding or Raven) where the block's source can be written again, and Delete. Refresh replaces the block's whole
 * run (`sourceRun`); when the owner has edited it, it asks first. No add button: insertion stays in the evidence rail.
 */
export function BlockHandle() {
  const editor = useEditor();
  const { data, target, reportMeta } = useReportData();
  // The block the handle is beside, and the one the open menu acts on (held while the pointer is in the menu).
  const hovered = useRef<Hovered>(null);
  const [menu, setMenu] = useState<Hovered>(null);
  // An edited run waiting on the owner's answer.
  const [confirm, setConfirm] = useState<SourceRun | null>(null);

  const meta = reportMeta ?? {};
  // The hovered block's run, while it still stands where the handle saw it.
  const run = menu && editor.mounted && editor.state.doc.nodeAt(menu.pos) === menu.node ? sourceRun(editor.state.doc, menu.pos) : null;
  const canRefresh = run !== null && refreshBlocks(run.source, data, target ?? null, meta) !== null;
  const done = () => {
    setMenu(null);
    editor.focus();
  };
  /** Refreshes a run the owner confirmed (or that needs no asking). A run that moved since is found again by its
   *  source; if what stands there now is edited, the owner is asked again about that run. */
  const refresh = (r: SourceRun) => {
    const now = currentRun(editor.state.doc, r);
    if (!now) return;
    if (now !== r && isEdited(now.nodes)) setConfirm(now);
    else refreshRun(editor, now, data, target ?? null, meta);
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
                  {canRefresh && (
                    <button
                      type="button"
                      role="menuitem"
                      className={ITEM}
                      onClick={() => {
                        setMenu(null);
                        if (isEdited(run.nodes)) setConfirm(run);
                        else {
                          refresh(run);
                          editor.focus();
                        }
                      }}
                    >
                      {refreshLabel(run.source)}
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
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Replace this block with the current version?"
        description="Your edits to this block are replaced. ⌘Z brings them back."
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          editor.focus();
        }}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(null);
                if (confirm) refresh(confirm);
              }}
            >
              Replace
            </Button>
          </>
        }
      />
    </>
  );
}
