import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** An attachment loaded over IPC and shown from a `data:` URL. */
export function AttachmentImage({
  id,
  alt,
  onWidth,
  onMissing,
}: {
  id: string;
  alt: string;
  /** The image's natural width once it loads. */
  onWidth?(width: number): void;
  /** Called when the file cannot be loaded (deleted, or never saved). */
  onMissing?(): void;
}) {
  const { data, isError } = useQuery({ queryKey: ["attachment", id], queryFn: () => api.attachmentGet(id), staleTime: Infinity });
  useEffect(() => {
    if (isError) onMissing?.();
  }, [isError, onMissing]);
  if (!data) return <div className="h-16 w-full rounded-sm border border-line" aria-hidden />;
  return (
    <img
      src={`data:${data.mime};base64,${data.dataBase64}`}
      alt={alt}
      onLoad={onWidth ? (e) => onWidth(e.currentTarget.naturalWidth) : undefined}
      className="h-auto w-auto max-h-[420px] max-w-full self-start rounded-sm border border-line-2"
    />
  );
}
