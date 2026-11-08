import { Copy } from "@phosphor-icons/react";
import { Fragment } from "react";
import { copyPlain } from "../lib/clipboard";
import { IconButton } from "./IconButton";

export interface CommandBlockProps {
  text: string;
  label?: string;
  onCopy?: () => void;
  /** Render `{TOKEN}` placeholders in the warn colour. */
  placeholders?: boolean;
}

function parts(text: string, placeholders: boolean) {
  if (!placeholders) return [text];
  return text.split(/(\{[A-Za-z0-9_]+\})/g);
}

export function CommandBlock({ text, label, onCopy, placeholders }: CommandBlockProps) {
  return (
    <div className="grid gap-1">
      {label && <span className="text-meta text-muted-2">{label}</span>}
      <div className="grid grid-cols-[minmax(0,1fr)_28px] items-start gap-2 rounded-sm border border-line bg-surface px-2 py-1.5">
        <code className="min-w-0 font-mono text-code break-all whitespace-pre-wrap text-fg-2">
          {parts(text, !!placeholders).map((p, i) =>
            placeholders && /^\{[A-Za-z0-9_]+\}$/.test(p) ? (
              <span key={i} className="text-warn">
                {p}
              </span>
            ) : (
              <Fragment key={i}>{p}</Fragment>
            ),
          )}
        </code>
        <IconButton
          icon={Copy}
          label="Copy"
          onClick={() => {
            void copyPlain(text);
            onCopy?.();
          }}
        />
      </div>
    </div>
  );
}
