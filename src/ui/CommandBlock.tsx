import { Check, Copy } from "@phosphor-icons/react";
import { Fragment } from "react";
import { copyPlain, copySecret } from "../lib/clipboard";
import { cx } from "../lib/cx";
import { useFlash } from "./motion";
import "./CommandBlock.scss";
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
  const [copied, flashDone] = useFlash(1200);
  const pattern = [...(placeholders ? ["\\{[A-Za-z0-9_]+\\}"] : []), ...[...(tokens ?? [])].sort((a, b) => b.length - a.length).map(escapeRegExp)];
  const re = pattern.length > 0 ? new RegExp(`(${pattern.join("|")})`) : null;
  const found = rangesOf(text, highlight);
  const pieces = text.split(/(\s+)/);
  // Where each piece starts in `text`, so a match is marked across the token spans (only worked out with a search).
  const starts: number[] = [];
  if (found.length > 0) pieces.reduce((at, t) => (starts.push(at), at + t.length), 0);
  return (
    <div className="command-block">
      {label && <span className="command-block__label">{label}</span>}
      <div className={cx("command-block__box", attached && "command-block__box--attached")}>
        <pre
          className={cx("command-block__text", wrap ? "command-block__text--wrap" : "command-block__text--scroll")}
          {...(name ? { role: "group", "aria-label": `Command: ${name}` } : {})}
        >
          <code>
            {pieces.map((t, i) => {
              if (t === "") return null;
              if (found.length === 0) {
                if (/^\s+$/.test(t)) return <Fragment key={i}>{t}</Fragment>;
                return (
                  <span key={i} data-token className="command-block__token">
                    {marks(t, re).map((m, j) => (m.warn ? <mark key={j} className="command-block__warn">{m.text}</mark> : m.text))}
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
                <span key={i} data-token className="command-block__token">
                  {parts.map((m, j) => {
                    const shown = highlightText(m.text, partStarts[j], found);
                    return m.warn ? <mark key={j} className="command-block__warn">{shown}</mark> : <Fragment key={j}>{shown}</Fragment>;
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
