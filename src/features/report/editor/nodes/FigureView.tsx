import { useQuery } from "@tanstack/react-query";
import type { ReactNodeViewProps } from "prosekit/react";
import { api } from "../../../../lib/api";
import { AttachmentImage } from "../../../log/AttachmentImage";

/** A screenshot on the page: the image, then its caption as ordinary editable text (empty: no caption printed). A
 *  file that is gone says so in the page's amber while its query fails (it shows again once the file loads); the
 *  caption stays editable and the figure deletable. */
export function FigureView({ node, contentRef }: ReactNodeViewProps) {
  const caption = node.textContent;
  const id = node.attrs.attachmentId as string;
  // The image's own query (shared cache): its error state is the figure's "missing", never sticky.
  const { isError: missing } = useQuery({ queryKey: ["attachment", id], queryFn: () => api.attachmentGet(id), staleTime: Infinity });
  return (
    <figure className="report-figure report-plain-figure" data-report="figure">
      <div contentEditable={false}>
        {missing ? (
          <p className="report-missing m-0 text-meta" contentEditable={false}>
            This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.
          </p>
        ) : (
          <AttachmentImage id={id} alt={caption} />
        )}
      </div>
      {/* ProseKit puts the editable <figcaption> (the caption text) in here. */}
      <div ref={contentRef} className="report-plain-caption" />
    </figure>
  );
}
