import type { KeyboardEvent, Ref } from "react";
import type { FlagKind, LogContent } from "../../../types/log";
import { Field, Input } from "../../../ui/index";
import "./KindFields.scss";

export interface KindFieldsProps {
  content: LogContent;
  caption: string;
  onCaption: (caption: string) => void;
  flagKind: FlagKind;
  onFlagKind: (k: FlagKind) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  captionRef?: Ref<HTMLInputElement>;
}

/** Fields only some kinds have: a screenshot's caption and file name, a flag's local/proof. */
export function KindFields({ content, caption, onCaption, flagKind, onFlagKind, onKeyDown, captionRef }: KindFieldsProps) {
  if (content.kind === "screenshot") {
    return (
      <div className="kind-fields">
        <Field label="Caption">
          <Input ref={captionRef} value={caption} onChange={(e) => onCaption(e.target.value)} onKeyDown={onKeyDown} />
        </Field>
        {/* Labelled, so the file name reads as where the image is saved, not as help text for the caption. */}
        <p data-testid="capture-file-name" className="kind-fields__file">
          <span className="kind-fields__file-label">Saved as</span>
          <span className="kind-fields__file-name">{content.fileName}</span>
        </p>
      </div>
    );
  }
  if (content.kind === "flag") {
    return (
      <div role="group" aria-label="Flag file" className="kind-fields__flag">
        {(["local", "proof"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={flagKind === k}
            onClick={() => onFlagKind(k)}
            className="kind-fields__flag-option"
          >
            {`${k}.txt`}
          </button>
        ))}
      </div>
    );
  }
  return null;
}
