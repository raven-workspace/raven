import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { storeChanged } from "../../lib/storeChange";
import type { LogEntry } from "../../types/log";
import { readImage, releaseImage } from "../capture/imagePaste";
import { logKey } from "./queries";

const fileNameOf = (file: File) => file.name || `screenshot.${file.type.split("/")[1] ?? "png"}`;

/**
 * Saves an image as a screenshot log entry on `hostIds` (the attachment storage the capture panel uses), titled by its
 * caption (else "Screenshot"), and adds it to the cached log at once so a view can show it before the refetch.
 */
export async function saveScreenshot(qc: QueryClient, engagementId: string, hostIds: string[], file: File, caption = ""): Promise<LogEntry> {
  const image = await readImage(file);
  releaseImage(image);
  const said = caption.trim();
  const entry = await api.logCreate(engagementId, {
    title: said || "Screenshot",
    ranOn: null,
    hostIds,
    observations: null,
    returnedNothing: false,
    private: false,
    content: { kind: "screenshot", attachmentId: "", caption: said, fileName: fileNameOf(file) },
    attachment: { mime: image.mime, dataBase64: image.dataBase64 },
  });
  qc.setQueryData<LogEntry[]>(logKey(engagementId), (list) => (list ? [...list, entry] : list));
  void storeChanged(qc, { entity: "logEntry", id: entry.id, change: "created" });
  return entry;
}
