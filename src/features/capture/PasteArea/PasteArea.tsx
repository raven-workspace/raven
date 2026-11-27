import type { ClipboardEvent, KeyboardEvent } from "react";
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
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onRemoveImage: () => void;
}

/**
 * Where the paste lands (label "Paste"): a screenshot's preview, else a text area. A flag shows
 * its image as a removable thumbnail above the value.
 */
export function PasteArea({ kind, text, image, bindRef, onText, onPaste, onKeyDown, onRemoveImage }: PasteAreaProps) {
  if (kind === "screenshot" && image) {
    return (
      <div
        ref={bindRef}
        tabIndex={0}
        aria-label="Paste"
        onPaste={onPaste}
        className="paste-area__preview"
      >
        <img src={image.objectUrl} alt="Pasted screenshot" className="paste-area__image" />
      </div>
    );
  }
  return (
    <>
      {kind === "flag" && image && (
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
        onKeyDown={onKeyDown}
      />
    </>
  );
}
