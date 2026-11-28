import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import { cx } from "../../../lib/cx";
import { keyLabel, SHORTCUTS } from "../../../lib/shortcuts";
import type { LogKind } from "../../../types/log";
import { XIcon } from "@phosphor-icons/react";
import { IconButton, Textarea } from "../../../ui/index";
import type { PastedImage } from "../imagePaste";
import "./PasteArea.scss";

const PLACEHOLDER: Record<LogKind, () => string> = {
  command: () => "Paste a terminal block",
  screenshot: () => `Paste an image (${keyLabel(SHORTCUTS.paste)})`,
  http: () => "Paste a request (and response)",
  note: () => "Anything that isn't a command, screenshot, request or flag: e.g. read the exploit source, CVE-2020-13151 applies (UDF enabled)",
  flag: () => "Flag value",
};

export interface PasteAreaProps {
  kind: LogKind;
  text: string;
  image: PastedImage | null;
  bindRef: (el: HTMLElement | null) => void;
  onText: (text: string) => void;
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
  /** A dragged image file lands here too (the log entry tab). */
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onRemoveImage: () => void;
  /** Fill the parent's height, with no resize handle: the log entry tab's paste column. */
  fill?: boolean;
}

/**
 * Where the paste lands (label "Paste"): a screenshot's preview, else a text area. A flag shows
 * its image as a removable thumbnail above the value. Filling (the log entry tab), it takes its parent's height: the
 * preview fits the image inside it, and the text area grows to it.
 */
export function PasteArea({ kind, text, image, bindRef, onText, onPaste, onDragOver, onDrop, onKeyDown, onRemoveImage, fill = false }: PasteAreaProps) {
  if (kind === "screenshot" && image) {
    return (
      <div
        ref={bindRef}
        tabIndex={0}
        aria-label="Paste"
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cx("paste-area__preview", fill && "paste-area__preview--fill")}
      >
        <img src={image.objectUrl} alt="Pasted screenshot" className="paste-area__image" />
      </div>
    );
  }
  const thumb = kind === "flag" && image;
  const area = (
    <>
      {thumb && (
        <div className="paste-area__thumb-row">
          <img src={image.objectUrl} alt="Pasted image" className="paste-area__thumb" />
          <IconButton icon={XIcon} label="Remove image" onClick={onRemoveImage} />
        </div>
      )}
      <Textarea
        ref={bindRef}
        aria-label="Paste"
        mono
        rows={kind === "note" ? 8 : 10}
        placeholder={PLACEHOLDER[kind]()}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        className={fill ? "paste-area__text--fill" : undefined}
      />
    </>
  );
  // Filling, the thumbnail (when there is one) sits over the text area, which takes the rest of the height.
  return fill ? <div className={cx("paste-area--fill", thumb && "paste-area--fill-thumb")}>{area}</div> : area;
}
