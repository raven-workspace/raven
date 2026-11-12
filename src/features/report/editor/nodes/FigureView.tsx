import type { ReactNodeViewProps } from "prosekit/react";
import { AttachmentImage } from "../../../log/AttachmentImage";

/** A screenshot on a plain page: the image, then its caption as ordinary editable text (empty: no caption printed). */
export function FigureView({ node, contentRef }: ReactNodeViewProps) {
  const caption = node.textContent;
  return (
    <figure className="report-figure report-plain-figure" data-report="figure">
      <div contentEditable={false}>
        <AttachmentImage id={node.attrs.attachmentId as string} alt={caption} />
      </div>
      {/* ProseKit puts the editable <figcaption> (the caption text) in here. */}
      <div ref={contentRef} className="report-plain-caption" />
    </figure>
  );
}
