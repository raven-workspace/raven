/** An image pasted into the capture panel: upload bytes plus a preview URL (revoke when dropped). */
export interface PastedImage {
  mime: string;
  dataBase64: string;
  objectUrl: string;
}

/** The first image on a clipboard, if any. Synchronous, so the caller can `preventDefault`. */
export function clipboardImage(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return Array.from(data.files ?? []).find((f) => f.type.startsWith("image/")) ?? null;
}

/** Reads an image file into base64 (no `data:` prefix) and makes a preview URL. */
export function readImage(file: File): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        mime: file.type,
        dataBase64: url.slice(url.indexOf(",") + 1),
        objectUrl: URL.createObjectURL(file),
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Reads an image from a paste event; null when the clipboard holds none. */
export function readPastedImage(e: Pick<ClipboardEvent, "clipboardData">): Promise<PastedImage | null> {
  const file = clipboardImage(e.clipboardData);
  return file ? readImage(file) : Promise.resolve(null);
}

export function releaseImage(image: PastedImage | null | undefined) {
  // jsdom has no object URLs.
  if (image) URL.revokeObjectURL?.(image.objectUrl);
}
