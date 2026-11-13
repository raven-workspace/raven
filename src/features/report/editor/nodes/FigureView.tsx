import { useQuery } from "@tanstack/react-query";
import type { ReactNodeViewProps } from "prosekit/react";
import { useContext } from "react";
import { api } from "../../../../lib/api";
import { AttachmentImage } from "../../../log/AttachmentImage";
import { ReportDataContext } from "../ReportDataContext";

/** A screenshot on the page: the image, then its caption as ordinary editable text (empty: no caption printed). A
 *  file that is gone says so in the page's amber while its query fails (it shows again once the file loads); the
 *  caption stays editable and the figure deletable. Its image's natural width goes to the legibility check. */
export function FigureView({ node, contentRef }: ReactNodeViewProps) {
  const caption = node.textContent;
  const id = node.attrs.attachmentId as string;
  const entryId = typeof node.attrs.entryId === "string" ? node.attrs.entryId : "";
  const onImageWidth = useContext(ReportDataContext)?.onImageWidth;
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
          <AttachmentImage id={id} alt={caption} onWidth={onImageWidth && entryId ? (w) => onImageWidth(entryId, w) : undefined} />
        )}
      </div>
      {/* ProseKit puts the editable <figcaption> (the caption text) in here. */}
      <div ref={contentRef} className="report-plain-caption" />
    </figure>
  );
}
