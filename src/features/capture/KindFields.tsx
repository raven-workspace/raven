import type { KeyboardEvent, Ref } from "react";
import { cx } from "../../lib/cx";
import type { FlagKind, LogContent } from "../../types/log";
import { Field, Input } from "../../ui";

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
      <div className="grid gap-1">
        <Field label="Caption">
          <Input ref={captionRef} value={caption} onChange={(e) => onCaption(e.target.value)} onKeyDown={onKeyDown} />
        </Field>
        <p className="m-0 text-code text-muted">{content.fileName}</p>
      </div>
    );
  }
  if (content.kind === "flag") {
    return (
      <div role="group" aria-label="Flag file" className="grid grid-flow-col auto-cols-max justify-start gap-2">
        {(["local", "proof"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={flagKind === k}
            onClick={() => onFlagKind(k)}
            className={cx(
              "h-7 rounded-sm border px-2 text-code cursor-default",
              flagKind === k ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:text-fg",
            )}
          >
            {`${k}.txt`}
          </button>
        ))}
      </div>
    );
  }
  return null;
}
