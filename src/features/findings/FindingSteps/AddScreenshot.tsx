import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { cx } from "../../../lib/cx";
import { keyLabel, SHORTCUTS } from "../../../lib/shortcuts";
import { Button, Input } from "../../../ui/index";
import { clipboardImage, readImage, releaseImage, type PastedImage } from "../../capture/imagePaste";
import { saveScreenshot } from "../../log/saveScreenshot";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/**
 * A screenshot added from a finding: pasted, dropped or chosen, with its caption. Saving it makes a normal screenshot
 * log entry on the finding's hosts (it shows in the log like any capture) and hands its id back to be appended to the
 * finding's steps. "Link a screenshot from the log" asks for the step picker, screenshots only, to link an existing
 * capture instead: never a copy. When a step after the save fails (the checklist sync, say), the screenshot is still
 * saved and added, and what failed is handed back with it.
 */
export function AddScreenshot({ eid, hostIds, onAdded, onLink, onClose }: {
  eid: string;
  /** The finding's hosts: the screenshot is logged on them. */
  hostIds: string[];
  /** `failed`: the message of a step after the save that failed; the screenshot is saved all the same. */
  onAdded: (entryId: string, failed: string | null) => void;
  onLink: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<PastedImage | null>(null);
  const [caption, setCaption] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const noHost = hostIds.length === 0;

  // The drop zone takes focus, so ⌘V works at once.
  useEffect(() => zone.current?.focus(), []);
  useEffect(() => () => releaseImage(image), [image]);

  const take = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("That isn't an image. Use a PNG, JPEG, WebP or GIF.");
      return;
    }
    setError(null);
    setFile(f);
    setImage(await readImage(f));
  };
  const save = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { entry, failed } = await saveScreenshot(qc, eid, hostIds, file, caption);
      onAdded(entry.id, failed?.message ?? null);
    } catch (e) {
      setError(`Couldn't save the screenshot: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const f = clipboardImage(e.clipboardData);
    if (!f) return;
    e.preventDefault();
    void take(f);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    void take(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")) ?? e.dataTransfer.files[0]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div role="group" aria-label="Add a screenshot" className="finding-shot" onKeyDown={onKeyDown}>
      {noHost ? (
        <p className="finding-steps__hint">Pick the finding's host first: the screenshot is logged on it.</p>
      ) : (
        <>
          <div
            ref={zone}
            tabIndex={0}
            aria-label={`Screenshot: paste (${keyLabel(SHORTCUTS.paste)}), drop or choose an image`}
            onPaste={onPaste}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx("finding-shot__zone", dragging && "finding-shot__zone--dragging")}
          >
            {image ? (
              <img src={image.objectUrl} alt="The screenshot to add" className="finding-shot__image" />
            ) : (
              <span className="finding-shot__prompt">Paste ({keyLabel(SHORTCUTS.paste)}) or drop an image here</span>
            )}
          </div>
          <Input
            aria-label="Caption"
            placeholder="Caption: what the screenshot shows"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
          />
        </>
      )}
      {error && (
        <p role="alert" className="finding-steps__error">
          {error}
        </p>
      )}
      <div className="finding-shot__sources">
        <input
          ref={picker}
          type="file"
          accept={IMAGE_TYPES}
          aria-label="Choose an image"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void take(f);
          }}
        />
        <Button size="sm" disabled={noHost} onClick={() => picker.current?.click()}>
          Choose file
        </Button>
        <Button size="sm" onClick={onLink}>
          Link a screenshot from the log
        </Button>
      </div>
      <div className="finding-shot__commit">
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!file || busy || noHost} onClick={() => void save()}>
          {busy ? "Saving…" : "Add screenshot"}
        </Button>
      </div>
    </div>
  );
}
