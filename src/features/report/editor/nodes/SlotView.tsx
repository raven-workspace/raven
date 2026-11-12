import type { ReactNodeViewProps } from "prosekit/react";

/** A prose slot: the owner's paragraph, with its hint showing while it is empty. The hint never exports. */
export function SlotView({ node, contentRef }: ReactNodeViewProps) {
  const empty = node.content.size === 0;
  return (
    <div className="report-slot" data-empty={empty || undefined}>
      {empty && (
        <span className="report-slot-hint" contentEditable={false}>
          {node.attrs.hint as string}
        </span>
      )}
      <div ref={contentRef} className="report-slot-text" />
    </div>
  );
}
