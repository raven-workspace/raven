import { Check, Copy } from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { copyPlain, copySecret } from "../lib/clipboard";
import { IconButton } from "./IconButton";

export interface CommandBlockProps {
  text: string;
  label?: string;
  onCopy?: () => void;
  /** When the shown text is masked, the real command Copy puts on the clipboard (treated as a secret). */
  copyText?: string;
  /** Accessible name of the Copy button when "Copy" alone is ambiguous. */
  copyLabel?: string;
  /** Render `{TOKEN}` placeholders in the warn colour. */
  placeholders?: boolean;
}

function parts(text: string, placeholders: boolean) {
  if (!placeholders) return [text];
  return text.split(/(\{[A-Za-z0-9_]+\})/g);
}

export function CommandBlock({ text, label, onCopy, placeholders, copyText, copyLabel }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="grid gap-1">
      {label && <span className="text-meta text-muted-2">{label}</span>}
      <div className="grid grid-cols-[minmax(0,1fr)_28px] items-start gap-2 rounded-sm border border-line bg-surface px-2 py-2">
        <code className="min-w-0 font-mono text-code [overflow-wrap:anywhere] whitespace-pre-wrap text-fg-2">
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
          icon={copied ? Check : Copy}
          label={copyLabel ?? "Copy"}
          onClick={() => {
            void (copyText === undefined ? copyPlain(text) : copySecret(copyText));
            onCopy?.();
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1200);
          }}
        />
      </div>
    </div>
  );
}
