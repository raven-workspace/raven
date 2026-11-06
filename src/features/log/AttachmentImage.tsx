import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** An attachment loaded over IPC and shown from a `data:` URL. */
export function AttachmentImage({ id, alt }: { id: string; alt: string }) {
  const { data } = useQuery({ queryKey: ["attachment", id], queryFn: () => api.attachmentGet(id), staleTime: Infinity });
  if (!data) return <div className="h-16 w-full rounded-sm border border-line" aria-hidden />;
  return (
    <img
      src={`data:${data.mime};base64,${data.dataBase64}`}
      alt={alt}
      className="h-auto w-auto max-h-[420px] max-w-full self-start rounded-sm border border-line-2"
    />
  );
}
