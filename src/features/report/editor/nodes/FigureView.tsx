import { useCallback, useState } from "react";
import type { ReactNodeViewProps } from "prosekit/react";
import { AttachmentImage } from "../../../log/AttachmentImage";

/** A screenshot on the page: the image, then its caption as ordinary editable text (empty: no caption printed). A
 *  file that is gone says so in amber; the caption stays editable and the figure deletable. */
export function FigureView({ node, contentRef }: ReactNodeViewProps) {
  const caption = node.textContent;
  const [missing, setMissing] = useState(false);
  const onMissing = useCallback(() => setMissing(true), []);
  return (
    <figure className="report-figure report-plain-figure" data-report="figure">
      <div contentEditable={false}>
        {missing ? (
          <p className="m-0 text-meta text-warn" contentEditable={false}>
            This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.
          </p>
        ) : (
          <AttachmentImage id={node.attrs.attachmentId as string} alt={caption} onMissing={onMissing} />
        )}
      </div>
      {/* ProseKit puts the editable <figcaption> (the caption text) in here. */}
      <div ref={contentRef} className="report-plain-caption" />
    </figure>
  );
}
