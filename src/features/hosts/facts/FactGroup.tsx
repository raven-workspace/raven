import { ArrowUpRightIcon, CaretDownIcon, CaretRightIcon, type Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Toolbar, labelClass } from "../../../ui";

/**
 * One cell of a folded group's summary. With an `icon` it is a count (the label is its accessible name and tooltip);
 * without one it reads as a small labelled pair, e.g. "entry  nginx 80".
 */
export function SummaryCell({ label, icon: Glyph, tone, children }: {
  label: string;
  icon?: Icon;
  tone?: "accent" | "warn";
  children: ReactNode;
}) {
  const colour = tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-fg-2";
  return (
    <span data-summary-cell title={label} className="inline-grid min-w-0 grid-flow-col items-center gap-1 whitespace-nowrap">
      {Glyph ? (
        <>
          <Glyph size={16} weight="regular" aria-hidden className={colour} />
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <span className="text-muted-2">{label}</span>
      )}
      <span className="min-w-0 truncate text-fg-2">{children}</span>
    </span>
  );
}

/**
 * One fact group. Folded, it is a single line (the title and its summary cells) that opens in place; open, a labelled
 * header (which folds it again) over the group's content. `shortcut` is named in the toggle's tooltip.
 */
export function FactGroup({ title, summary, open, onToggle, shortcut, actions, children }: {
  title: string;
  /** The folded line's cells (SummaryCell), or a plain note such as "couldn't load". Nothing while loading. */
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  shortcut?: string;
  /** Header controls shown while open (add, edit). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const hint = shortcut ? ` (${shortcut})` : "";
  if (!open) {
    return (
      <section aria-label={title}>
        <button
          type="button"
          aria-expanded={false}
          title={`Open ${title}${hint}`}
          onClick={onToggle}
          className="grid min-h-8 w-full cursor-default grid-cols-[auto_minmax(0,1fr)_16px] items-center gap-3 border-b border-line py-1 text-left text-meta text-fg-2 hover:text-fg"
        >
          <span>{title}</span>
          <span className="grid min-w-0 grid-flow-col items-center justify-start gap-3 overflow-hidden text-muted">{summary}</span>
          <CaretRightIcon size={16} weight="regular" aria-hidden />
        </button>
      </section>
    );
  }
  return (
    <section aria-label={title} className="grid gap-2 pb-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line pb-1">
        <button
          type="button"
          aria-expanded
          title={`Fold ${title}${hint}`}
          onClick={onToggle}
          className="grid min-h-7 min-w-0 cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-2 text-left hover:text-fg"
        >
          <CaretDownIcon size={16} weight="regular" aria-hidden className="text-muted" />
          <h2 className={`${labelClass} m-0 truncate`}>{title}</h2>
        </button>
        {actions && <Toolbar>{actions}</Toolbar>}
      </header>
      {children}
    </section>
  );
}

/** A link to the log entry that proves a fact: the arrow, then the entry's name (truncated, full title on hover). */
export function EntryLink({ title, label = title, onClick, className }: {
  title: string;
  label?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid min-h-7 min-w-0 cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-1 text-left text-meta text-fg-2 underline-offset-2 hover:text-fg hover:underline ${className ?? ""}`}
    >
      <ArrowUpRightIcon size={16} weight="regular" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}
