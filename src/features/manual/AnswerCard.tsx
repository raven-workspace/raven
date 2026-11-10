import { XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { LookupRow } from "../../engines/manual/lookup";
import { resolveLink } from "../../engines/manual/links";
import type { Inline } from "../../engines/manual/markdown";
import { CommandBlock, IconButton } from "../../ui";
import { labelClass } from "../../ui/Label";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { inlineOf, InlineView, type Ctx } from "./NoteView";
import { useManualNotes } from "./useManualNotes";
import { BANNED, useNoteCommand, type FillBase } from "./useNoteCommand";

/** Command rows shown before "+ n more". */
const SHOWN = 3;
/** A ↓ ↑ stop inside the card: a command row or "+ n more". */
const STOP = "[data-card-stop]";

/** An inline value's plain text. */
const plain = (parts: Inline[]): string =>
  parts.map((p) => ("text" in p ? p.text : "code" in p ? p.code : "strong" in p ? plain(p.strong) : "em" in p ? plain(p.em) : p.link.label)).join("");

/**
 * The action cell says more than its commands ("or `faketime`", "disable … AND …", "List the shares it can read:"): a
 * letter or digit is left once its commands and punctuation are taken out.
 */
function hasWords(action: Inline[], commands: string[]): boolean {
  const rest = action.filter((p) => !("code" in p && commands.includes(p.code)));
  return /[\p{L}\p{N}]/u.test(plain(rest));
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
      className="grid gap-1 rounded-sm outline-accent outline-offset-2 outline-none focus:outline-1 focus:outline-solid"
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
      {known && banned && <p className="m-0 text-meta text-warn">{BANNED}</p>}
      {known && msf && <p className={`m-0 text-meta ${msf.breach ? "text-warn" : "text-muted"}`}>{msf.text}</p>}
    </div>
  );
}

/**
 * The lookup row the current search match sits in, pinned above the note: its key, what it means, its usual cause and
 * its action's commands filled for the host in view (three, then "+ n more"). The action cell reads in full under the
 * rows when it says more than its commands, and the row's Arsenal card is one click away. ↓ ↑ move between the command
 * rows while focus is in the card; Esc (handled by the page) closes it.
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
    // `inlineOf` reads only the note and the row title; the fill base is passed to each row on its own.
    [row, note], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
    stops[Math.min(stops.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
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
      className="grid max-h-[40vh] min-w-0 content-start gap-1 overflow-y-auto rounded-sm border border-line bg-surface px-4 py-3"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <span className={labelClass}>Answer</span>
        <span className="truncate text-meta text-muted">{row.tableName}</span>
        {/* Esc is the way to close; the button is for the pointer, so it is no Tab stop. */}
        <IconButton icon={XIcon} label="Close card" shortcut="Esc" tabIndex={-1} onClick={onClose} className="-my-1" />
      </div>
      <p className="m-0 font-mono text-heading text-fg [overflow-wrap:anywhere]">{row.key}</p>
      {row.means.length > 0 && ctx && <p className="m-0 text-body text-fg"><InlineView parts={row.means} ctx={ctx} /></p>}
      {row.cause.length > 0 && ctx && <p className="m-0 text-meta text-muted">Usually: <InlineView parts={row.cause} ctx={ctx} /></p>}
      {shown.length > 0 && (
        <div className="mt-2 grid gap-2">
          {shown.map((c) => <CardCommand key={c.id} command={c} base={base} />)}
          {hidden > 0 && (
            <button
              type="button" data-card-stop="" onClick={() => setMore(true)}
              className="cursor-pointer justify-self-start rounded-sm border-0 bg-transparent p-0 text-meta text-muted-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid"
            >
              + {hidden} more
            </button>
          )}
        </div>
      )}
      {ctx && hasWords(row.action, row.commands) && (
        <p data-card-action="" className="m-0 mt-1 text-meta text-muted-2"><InlineView parts={row.action} ctx={ctx} /></p>
      )}
      {cardId && (
        <p className="m-0 mt-1 text-meta text-muted">
          Card:{" "}
          <button
            type="button" onClick={() => useArsenalStore.getState().openCard(cardId)}
            className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-[inherit] text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid"
          >
            {cardTitle}
          </button>{" "}
          <span className="text-muted-2">↗ Arsenal</span>
        </p>
      )}
    </section>
  );
}
