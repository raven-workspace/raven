import type { ClipboardEvent, KeyboardEvent } from "react";
import type { LogKind } from "../../types/log";
import { XIcon } from "@phosphor-icons/react";
import { IconButton, Textarea } from "../../ui";
import type { PastedImage } from "./imagePaste";

const PLACEHOLDER: Record<LogKind, string> = {
  command: "Paste a terminal block",
  screenshot: "Paste an image (⌘V)",
  http: "Paste a request (and response)",
  note: "Anything that isn't a command, screenshot, request or flag: e.g. read the exploit source, CVE-2020-13151 applies (UDF enabled)",
  flag: "Flag value",
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
        className="rounded-sm border border-line-2 p-2 focus-visible:outline-1 focus-visible:outline-accent"
      >
        <img src={image.objectUrl} alt="Pasted screenshot" className="mx-auto block max-h-72 max-w-full" />
      </div>
    );
  }
  return (
    <>
      {kind === "flag" && image && (
        <div className="grid grid-cols-[auto_auto] items-start justify-start gap-2">
          <img src={image.objectUrl} alt="Pasted image" className="max-h-24 max-w-40 rounded-sm border border-line-2" />
          <IconButton icon={XIcon} label="Remove image" onClick={onRemoveImage} />
        </div>
      )}
      <Textarea
        ref={bindRef}
        aria-label="Paste"
        mono
        rows={kind === "note" ? 8 : 10}
        placeholder={PLACEHOLDER[kind]}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
    </>
  );
}
