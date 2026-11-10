import { Fragment, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { classifyExam } from "../../engines/fieldManual/classifyExam";
import type { CardMeta } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { ManualNote } from "../../engines/manual";
import { resolveLink } from "../../engines/manual/links";
import { cx } from "../../lib/cx";
import { parseMarkdown, type Block, type Inline } from "../../engines/manual/markdown";
import { matchRanges, matchRegex } from "../../engines/manual/search";
import { highlight } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useFillBase } from "../palette/fillData";
import { ManualCommand, type FillBase } from "./ManualCommand";
import { NoteTable } from "./NoteTable";

/** Prose keeps a reading measure; tables, code and commands take the full width of the note pane. */
const PROSE = "m-0 max-w-[760px] text-body/6 text-fg-2";
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
}

/** Plain text with the search's matches marked. */
const marked = (text: string, re: RegExp | null): ReactNode => (re ? highlight(text, 0, matchRanges(text, re)) : text);

function InlineView({ parts, ctx }: { parts: Inline[]; ctx: Ctx }): ReactNode {
  return parts.map((p, i) => {
    if ("text" in p) return <Fragment key={i}>{marked(p.text, ctx.re)}</Fragment>;
    if ("code" in p) {
      // A short single token (a status code, a flag, a path) never breaks inside: not at a backslash or dot either.
      const token = p.code.length <= TOKEN_MAX && !/\s/.test(p.code);
      return <code key={i} className={cx("font-mono text-code text-fg [overflow-wrap:break-word]", token && "whitespace-nowrap")}>{marked(p.code, ctx.re)}</code>;
    }
    if ("strong" in p) return <strong key={i} className="font-semibold text-fg"><InlineView parts={p.strong} ctx={ctx} /></strong>;
    if ("em" in p) return <em key={i}><InlineView parts={p.em} ctx={ctx} /></em>;
    const { target, heading, label } = p.link;
    const to = resolveLink(target, ctx.notes, ctx.cards, heading);
    if (to.kind === "note") {
      return <Link key={i} to={`/manual/${encodeURIComponent(to.noteId)}${to.heading ? `#${to.heading}` : ""}`} className={`py-1 ${LINK_CLASS}`}>{marked(label, ctx.re)}</Link>;
    }
    if (to.kind === "card") {
      const card = ctx.cards.find((c) => c.id === to.cardId);
      return (
        <button
          key={i} type="button" title={`Open the card ${card?.title ?? label} in the Arsenal`}
          onClick={() => useArsenalStore.getState().openCard(to.cardId)}
          className={`inline-block cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] leading-6 ${LINK_CLASS}`}
        >
          {marked(label, ctx.re)}
        </button>
      );
    }
    // Unresolved: plain muted text, never a dead link.
    return <span key={i} className="text-muted">{marked(label, ctx.re)}</span>;
  });
}

/** The first line of a code block, shortened: it names a block that has no title. */
const firstLine = (text: string) => {
  const line = text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

function BlockView({ block, n, ctx, base }: { block: Block; n: number; ctx: Ctx; base: FillBase }) {
  switch (block.kind) {
    case "heading": {
      const inner = <InlineView parts={block.inline} ctx={ctx} />;
      if (block.level === 1) return <h1 id={block.id} className="m-0 max-w-[760px] scroll-mt-4 text-title text-fg">{inner}</h1>;
      if (block.level === 2) return <h2 id={block.id} className="m-0 mt-4 max-w-[760px] scroll-mt-4 text-title text-fg">{inner}</h2>;
      if (block.level === 3) return <h3 id={block.id} className="m-0 mt-2 max-w-[760px] scroll-mt-4 text-heading text-fg">{inner}</h3>;
      return <h4 id={block.id} className="m-0 mt-1 max-w-[760px] scroll-mt-4 text-body font-semibold text-fg">{inner}</h4>;
    }
    case "paragraph":
      return (
        <p id={block.anchor} className={block.anchor ? "m-0 mt-2 max-w-[760px] scroll-mt-4 text-heading text-fg" : PROSE}>
          <InlineView parts={block.inline} ctx={ctx} />
          {/* A caption's note after its bold name reads as body text, not as part of the heading. */}
          {block.trail && <span className="text-body text-muted-2"> <InlineView parts={block.trail} ctx={ctx} /></span>}
        </p>
      );
    case "list": {
      const items = block.items.map((it, i) => <li key={i}><InlineView parts={it} ctx={ctx} /></li>);
      const cls = `${PROSE} grid gap-1 pl-6 marker:text-muted`;
      return block.ordered ? <ol className={`${cls} list-decimal`}>{items}</ol> : <ul className={`${cls} list-disc`}>{items}</ul>;
    }
    case "table":
      return <NoteTable head={block.head} rows={block.rows} cell={(parts) => <InlineView parts={parts} ctx={ctx} />} />;
    case "code": {
      const command: LibraryCommand = {
        id: `manual:${ctx.note.id}:${n}`, title: block.title ?? ctx.note.title, tool: block.text.trim().split(/\s+/)[0] ?? "",
        template: block.text, os: "any", runFrom: "attacker", goals: [], source: "field-manual",
      };
      const output = OUTPUT_LANGS.has(block.lang.toLowerCase());
      const exam = output ? undefined : classifyExam(block.text);
      if (exam) command.exam = exam;
      return (
        <ManualCommand
          command={command} label={block.title ?? firstLine(block.text)} caption={block.title}
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
  const ctx: Ctx = { note, notes, cards, re };
  let code = 0;
  return (
    <article aria-label={note.title} className="grid grid-cols-[minmax(0,1fr)] content-start gap-3">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} n={b.kind === "code" ? code++ : -1} ctx={ctx} base={base} />
      ))}
    </article>
  );
}
