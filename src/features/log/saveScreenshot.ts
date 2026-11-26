import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { LogEntry } from "../../types/log";
import { readImage, releaseImage } from "../capture/imagePaste";
import { EntryChangeError, entryChanged } from "./entryChange";
import { logKey } from "./queries";

const fileNameOf = (file: File) => file.name || `screenshot.${file.type.split("/")[1] ?? "png"}`;

/** A screenshot stored: its entry, and the `EntryChangeError` when a step after the save failed (null when none did). */
export interface SavedScreenshot {
  entry: LogEntry;
  failed: EntryChangeError | null;
}

/**
 * Saves an image as a screenshot log entry on `hostIds` (the attachment storage the capture panel uses), titled by its
 * caption (else "Screenshot"), and adds it to the cached log at once so a view can show it before the refetch. Then it
 * reports a saved entry change (GLOSSARY.md), which runs the checklist sync, the Metasploit lock and the one store
 * change. Rejects when the entry isn't stored; once it is, a failed step after it comes back as `failed`, since the
 * screenshot stays saved (a partial save).
 */
export async function saveScreenshot(qc: QueryClient, engagementId: string, hostIds: string[], file: File, caption = ""): Promise<SavedScreenshot> {
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
  try {
    await entryChanged({ qc, engagementId, change: { change: "saved", entry, filing: null, failures: [] } });
    return { entry, failed: null };
  } catch (e) {
    if (e instanceof EntryChangeError) return { entry, failed: e };
    throw e;
  }
}
