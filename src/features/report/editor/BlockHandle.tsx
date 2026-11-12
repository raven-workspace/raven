import { DotsSixVertical } from "@phosphor-icons/react";
import { BlockHandleDraggable, BlockHandlePopup, BlockHandlePositioner, BlockHandleRoot } from "prosekit/react/block-handle";
import { DropIndicator } from "prosekit/react/drop-indicator";
import { Tooltip } from "../../../ui";

/**
 * The page's drag handle: hovering a block shows it in the left gutter, and dragging it moves the block (attrs and
 * all, in one undoable step) to where the drop line shows. No add button: insertion stays in the evidence rail.
 */
export function BlockHandle() {
  return (
    <>
      <BlockHandleRoot className="report-handle-root">
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
              <BlockHandleDraggable aria-label="Drag to move" role="button" className="report-handle-grip">
                <DotsSixVertical size={16} weight="bold" aria-hidden />
              </BlockHandleDraggable>
            </Tooltip>
          </BlockHandlePopup>
        </BlockHandlePositioner>
      </BlockHandleRoot>
      <DropIndicator className="report-drop" />
    </>
  );
}
