import { Check, Copy } from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { copyPlain, copySecret } from "../lib/clipboard";
import { reportError } from "../lib/lockSignal";
import { highlight as highlightText, rangesOf } from "./highlight";
import { IconButton } from "./IconButton";
import { escapeRegExp } from "../engines/regex";

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
  /** A search to mark in the shown text (`<mark data-match>`); what copies is never changed. */
  highlight?: RegExp | null;
  /**
   * `false` keeps every line whole and scrolls the block sideways instead (output, tables and diagrams drawn in text,
   * whose columns are the content). Commands wrap, so a long one is seen whole before it is copied.
   */
  wrap?: boolean;
  /** The Copy button's tab index; `-1` takes it out of the Tab order when the block around it is the one stop. */
  copyTabIndex?: number;
  /** Squares the bottom corners so the command's output can join the box from below (a logged step). */
  attached?: boolean;
}


/** Splits one whitespace-free token into plain and warn parts (the capture group puts matches at odd indexes). */
function marks(token: string, re: RegExp | null): { text: string; warn: boolean }[] {
  if (!re) return [{ text: token, warn: false }];
  return token
    .split(re)
    .map((text, i) => ({ text, warn: i % 2 === 1 }))
    .filter((m) => m.text !== "");
}

export function CommandBlock({ text, label, name, onCopy, placeholders, tokens, copyText, copyLabel, onCopyAction, highlight, wrap = true, copyTabIndex, attached }: CommandBlockProps) {
  const token = wrap ? "inline-block max-w-full [overflow-wrap:anywhere]" : "inline-block";
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pattern = [...(placeholders ? ["\\{[A-Za-z0-9_]+\\}"] : []), ...[...(tokens ?? [])].sort((a, b) => b.length - a.length).map(escapeRegExp)];
  const re = pattern.length > 0 ? new RegExp(`(${pattern.join("|")})`) : null;
  const found = rangesOf(text, highlight);
  const pieces = text.split(/(\s+)/);
  // Where each piece starts in `text`, so a match is marked across the token spans (only worked out with a search).
  const starts: number[] = [];
  if (found.length > 0) pieces.reduce((at, t) => (starts.push(at), at + t.length), 0);
  const flashDone = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="grid gap-1">
      {label && <span className="text-meta text-muted-2">{label}</span>}
      <div className={`grid grid-cols-[minmax(0,1fr)_28px] items-start gap-2 rounded-sm border border-line bg-surface px-2 py-2${attached ? " rounded-b-none" : ""}`}>
        <pre
          className={wrap ? "m-0 min-w-0 overflow-x-hidden font-mono text-code whitespace-pre-wrap text-fg-2" : "m-0 min-w-0 overflow-x-auto overflow-y-hidden pr-6 pb-3 font-mono text-code whitespace-pre text-fg-2 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]"}
          {...(name ? { role: "group", "aria-label": `Command: ${name}` } : {})}
        >
          <code>
            {pieces.map((t, i) => {
              if (t === "") return null;
              if (found.length === 0) {
                if (/^\s+$/.test(t)) return <Fragment key={i}>{t}</Fragment>;
                return (
                  <span key={i} data-token className={token}>
                    {marks(t, re).map((m, j) => (m.warn ? <mark key={j} className="bg-transparent text-warn">{m.text}</mark> : m.text))}
                  </span>
                );
              }
              const at = starts[i];
              if (/^\s+$/.test(t)) return <Fragment key={i}>{highlightText(t, at, found)}</Fragment>;
              const parts = marks(t, re);
              const partStarts: number[] = [];
              parts.reduce((n, p) => (partStarts.push(n), n + p.text.length), at);
              // Each space-separated token never breaks (browsers would otherwise break after a hyphen), even around a
              // placeholder; the spaces between tokens are the only break points.
              return (
                <span key={i} data-token className={token}>
                  {parts.map((m, j) => {
                    const shown = highlightText(m.text, partStarts[j], found);
                    return m.warn ? <mark key={j} className="bg-transparent text-warn">{shown}</mark> : <Fragment key={j}>{shown}</Fragment>;
                  })}
                </span>
              );
            })}
          </code>
        </pre>
        <IconButton
          icon={copied ? Check : Copy}
          label={copyLabel ?? "Copy"}
          {...(copyTabIndex !== undefined ? { tabIndex: copyTabIndex } : {})}
          onClick={(e) => {
            // A failed copy (a locked vault included) goes to the shared error path, never an unhandled rejection, and
            // the done check shows only once the copy succeeded.
            if (onCopyAction) {
              void Promise.resolve(onCopyAction(e.currentTarget)).then((r) => {
                if (r !== "guarded") flashDone();
              }, reportError);
              return;
            }
            (copyText === undefined ? copyPlain(text) : copySecret(copyText)).then(flashDone, reportError);
            onCopy?.();
          }}
        />
      </div>
    </div>
  );
}
