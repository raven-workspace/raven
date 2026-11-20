import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import "./AttachmentImage.scss";

/** An attachment loaded over IPC and shown from a `data:` URL. */
export function AttachmentImage({
  id,
  alt,
  onWidth,
}: {
  id: string;
  alt: string;
  /** The image's natural width once it loads. */
  onWidth?(width: number): void;
}) {
  const { data } = useQuery({ queryKey: ["attachment", id], queryFn: () => api.attachmentGet(id), staleTime: Infinity });
  if (!data) return <div className="attachment-image__placeholder" aria-hidden />;
  return (
    <img
      src={`data:${data.mime};base64,${data.dataBase64}`}
      alt={alt}
      onLoad={onWidth ? (e) => onWidth(e.currentTarget.naturalWidth) : undefined}
      className="attachment-image"
    />
  );
}
