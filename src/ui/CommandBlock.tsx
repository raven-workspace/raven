import { Check, Copy } from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { copyPlain, copySecret } from "../lib/clipboard";
import { IconButton } from "./IconButton";

export interface CommandBlockProps {
  text: string;
  label?: string;
  /** Names the focusable command text for screen readers ("Command: <name>"). */
  name?: string;
  onCopy?: () => void;
  /** When the shown text is masked, the real command Copy puts on the clipboard (treated as a secret). */
  copyText?: string;
  /** Accessible name of the Copy button when "Copy" alone is ambiguous. */
  copyLabel?: string;
  /** Render `{TOKEN}` placeholders in the warn colour. */
  placeholders?: boolean;
  /** Exact strings to render in the warn colour wherever they occur (the unresolved tokens of a filled command). */
  tokens?: string[];
  /**
   * Replaces the default copy: the caller decides what reaches the clipboard (the copy guard). Resolve to "guarded"
   * when the copy was held back, so the button does not show the done check.
   */
  onCopyAction?: (button: HTMLButtonElement) => Promise<"copied" | "guarded"> | void;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits one whitespace-free token into plain and warn parts (the capture group puts matches at odd indexes). */
function marks(token: string, re: RegExp | null): { text: string; warn: boolean }[] {
  if (!re) return [{ text: token, warn: false }];
  return token
    .split(re)
    .map((text, i) => ({ text, warn: i % 2 === 1 }))
    .filter((m) => m.text !== "");
}

export function CommandBlock({ text, label, name, onCopy, placeholders, tokens, copyText, copyLabel, onCopyAction }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pattern = [...(placeholders ? ["\\{[A-Za-z0-9_]+\\}"] : []), ...[...(tokens ?? [])].sort((a, b) => b.length - a.length).map(escapeRe)];
  const re = pattern.length > 0 ? new RegExp(`(${pattern.join("|")})`) : null;
  const flashDone = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="grid gap-1">
      {label && <span className="text-meta text-muted-2">{label}</span>}
      <div className="grid grid-cols-[minmax(0,1fr)_28px] items-start gap-2 rounded-sm border border-line bg-surface px-2 py-2">
        <pre
          className="m-0 min-w-0 overflow-x-hidden font-mono text-code whitespace-pre-wrap text-fg-2"
          {...(name ? { role: "group", "aria-label": `Command: ${name}` } : {})}
        >
          <code>
            {text.split(/(\s+)/).map((t, i) => {
              if (t === "") return null;
              if (/^\s+$/.test(t)) return <Fragment key={i}>{t}</Fragment>;
              // Each space-separated token never breaks (browsers would otherwise break after a hyphen), even around a
              // placeholder; the spaces between tokens are the only break points.
              return (
                <span key={i} data-token className="inline-block max-w-full [overflow-wrap:anywhere]">
                  {marks(t, re).map((m, j) => (m.warn ? <mark key={j} className="bg-transparent text-warn">{m.text}</mark> : m.text))}
                </span>
              );
            })}
          </code>
        </pre>
        <IconButton
          icon={copied ? Check : Copy}
          label={copyLabel ?? "Copy"}
          onClick={(e) => {
            if (onCopyAction) {
              void Promise.resolve(onCopyAction(e.currentTarget)).then((r) => {
                if (r !== "guarded") flashDone();
              });
              return;
            }
            void (copyText === undefined ? copyPlain(text) : copySecret(copyText));
            onCopy?.();
            flashDone();
          }}
        />
      </div>
    </div>
  );
}
