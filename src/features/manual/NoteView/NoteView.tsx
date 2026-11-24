import { Fragment, memo, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { classifyExam } from "../../../engines/fieldManual/classifyExam";
import type { CardMeta } from "../../../engines/library/store";
import type { LibraryCommand } from "../../../engines/library/types";
import type { ManualNote } from "../../../engines/manual/index";
import { resolveLink } from "../../../engines/manual/links";
import { isInlineCommand, lookupColumns, plain, shortTitle } from "../../../engines/manual/lookup";
import { cx } from "../../../lib/cx";
import { parseMarkdown, type Block, type Inline } from "../../../engines/manual/markdown";
import { maskPlaceholders, matchRanges, matchRegex } from "../../../engines/manual/search";
import { highlight } from "../../../ui/index";
import { useArsenalStore } from "../../arsenal/useArsenalStore";
import { useFillBase } from "../../palette/fillData";
import { InlineCommand } from "../InlineCommand/InlineCommand";
import { ManualCommand, type FillBase } from "../ManualCommand/ManualCommand";
import { NoteTable } from "../NoteTable/NoteTable";
import "./NoteView.scss";

/** Prose keeps a reading measure; tables, code and commands take the full width of the note pane. */
const PROSE = "note-view__prose";
/** A caption or bold label opens a group: room above it, close to what it names (none extra right under a heading). */
const LEADS = "note-view__leads";
/** A paragraph that is only bold text (with at most a closing colon or full stop) labels what follows it. */
const isLabel = (parts: Inline[]) => {
  const solid = parts.filter((p) => !("text" in p) || p.text.trim() !== "");
  if (!solid.length || !("strong" in solid[0])) return false;
  return solid.slice(1).every((p) => "text" in p && /^[:.]$/.test(p.text.trim()));
};
const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9_]*\}/;
/** Fence languages that hold output to read, not a command to run: Copy only (no fill, no log, no exam rule). */
const OUTPUT_LANGS = new Set(["text", "txt", "output", "console", "plaintext", "plain"]);
/** Inline code up to this length with no space is one token: it keeps to one line (the narrowest line holds 40 characters). */
const TOKEN_MAX = 40;
const LINK_CLASS = "note-view__link";

export interface Ctx {
  note: ManualNote;
  notes: ManualNote[];
  cards: CardMeta[];
  /** The search the note was opened from: its matches are marked. */
  re: RegExp | null;
  base: FillBase;
  /** The `##`/`###` section the text sits in ("" before the first): the log title of an inline command. */
  section: string;
  /** Set in a row of a lookup table: the log title of its inline commands ("Table name: key"). */
  rowTitle?: string;
  /** Set in a table's key cell: its code is plain code, never an inline command. */
  plainCode?: boolean;
}

/** Punctuation right after a link: it stays on the link's line (a card link is an inline-block, so a line may break before it). */
const TRAIL = /^[,.;:!?)\]]+/;

/** Stands for an inline command in a run's text: it marks its own matches, on its filled text, so none crosses into it. */
const OPAQUE = "\u0000";

const isCommand = (code: string, ctx: Ctx) => !ctx.plainCode && isInlineCommand(code);

/** Where a link goes and the title it shows: its alias, else the title of what it points at (never its file name). */
function linkOf(link: { target: string; heading?: string; label: string }, ctx: Ctx) {
  const { target, heading, label } = link;
  const to = resolveLink(target, ctx.notes, ctx.cards, heading);
  const aliased = label !== target;
  if (to.kind === "note") return { to, title: aliased ? label : shortTitle(ctx.notes.find((n) => n.id === to.noteId)?.title ?? label) };
  if (to.kind === "card") {
    const card = ctx.cards.find((c) => c.id === to.cardId);
    return { to, title: aliased ? label : (card?.title ?? label), cardTitle: card?.title ?? label };
  }
  return { to, title: aliased ? label : label.replace(/-/g, " ") };
}

/** The text one inline part shows, as the run's matches are found in it. */
const shownOf = (p: Inline, ctx: Ctx): string =>
  "text" in p ? p.text
    : "code" in p ? (isCommand(p.code, ctx) ? OPAQUE : p.code)
    : "strong" in p ? p.strong.map((q) => shownOf(q, ctx)).join("")
    : "em" in p ? p.em.map((q) => shownOf(q, ctx)).join("")
    : linkOf(p.link, ctx).title;

/** The search's matches in one inline run, as `[start, end)` offsets into the run's shown text. */
type Ranges = [number, number][];

/** Text that starts at `at` in its run, with the run's matches marked (a match across parts is marked in each piece). */
const marked = (text: string, at: number, ranges: Ranges): ReactNode => (ranges.length > 0 ? highlight(text, at, ranges) : text);

/**
 * An inline run with the search's matches marked. Matches are found in the run's whole shown text, so a phrase that
 * crosses bold, a link or a code span is one match; placeholders never match, as in ⌘K's search.
 */
export function InlineView({ parts, ctx }: { parts: Inline[]; ctx: Ctx }): ReactNode {
  const ranges = ctx.re ? matchRanges(maskPlaceholders(parts.map((p) => shownOf(p, ctx)).join("")), ctx.re) : [];
  return <Run parts={parts} ctx={ctx} at={0} ranges={ranges} />;
}

function Run({ parts, ctx, at, ranges }: { parts: Inline[]; ctx: Ctx; at: number; ranges: Ranges }): ReactNode {
  const starts: number[] = [];
  let pos = at;
  for (const p of parts) {
    starts.push(pos);
    pos += shownOf(p, ctx).length;
  }
  let cut = 0;
  return parts.map((p, i) => {
    const start = starts[i]!;
    if ("text" in p) {
      const text = p.text.slice(cut);
      const from = start + cut;
      cut = 0;
      return <Fragment key={i}>{marked(text, from, ranges)}</Fragment>;
    }
    const next = parts[i + 1];
    const trail = "link" in p && next && "text" in next ? TRAIL.exec(next.text)?.[0] : undefined;
    if (!trail) return <InlinePart key={i} p={p} ctx={ctx} at={start} ranges={ranges} />;
    cut = trail.length;
    return (
      <span key={i} className="note-view__nowrap">
        <InlinePart p={p} ctx={ctx} at={start} ranges={ranges} />{marked(trail, starts[i + 1]!, ranges)}
      </span>
    );
  });
}

/** One non-text inline part, starting at `at` in its run: code, emphasis, or a link (to a note, to a card, or unresolved). */
function InlinePart({ p, ctx, at, ranges }: { p: Exclude<Inline, { text: string }>; ctx: Ctx; at: number; ranges: Ranges }): ReactNode {
  if ("code" in p) {
    // A short single token (a status code, a flag, a path) never breaks inside: not at a backslash or dot either.
    if (isCommand(p.code, ctx)) return <InlineCommand command={inlineOf(p.code, ctx)} base={ctx.base} highlight={ctx.re} />;
    const token = p.code.length <= TOKEN_MAX && !/\s/.test(p.code);
    return <code className={cx("note-view__code", token && "note-view__code--token")}>{marked(p.code, at, ranges)}</code>;
  }
  if ("strong" in p) return <strong className="note-view__strong"><Run parts={p.strong} ctx={ctx} at={at} ranges={ranges} /></strong>;
  if ("em" in p) return <em><Run parts={p.em} ctx={ctx} at={at} ranges={ranges} /></em>;
  const { to, title, cardTitle } = linkOf(p.link, ctx);
  if (to.kind === "note") {
    return <Link to={`/manual/${encodeURIComponent(to.noteId)}${to.heading ? `#${to.heading}` : ""}`} className={`${LINK_CLASS} note-view__note-link`}>{marked(title, at, ranges)}</Link>;
  }
  if (to.kind === "card") {
    return (
      <button
        type="button" title={`Open the card ${cardTitle} in the Arsenal`}
        onClick={() => useArsenalStore.getState().openCard(to.cardId, undefined, { from: "manual" })}
        className={`${LINK_CLASS} note-view__card-link`}
      >
        {marked(title, at, ranges)}
      </button>
    );
  }
  // Unresolved: plain muted text, never a dead link.
  return <span className="note-view__unresolved">{marked(title, at, ranges)}</span>;
}

/** Each note's inline commands, by log title and code: the same object every render, so their fill is not redone. */
const inlineCache = new WeakMap<ManualNote, Map<string, LibraryCommand>>();

/**
 * An inline code span as a library command: it runs from Kali, and logs as its table row, else as its note and section.
 * Memoized per note, code and log title (a re-render hands `useNoteCommand` the same command, so its fill is kept).
 */
export function inlineOf(code: string, ctx: Ctx): LibraryCommand {
  const { note, section, rowTitle } = ctx;
  const title = rowTitle ?? (section ? `${shortTitle(note.title)}: ${section}` : shortTitle(note.title));
  let byNote = inlineCache.get(note);
  if (!byNote) inlineCache.set(note, (byNote = new Map()));
  const key = `${title}\u0000${code}`;
  const known = byNote.get(key);
  if (known) return known;
  const command: LibraryCommand = {
    id: `manual:${note.id}:inline:${code}`, title,
    tool: code.trim().split(/\s+/)[0] ?? "", template: code, os: "any", runFrom: "attacker", goals: [], source: "field-manual",
  };
  const exam = classifyExam(code);
  if (exam) command.exam = exam;
  byNote.set(key, command);
  return command;
}

/** The first line of a code block, shortened: it names a block that has no title. */
const firstLine = (text: string) => {
  const line = text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

const WINDOWS_LANGS = new Set(["cmd", "bat", "batch", "powershell", "ps1", "ps", "pwsh"]);
const LINUX_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

/**
 * A code block as a library command. The fence title is where it runs, as on a card (`parseCard`): `Kali…` is the
 * attacker, any other title (`Target — PowerShell`, `Pivot — bash`) the target. An untitled block runs from Kali,
 * unless its language is a Windows shell (Kali has none): then it runs on the target. The fence language gives the OS
 * (Windows shells, Unix shells off Kali), and the log title is the section it sits in.
 */
function commandOf(block: Extract<Block, { kind: "code" }>, note: ManualNote, n: number, section: string): LibraryCommand {
  const lang = block.lang.toLowerCase();
  const kali = block.title ? /^kali\b/i.test(block.title) : !WINDOWS_LANGS.has(lang);
  const os = WINDOWS_LANGS.has(lang) ? "windows" : LINUX_LANGS.has(lang) && !kali ? "linux" : "any";
  return {
    id: `manual:${note.id}:${n}`,
    title: section ? `${shortTitle(note.title)}: ${section}` : shortTitle(note.title), tool: block.text.trim().split(/\s+/)[0] ?? "",
    template: block.text, os, runFrom: kali ? "attacker" : "target", goals: [], source: "field-manual",
  };
}

/** Each block's section: the nearest `##`/`###` heading at or above it, as plain text ("" before the first). */
function sectionsOf(blocks: Block[]): string[] {
  const out: string[] = [];
  let at = "";
  for (const b of blocks) {
    if (b.kind === "heading" && (b.level === 2 || b.level === 3)) at = plain(b.inline).trim();
    out.push(at);
  }
  return out;
}

/**
 * Each block's table name: a caption's name carries to the next table across code, paragraphs and lists, and a heading
 * ends its reach (the same rule as the lookup engine). Only a lookup table has one.
 */
function tableNamesOf(blocks: Block[], note: ManualNote): { name: string | undefined; anchor: string | undefined }[] {
  let anchor: string | undefined;
  return blocks.map((b) => {
    if (b.kind === "paragraph" && b.anchor) anchor = b.anchor;
    else if (b.kind === "heading") anchor = undefined;
    if (b.kind !== "table") return { name: undefined, anchor: undefined };
    const caption = anchor;
    anchor = undefined;
    if (!caption || !lookupColumns(b.head, b.rows)) return { name: undefined, anchor: caption };
    return { name: note.outline.find((o) => o.kind === "table" && o.id === caption)?.text || undefined, anchor: caption };
  });
}

/** `section`: the nearest `##`/`###` heading above the block, as plain text ("" before the first). */
function BlockView({ block, n, ctx: shared, base, section, tableName, tableAnchor }: {
  block: Block; n: number; ctx: Ctx; base: FillBase; section: string; tableName: string | undefined; tableAnchor: string | undefined;
}) {
  const ctx: Ctx = { ...shared, section };
  switch (block.kind) {
    case "heading": {
      const inner = <InlineView parts={block.inline} ctx={ctx} />;
      if (block.level === 1) return <h1 id={block.id} className="note-view__h1">{inner}</h1>;
      if (block.level === 2) return <h2 id={block.id} className="note-view__h2">{inner}</h2>;
      if (block.level === 3) return <h3 id={block.id} className="note-view__h3">{inner}</h3>;
      return <h4 id={block.id} className="note-view__h4">{inner}</h4>;
    }
    case "paragraph":
      return (
        <p id={block.anchor} className={block.anchor ? `note-view__caption ${LEADS}` : isLabel(block.inline) ? `${PROSE} ${LEADS} note-view__label` : PROSE}>
          <InlineView parts={block.inline} ctx={ctx} />
          {/* A caption's note after its bold name reads as body text, not as part of the heading. */}
          {block.trail && <span className="note-view__trail"> <InlineView parts={block.trail} ctx={ctx} /></span>}
        </p>
      );
    case "list": {
      const items = block.items.map((it, i) => <li key={i}><InlineView parts={it} ctx={ctx} /></li>);
      const cls = `${PROSE} note-view__list`;
      return block.ordered ? <ol className={`${cls} note-view__list--ordered`}>{items}</ol> : <ul className={`${cls} note-view__list--bullets`}>{items}</ul>;
    }
    case "table":
      return (
        <NoteTable
          head={block.head} rows={block.rows} anchor={tableAnchor}
          cell={(parts, row, isKey) => {
            const key = tableName && row !== undefined ? plain(block.rows[row]?.[0] ?? []).trim() : null;
            const rowCtx = key === null ? ctx : { ...ctx, rowTitle: `${tableName}: ${key}` };
            return <InlineView parts={parts} ctx={isKey ? { ...rowCtx, plainCode: true } : rowCtx} />;
          }}
        />
      );
    case "code": {
      const command = commandOf(block, ctx.note, n, section);
      const output = OUTPUT_LANGS.has(block.lang.toLowerCase());
      const exam = output ? undefined : classifyExam(block.text);
      if (exam) command.exam = exam;
      const line = firstLine(block.text);
      return (
        <ManualCommand
          command={command} label={section && line ? `${section}: ${line}` : line || command.title} caption={block.title}
          fill={!output && PLACEHOLDER.test(block.text)} output={output} base={base} highlight={ctx.re}
        />
      );
    }
  }
}

/**
 * A Manual note as a reading view: its Markdown as React elements (never injected HTML), its `[[links]]` resolved (a
 * note opens in the Manual at its heading, a card opens in the Arsenal drawer, anything else is muted text), and its
 * code blocks as commands filled for the host in view. `query` is the search the note was opened from. Memoized: the
 * Reader re-renders on every match step, focus change and card; the note re-renders only when its props change (its
 * own fill data still re-renders it).
 */
export const NoteView = memo(function NoteView({ note, notes, cards, hostId, engagementId, query }: {
  note: ManualNote; notes: ManualNote[]; cards: CardMeta[]; hostId: string | null; engagementId: string; query?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(note.body), [note.body]);
  const base = useFillBase(engagementId, hostId);
  const re = useMemo(() => (query ? matchRegex(query) : null), [query]);
  const ctx: Ctx = { note, notes, cards, re, base, section: "" };
  const sections = useMemo(() => sectionsOf(blocks), [blocks]);
  const tableNames = useMemo(() => tableNamesOf(blocks, note), [blocks, note]);
  let code = 0;
  return (
    <article aria-label={note.title} className="note-view">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} n={b.kind === "code" ? code++ : -1} ctx={ctx} base={base} section={sections[i] ?? ""} tableName={tableNames[i]?.name} tableAnchor={tableNames[i]?.anchor} />
      ))}
    </article>
  );
});
