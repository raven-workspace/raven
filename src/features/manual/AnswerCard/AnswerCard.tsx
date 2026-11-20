import { XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getCards, useLibraryVersion } from "../../../engines/library/store";
import type { LibraryCommand } from "../../../engines/library/types";
import type { LookupRow } from "../../../engines/manual/lookup";
import { resolveLink } from "../../../engines/manual/links";
import type { Inline } from "../../../engines/manual/markdown";
import { CommandBlock, IconButton } from "../../../ui/index";
import { labelClass } from "../../../ui/Label";
import { useArsenalStore } from "../../arsenal/useArsenalStore";
import { inlineOf, InlineView, type Ctx } from "../NoteView/NoteView";
import { useManualNotes } from "../useManualNotes";
import { BANNED, useNoteCommand, type FillBase } from "../useNoteCommand";
import { cx } from "../../../lib/cx";
import "../ManualCommand/ManualCommand.scss";
import "./AnswerCard.scss";

/** Command rows shown before "+ n more". */
const SHOWN = 3;
/** A ↓ ↑ stop inside the card: a command row or "+ n more". */
const STOP = "[data-card-stop]";

/** An inline value's plain text. */
const plain = (parts: Inline[]): string =>
  parts.map((p) => ("text" in p ? p.text : "code" in p ? p.code : "strong" in p ? plain(p.strong) : "em" in p ? plain(p.em) : p.link.label)).join("");

/**
 * What the action cell says besides its commands (they have rows of their own): links and single-token code stay, the
 * text left between removed commands has its orphaned separators folded ("or , then" reads "or, then", "it: , then" reads "it: then"), and separators
 * at either end go. Null when nothing but punctuation is left.
 */
function leftover(action: Inline[], commands: string[]): Inline[] | null {
  const kept: Inline[] = [];
  for (const p of action) {
    if ("code" in p && commands.includes(p.code)) continue;
    const last = kept[kept.length - 1];
    if ("text" in p && last && "text" in last) kept[kept.length - 1] = { text: last.text + p.text };
    else kept.push(p);
  }
  const out = kept
    .map((p, i) => {
      if (!("text" in p)) return p;
      let t = p.text.replace(/\s*([:,;])(?:\s*[,;])+\s*|\s*([,;])\s*/g, (_, a: string | undefined, b: string | undefined) => `${a ?? b} `).replace(/\s{2,}/g, " ");
      if (i === 0) t = t.replace(/^[\s,;]+/, "");
      if (i === kept.length - 1) t = t.replace(/[\s,;]+$/, "");
      return { text: t };
    })
    .filter((p) => !("text" in p) || p.text !== "");
  return /[\p{L}\p{N}]/u.test(plain(out)) ? out : null;
}

/** One of the row's commands: filled for the host in view, one focus stop; ↵ copies, ⌘↵ copies and logs. */
function CardCommand({ command, base }: { command: LibraryCommand; base: FillBase }) {
  const root = useRef<HTMLDivElement>(null);
  const { cmd, copy, copyAndLog, banned, msf, known } = useNoteCommand(command, { fill: true, output: false, base });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
      ref={root} role="group" aria-label={`Answer command: ${cmd.text}`} tabIndex={0} onKeyDown={onKeyDown} data-card-stop=""
      className="manual-command manual-command--tight"
    >
      <CommandBlock
        text={cmd.text}
        {...(cmd.copyText !== undefined ? { copyText: cmd.copyText } : {})}
        tokens={cmd.tokens ?? []}
        copyLabel={`Copy command: ${cmd.text}`}
        onCopyAction={(button) =>
          copy().then((r) => {
            if (r === "guarded" && (document.activeElement === document.body || document.activeElement === button)) button.focus();
            return r;
          })}
      />
      {known && banned && <p className="manual-command__rule manual-command__rule--warn">{BANNED}</p>}
      {known && msf && <p className={cx("manual-command__rule", msf.breach && "manual-command__rule--warn")}>{msf.text}</p>}
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
  useLibraryVersion();
  const cards = getCards();
  const note = notes.find((n) => n.id === row.noteId);
  const [more, setMore] = useState(false);
  const rowTitle = `${row.tableName}: ${row.key}`;
  const ctx: Ctx | null = note ? { note, notes, cards, re: null, base, section: "", rowTitle } : null;
  const commands = useMemo(
    () => (note ? row.commands.map((c) => inlineOf(c, { note, notes: [], cards: [], re: null, base, section: "", rowTitle })) : []),
    // Complete: `inlineOf` reads only `ctx.note` and `ctx.rowTitle` (the id, the log title, the exam rule), and the
    // row title comes from `row`; `base` is not read here (each CardCommand fills with the live base it is given).
    [row, note], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
          {/* The same command can sit twice in one cell: the index keeps the keys apart. */}
          {shown.map((c, i) => <CardCommand key={`${i}:${c.id}`} command={c} base={base} />)}
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
