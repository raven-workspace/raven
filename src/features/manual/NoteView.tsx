import { Fragment, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { classifyExam } from "../../engines/fieldManual/classifyExam";
import type { CardMeta } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { ManualNote } from "../../engines/manual";
import { resolveLink } from "../../engines/manual/links";
import { isInlineCommand, lookupColumns, shortTitle } from "../../engines/manual/lookup";
import { cx } from "../../lib/cx";
import { parseMarkdown, type Block, type Inline } from "../../engines/manual/markdown";
import { matchRanges, matchRegex } from "../../engines/manual/search";
import { highlight } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useFillBase } from "../palette/fillData";
import { InlineCommand } from "./InlineCommand";
import { ManualCommand, type FillBase } from "./ManualCommand";
import { NoteTable } from "./NoteTable";

/** Prose keeps a reading measure; tables, code and commands take the full width of the note pane. */
const PROSE = "m-0 max-w-[56ch] text-read text-fg-2 [text-wrap:pretty]";
/** A caption or bold label opens a group: room above it, close to what it names (none extra right under a heading). */
const LEADS = "mt-4 -mb-1 first:mt-0 [:is(h2,h3,h4)+&]:mt-0";
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
const LINK_CLASS = "text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-accent hover:decoration-accent";

interface Ctx {
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
}

/** Plain text with the search's matches marked. */
const marked = (text: string, re: RegExp | null): ReactNode => (re ? highlight(text, 0, matchRanges(text, re)) : text);

/** Punctuation right after a link: it stays on the link's line (a card link is an inline-block, so a line may break before it). */
const TRAIL = /^[,.;:!?)\]]+/;

function InlineView({ parts, ctx }: { parts: Inline[]; ctx: Ctx }): ReactNode {
  let cut = 0;
  return parts.map((p, i) => {
    if ("text" in p) {
      const text = p.text.slice(cut);
      cut = 0;
      return <Fragment key={i}>{marked(text, ctx.re)}</Fragment>;
    }
    const next = parts[i + 1];
    const trail = "link" in p && next && "text" in next ? TRAIL.exec(next.text)?.[0] : undefined;
    if (!trail) return <InlinePart key={i} p={p} ctx={ctx} />;
    cut = trail.length;
    return <span key={i} className="whitespace-nowrap"><InlinePart p={p} ctx={ctx} />{marked(trail, ctx.re)}</span>;
  });
}

/** One non-text inline part: code, emphasis, or a link (to a note, to a card, or unresolved). */
function InlinePart({ p, ctx }: { p: Exclude<Inline, { text: string }>; ctx: Ctx }): ReactNode {
  if ("code" in p) {
    // A short single token (a status code, a flag, a path) never breaks inside: not at a backslash or dot either.
    if (isInlineCommand(p.code)) return <InlineCommand command={inlineOf(p.code, ctx)} base={ctx.base} highlight={ctx.re} />;
    const token = p.code.length <= TOKEN_MAX && !/\s/.test(p.code);
    return <code className={cx("font-mono text-code text-fg [overflow-wrap:break-word]", token && "whitespace-nowrap")}>{marked(p.code, ctx.re)}</code>;
  }
  if ("strong" in p) return <strong className="font-medium text-fg"><InlineView parts={p.strong} ctx={ctx} /></strong>;
  if ("em" in p) return <em><InlineView parts={p.em} ctx={ctx} /></em>;
  const { target, heading, label } = p.link;
  const to = resolveLink(target, ctx.notes, ctx.cards, heading);
  if (to.kind === "note") {
    return <Link to={`/manual/${encodeURIComponent(to.noteId)}${to.heading ? `#${to.heading}` : ""}`} className={`py-1 ${LINK_CLASS}`}>{marked(label, ctx.re)}</Link>;
  }
  if (to.kind === "card") {
    const card = ctx.cards.find((c) => c.id === to.cardId);
    return (
      <button
        type="button" title={`Open the card ${card?.title ?? label} in the Arsenal`}
        onClick={() => useArsenalStore.getState().openCard(to.cardId)}
        className={`inline-block cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] leading-6 ${LINK_CLASS}`}
      >
        {marked(label, ctx.re)}
      </button>
    );
  }
  // Unresolved: plain muted text, never a dead link.
  return <span className="text-muted">{marked(label, ctx.re)}</span>;
}

/** An inline code span as a library command: it runs from Kali, and logs as its table row, else as its note and section. */
function inlineOf(code: string, ctx: Ctx): LibraryCommand {
  const { note, section, rowTitle } = ctx;
  const command: LibraryCommand = {
    id: `manual:${note.id}:inline:${code}`, title: rowTitle ?? (section ? `${shortTitle(note.title)}: ${section}` : shortTitle(note.title)),
    tool: code.trim().split(/\s+/)[0] ?? "", template: code, os: "any", runFrom: "attacker", goals: [], source: "field-manual",
  };
  const exam = classifyExam(code);
  if (exam) command.exam = exam;
  return command;
}

/** The first line of a code block, shortened: it names a block that has no title. */
const firstLine = (text: string) => {
  const line = text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

const WINDOWS_LANGS = new Set(["cmd", "bat", "batch", "powershell", "ps1", "ps", "pwsh"]);
const LINUX_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

/** Inline Markdown as plain text (a heading's words, markers gone). */
const plain = (parts: Inline[]): string =>
  parts.map((p) => ("text" in p ? p.text : "code" in p ? p.code : "strong" in p ? plain(p.strong) : "em" in p ? plain(p.em) : p.link.label)).join("");

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
function tableNamesOf(blocks: Block[], note: ManualNote): (string | undefined)[] {
  let anchor: string | undefined;
  return blocks.map((b) => {
    if (b.kind === "paragraph" && b.anchor) anchor = b.anchor;
    else if (b.kind === "heading") anchor = undefined;
    if (b.kind !== "table") return undefined;
    const caption = anchor;
    anchor = undefined;
    if (!caption || !lookupColumns(b.head, b.rows)) return undefined;
    return note.outline.find((o) => o.kind === "table" && o.id === caption)?.text || undefined;
  });
}

/** `section`: the nearest `##`/`###` heading above the block, as plain text ("" before the first). */
function BlockView({ block, n, ctx: shared, base, section, tableName }: {
  block: Block; n: number; ctx: Ctx; base: FillBase; section: string; tableName: string | undefined;
}) {
  const ctx: Ctx = { ...shared, section };
  switch (block.kind) {
    case "heading": {
      const inner = <InlineView parts={block.inline} ctx={ctx} />;
      if (block.level === 1) return <h1 id={block.id} className="m-0 mb-2 max-w-[760px] scroll-mt-4 text-read-title text-fg [text-wrap:balance]">{inner}</h1>;
      if (block.level === 2) return <h2 id={block.id} className="m-0 mt-4 max-w-[760px] scroll-mt-4 border-t border-line pt-4 text-title text-fg [text-wrap:balance] first:mt-0 first:border-t-0 first:pt-0 [h1+&]:mt-0 [h1+&]:border-t-0 [h1+&]:pt-0">{inner}</h2>;
      if (block.level === 3) return <h3 id={block.id} className="m-0 mt-4 max-w-[760px] scroll-mt-4 text-heading text-fg [text-wrap:balance] first:mt-0">{inner}</h3>;
      return <h4 id={block.id} className="m-0 mt-2 max-w-[760px] scroll-mt-4 text-body font-semibold text-fg first:mt-0">{inner}</h4>;
    }
    case "paragraph":
      return (
        <p id={block.anchor} className={block.anchor ? `m-0 max-w-[760px] scroll-mt-4 text-heading text-fg [text-wrap:balance] ${LEADS}` : isLabel(block.inline) ? `${PROSE} ${LEADS} [&_strong]:font-semibold` : PROSE}>
          <InlineView parts={block.inline} ctx={ctx} />
          {/* A caption's note after its bold name reads as body text, not as part of the heading. */}
          {block.trail && <span className="text-body font-normal text-muted-2"> <InlineView parts={block.trail} ctx={ctx} /></span>}
        </p>
      );
    case "list": {
      const items = block.items.map((it, i) => <li key={i}><InlineView parts={it} ctx={ctx} /></li>);
      const cls = `${PROSE} grid gap-2 pl-6 marker:text-muted`;
      return block.ordered ? <ol className={`${cls} list-decimal`}>{items}</ol> : <ul className={`${cls} list-disc`}>{items}</ul>;
    }
    case "table":
      return (
        <NoteTable
          head={block.head} rows={block.rows}
          cell={(parts, row) => {
            const key = tableName && row !== undefined ? plain(block.rows[row]?.[0] ?? []).trim() : null;
            return <InlineView parts={parts} ctx={key === null ? ctx : { ...ctx, rowTitle: `${tableName}: ${key}` }} />;
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
 * code blocks as commands filled for the host in view. `query` is the search the note was opened from.
 */
export function NoteView({ note, notes, cards, hostId, engagementId, query }: {
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
    <article aria-label={note.title} className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 [&_[tabindex='-1']]:outline-none">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} n={b.kind === "code" ? code++ : -1} ctx={ctx} base={base} section={sections[i] ?? ""} tableName={tableNames[i]} />
      ))}
    </article>
  );
}
