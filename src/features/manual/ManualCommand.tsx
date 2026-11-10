import { useRef, type KeyboardEvent } from "react";
import type { LibraryCommand } from "../../engines/library/types";
import { CommandBlock } from "../../ui";
import { BANNED, useNoteCommand, type FillBase } from "./useNoteCommand";

export type { FillBase };

/**
 * One code block of a Manual note as a command. With `fill`, its `{PLACEHOLDERS}` fill for the host in view exactly as
 * an Arsenal card's do (`fillLibraryCommand`); without, the text copies as written. Copy goes through the copy guard
 * (an unfilled token holds the first copy back). With focus on the block, ↵ copies and ⌘↵ copies and logs it.
 *
 * In an exam sim (or until the engagement's rules are known) the text is never hidden: a banned command says so in
 * amber and its first copy is held back, and a Meterpreter command shows the Metasploit lock line.
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
  const { cmd, copy, copyAndLog, banned, msf, known } = useNoteCommand(command, { fill, output, base });

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
    if (e.metaKey || e.ctrlKey) {
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
      className="grid gap-1 rounded-sm outline-accent outline-offset-4 outline-none focus:outline-1 focus:outline-solid"
    >
      {/* An untitled block has no caption row (no empty gap above it). Copy results show in the page's status slot. */}
      {caption && <span className="truncate text-meta text-muted-2">{caption}</span>}
      <CommandBlock
        text={cmd.text}
        {...(cmd.copyText !== undefined ? { copyText: cmd.copyText } : {})}
        tokens={cmd.tokens ?? []}
        highlight={highlight ?? null}
        wrap={!output}
        copyLabel={`Copy command: ${label}`}
        onCopyAction={(button) =>
          copy().then((r) => {
            // Held back with nothing else to take focus: the Copy button keeps it, so ↵ is the second press.
            if (r === "guarded" && (document.activeElement === document.body || document.activeElement === button)) button.focus();
            return r;
          })}
      />
      {known && banned && <p className="m-0 text-meta text-warn">{BANNED}</p>}
      {known && msf && <p className={`m-0 text-meta ${msf.breach ? "text-warn" : "text-muted"}`}>{msf.text}</p>}
    </div>
  );
}
