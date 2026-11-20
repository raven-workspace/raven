import { useQuery } from "@tanstack/react-query";
import type { ReactNodeViewProps } from "prosekit/react";
import { ResizableHandle, ResizableRoot } from "prosekit/react/resizable";
import { useContext } from "react";
import { api } from "../../../../../lib/api";
import { AttachmentImage } from "../../../../log/AttachmentImage/AttachmentImage";
import { ReportDataContext } from "../../ReportDataContext/ReportDataContext";
import { figureWidth } from "../figureWidth";
import "./FigureView.scss";

/** A screenshot on the page: the image, then its caption as ordinary editable text (empty: no caption printed). A
 *  file that is gone says so in the page's amber while its query fails (it shows again once the file loads); the
 *  caption stays editable and the figure deletable. Its image's natural width goes to the legibility check. Drag the
 *  corner to size it: the width is the node's, in px at the page's measure (the block menu's Full width clears it). */
export function FigureView({ node, contentRef, setAttrs }: ReactNodeViewProps) {
  const caption = node.textContent;
  const id = node.attrs.attachmentId as string;
  const entryId = typeof node.attrs.entryId === "string" ? node.attrs.entryId : "";
  const width = figureWidth(node.attrs.width);
  const onImageWidth = useContext(ReportDataContext)?.onImageWidth;
  // The image's own query (shared cache): its error state is the figure's "missing", never sticky.
  const { isError: missing } = useQuery({ queryKey: ["attachment", id], queryFn: () => api.attachmentGet(id), staleTime: Infinity });
  return (
    <figure className="report-figure report-plain-figure" data-report="figure">
      <div contentEditable={false}>
        {missing ? (
          <p className="report-missing figure-view__missing" contentEditable={false}>
            This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.
          </p>
        ) : (
          // Keyed on sized/full: the resizable keeps the width it was dragged to, so clearing it (Full width) remounts it.
          <ResizableRoot key={width === null ? "full" : "sized"} className="report-resizable" width={width ?? undefined} onResizeEnd={(e) => setAttrs({ width: figureWidth(e.detail.width) })}>
            <AttachmentImage id={id} alt={caption} onWidth={onImageWidth && entryId ? (w) => onImageWidth(entryId, w) : undefined} />
            <ResizableHandle position="bottom-right" className="report-resize-handle" aria-label="Resize the screenshot" />
          </ResizableRoot>
        )}
      </div>
      {/* ProseKit puts the editable <figcaption> (the caption text) in here. */}
      <div ref={contentRef} className="report-plain-caption" />
    </figure>
  );
}
