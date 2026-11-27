import { XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLibrary } from "../../../engines/library/store";
import type { LibraryCommand } from "../../../engines/library/types";
import { leftover, type LookupRow } from "../../../engines/manual/lookup";
import { resolveLink } from "../../../engines/manual/links";
import { CommandBlock, IconButton } from "../../../ui/index";
import { labelClass } from "../../../ui/Label";
import { useArsenalStore } from "../../arsenal/useArsenalStore";
import { lookupCommands } from "../../../engines/manual/commands";
import { InlineView, type Ctx } from "../NoteView/NoteView";
import { useManualNotes } from "../useManualNotes";
import { ExamLine } from "../ManualCommand/ManualCommand";
import { useNoteCommand, type FillBase } from "../useNoteCommand";
import "../ManualCommand/ManualCommand.scss";
import "./AnswerCard.scss";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";

/** Command rows shown before "+ n more". */
const SHOWN = 3;
/** A ↓ ↑ stop inside the card: a command row or "+ n more". */
const STOP = "[data-card-stop]";

/** One of the row's commands: filled for the host in view, one focus stop; ↵ copies, ⌘↵ copies and logs. */
function CardCommand({ command, base }: { command: LibraryCommand; base: FillBase }) {
  const root = useRef<HTMLDivElement>(null);
  const { cmd, copy, copyAndLog, examLine } = useNoteCommand(command, { fill: true, output: false, base });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
      ref={root} role="group" aria-label={`Answer command: ${cmd.shown}`} tabIndex={0} onKeyDown={onKeyDown} data-card-stop=""
      className="manual-command manual-command--tight"
    >
      <CommandBlock
        text={cmd.shown}
        tokens={cmd.tokens ?? []}
        copyLabel={`Copy command: ${cmd.shown}`}
        onCopyAction={(button) =>
          copy().then((r) => {
            if (r === "guarded" && (document.activeElement === document.body || document.activeElement === button)) button.focus();
            return r;
          })}
      />
      <ExamLine line={examLine} />
    </div>
  );
}

/**
 * The lookup row the current search match sits in, pinned above the note: its key, what it means, its usual cause and
 * its action's commands filled for the host in view (three, then "+ n more"). The action cell reads in full under the
 * rows when it says more than its commands, and the row's Arsenal card is one click away. ↓ ↑ move between the command
 * rows while focus is in the card (↓ onto "+ n more" opens it); Esc (handled by the page) closes it.
 */
export function AnswerCard({ row, base, onClose }: { row: LookupRow; base: FillBase; onClose(): void }) {
  const { notes } = useManualNotes();
  const { cards } = useLibrary();
  const note = notes.find((n) => n.id === row.noteId);
  const [more, setMore] = useState(false);
  const rowTitle = `${row.tableName}: ${row.key}`;
  const ctx: Ctx | null = note ? { note, notes, cards, re: null, base, section: "", rowTitle } : null;
  // The row's commands as ⌘K offers them: the same objects, ids and exam classification every render (memoized per row).
  const commands = note ? lookupCommands(row) : [];
  const rest = useMemo(() => leftover(row.action, row.commands), [row]);
  const shown = more ? commands : commands.slice(0, SHOWN);
  const hidden = commands.length - shown.length;
  const link = row.card ? resolveLink(row.card.target, notes, cards, row.card.heading) : null;
  const cardId = link?.kind === "card" ? link.cardId : null;
  const cardTitle = cardId ? (cards.find((c) => c.id === cardId)?.title ?? row.card?.label ?? "") : "";

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const stops = [...e.currentTarget.querySelectorAll<HTMLElement>(STOP)];
    const at = stops.findIndex((s) => s === document.activeElement || s.contains(document.activeElement));
    if (at < 0) return;
    e.preventDefault();
    const next = stops[Math.min(stops.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    // ↓ onto "+ n more" opens it: focus lands on the first command it brings in (the effect below), so ↓ carries on.
    if (e.key === "ArrowDown" && next?.dataset.cardMore !== undefined) setMore(true);
    else next?.focus();
  };

  const rootRef = useRef<HTMLElement>(null);
  /** "+ n more" was activated: focus moves onto the first row it brings in, so ↓ carries on down the list. */
  const moved = useRef(false);
  useEffect(() => {
    if (!more || moved.current) return;
    moved.current = true;
    rootRef.current?.querySelectorAll<HTMLElement>(STOP)[SHOWN]?.focus();
  }, [more]);

  return (
    <section
      ref={rootRef} aria-label="Answer" onKeyDown={onKeyDown}
      className="answer-card"
    >
      <div className="answer-card__head">
        <span className={labelClass}>Answer</span>
        <span className="answer-card__table">{row.tableName}</span>
        {/* Esc is the way to close; the button is for the pointer, so it is no Tab stop. */}
        <IconButton icon={XIcon} label="Close card" shortcut="Esc" tabIndex={-1} onClick={onClose} className="answer-card__close" />
      </div>
      <p className="answer-card__key">{row.key}</p>
      {row.means.length > 0 && ctx && <p className="answer-card__means"><InlineView parts={row.means} ctx={ctx} /></p>}
      {row.cause.length > 0 && ctx && <p className="answer-card__cause">Usually: <InlineView parts={row.cause} ctx={ctx} /></p>}
      {shown.length > 0 && (
        <div className="answer-card__commands">
          {/* A command's id carries its place in the cell, so the same command twice keeps two keys. */}
          {shown.map((c) => <CardCommand key={c.id} command={c} base={base} />)}
          {hidden > 0 && (
            <button
              type="button" data-card-stop="" data-card-more="" onClick={() => setMore(true)}
              className="answer-card__more"
            >
              + {hidden} more
            </button>
          )}
        </div>
      )}
      {ctx && rest && (
        <p data-card-action="" className="answer-card__action"><InlineView parts={rest} ctx={ctx} /></p>
      )}
      {cardId && (
        <p className="answer-card__card">
          Card:{" "}
          <button
            type="button" onClick={() => useArsenalStore.getState().openCard(cardId, undefined, { from: "manual" })}
            className="answer-card__card-link"
          >
            {cardTitle}
          </button>{" "}
          <span className="answer-card__arsenal">↗ Arsenal</span>
        </p>
      )}
    </section>
  );
}
