import { Fragment, type KeyboardEvent } from "react";
import type { LibraryCommand } from "../../engines/library/types";
import { reportError } from "../../lib/lockSignal";
import { highlight as highlightText, rangesOf } from "../../ui/highlight";
import { useNoteCommand, type FillBase } from "./useNoteCommand";
import { escapeRegExp } from "../../engines/regex";
import "./InlineCommand.scss";

const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9_]*\}/;

/**
 * An inline code span that reads as a command (`isInlineCommand`), filled for the host in view and copied on click:
 * the same fill, copy guard, exam rules and log as a code block, as a button that looks like inline code. ↵ or a click
 * copies, ⌘↵ copies and logs. Unfilled tokens show in the warn colour, masked secrets masked.
 */
export function InlineCommand({ command, base, highlight }: { command: LibraryCommand; base: FillBase; highlight?: RegExp | null }) {
  const { cmd, copy, copyAndLog } = useNoteCommand(command, { fill: PLACEHOLDER.test(command.template), output: false, base });
  const tokens = [...(cmd.tokens ?? cmd.unresolved)].sort((a, b) => b.length - a.length);
  const split = tokens.length > 0 ? new RegExp(`(${tokens.map(escapeRegExp).join("|")})`) : null;
  const found = rangesOf(cmd.text, highlight);
  const parts = split ? cmd.text.split(split) : [cmd.text];
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((n, t) => n + t.length, 0));
  const pieces = parts.map((t, i) => {
    const start = starts[i] ?? 0;
    const shown = found.length > 0 ? highlightText(t, start, found) : t;
    return i % 2 === 1 ? <mark key={i} className="inline-command__token">{shown}</mark> : <Fragment key={i}>{shown}</Fragment>;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    void copyAndLog();
  };
  return (
    <button
      type="button" aria-label={`Copy command: ${cmd.text}`}
      onClick={() => void copy().catch(reportError)} onKeyDown={onKeyDown}
      className="inline-command"
    >
      {pieces}
    </button>
  );
}
