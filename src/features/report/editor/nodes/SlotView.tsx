import type { ReactNodeViewProps } from "prosekit/react";

/**
 * A prose slot: the owner's paragraph, with its hint showing while it is empty. The hint never exports. A slot with a
 * label ("Steps to reproduce the attack:") prints it in bold before the text, as OffSec's sample does.
 */
export function SlotView({ node, contentRef }: ReactNodeViewProps) {
  const empty = node.content.size === 0;
  const label = (node.attrs.label as string | undefined) || undefined;
  return (
    <div className="report-slot" data-empty={empty || undefined}>
      {empty && (
        <span className="report-slot-hint" contentEditable={false}>
          {/* Held in place under the label, which the text line draws. */}
          {label && <span className="report-slot-spacer">{label} </span>}
          {node.attrs.hint as string}
        </span>
      )}
      <div ref={contentRef} className="report-slot-text" data-label={label} />
    </div>
  );
}
