import { useRef, type KeyboardEvent } from "react";
import type { LibraryCommand } from "../../../engines/library/types";
import { CommandBlock } from "../../../ui/index";
import { useNoteCommand, type FillBase } from "../useNoteCommand";
import { cx } from "../../../lib/cx";
import "./ManualCommand.scss";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";

export type { FillBase };

/**
 * One code block of a Manual note as a command. With `fill`, its `{PLACEHOLDERS}` fill for the host in view exactly as
 * an Arsenal card's do (`fillLibraryCommand`); without, the text copies as written. Copy goes through the copy guard
 * (an unfilled token holds the first copy back). With focus on the block, ↵ copies and ⌘↵ copies and logs it.
 *
 * A reading surface for the exam rules: the text is never hidden. A command the exam forbids shows its exam verdict's
 * line in amber and its first copy is held back; one that would take the Metasploit lock says so.
 */
export function ManualCommand({ command, label, caption, fill, output = false, base, highlight }: {
  command: LibraryCommand;
  /** Names the block (one labelled group per command) and its Copy button for screen readers. */
  label: string;
  /** The fence's `title:"…"`, shown over the block. */
  caption?: string;
  fill: boolean;
  /** Output to read (a `text`/`output`/`console` fence): Copy only, no log and no exam rule. */
  output?: boolean;
  base: FillBase;
  /** The note's search: its matches are marked in the shown text. */
  highlight?: RegExp | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { cmd, copy, copyAndLog, examLine } = useNoteCommand(command, { fill, output, base });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Output keeps its lines whole and scrolls sideways: ← → scroll it while the block has focus.
    if (output && (e.key === "ArrowLeft" || e.key === "ArrowRight") && e.target === root.current && !e.metaKey && !e.altKey) {
      const pre = root.current?.querySelector("pre");
      if (pre && pre.scrollWidth > pre.clientWidth) {
        e.preventDefault();
        pre.scrollBy({ left: e.key === "ArrowLeft" ? -80 : 80 });
      }
      return;
    }
    if (e.key !== "Enter" || e.altKey || e.shiftKey || e.nativeEvent.isComposing || e.defaultPrevented) return;
    if (matches(SHORTCUTS.copyAndLog, e)) {
      e.preventDefault();
      void copyAndLog();
    } else if (e.target === root.current) {
      e.preventDefault();
      // The Copy button's own path, so its done check shows.
      root.current?.querySelector<HTMLElement>('button[aria-label^="Copy command"]')?.click();
    }
  };

  return (
    <div
      ref={root} role="group" aria-label={`Note command: ${label}`} tabIndex={0} onKeyDown={onKeyDown}
      className="manual-command"
    >
      {/* An untitled block has no caption row (no empty gap above it). Copy results show in the page's status slot. */}
      {caption && <span className="manual-command__caption">{caption}</span>}
      <CommandBlock
        text={cmd.shown}
        tokens={cmd.tokens ?? []}
        highlight={highlight ?? null}
        wrap={!output}
        copyTabIndex={-1}
        copyLabel={`Copy command: ${label}`}
        onCopyAction={(button) =>
          copy().then((r) => {
            // Held back with nothing else to take focus: the Copy button keeps it, so ↵ is the second press.
            if (r === "guarded" && (document.activeElement === document.body || document.activeElement === button)) button.focus();
            return r;
          })}
      />
      <ExamLine line={examLine} />
    </div>
  );
}

/** The exam verdict's line under a Manual command: amber when it breaks a rule, plain when it only informs. */
export function ExamLine({ line }: { line: { text: string; breach: boolean } | null }) {
  if (!line) return null;
  return <p className={cx("manual-command__rule", line.breach && "manual-command__rule--warn")}>{line.text}</p>;
}
