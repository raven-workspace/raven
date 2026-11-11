import { ArrowUpRightIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Collapse, Toolbar, labelClass } from "../../../ui";

/**
 * One phrase of a folded group's summary, written so it reads on its own: a count before its noun ("3 confirmed"),
 * or a labelled value ("entry: CouchDB on 3003").
 */
export function SummaryCell({ label, count, tone, shrink = "value", children }: {
  label: string;
  /** A count: shown before the label, e.g. "12 untested". */
  count?: number;
  /** Which part gives way when the line is narrow: the value (default) or the label (a long stage name). */
  shrink?: "label" | "value";
  tone?: "accent" | "warn";
  children?: ReactNode;
}) {
  const colour = tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-fg-2";
  if (count !== undefined) {
    return (
      <span data-summary-cell={label} className="mr-4 inline-block whitespace-nowrap last:mr-0">
        <span className={colour}>{count}</span> <span className="text-muted-2">{label}</span>
      </span>
    );
  }
  return (
    <span data-summary-cell={label} className={`mr-4 inline-grid max-w-full min-w-0 items-center gap-1 whitespace-nowrap align-bottom last:mr-0 ${shrink === "label" ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]"}`}>
      <span className={`text-muted-2 ${shrink === "label" ? "min-w-0 truncate" : ""}`}>{label}:</span>
      <span className={`min-w-0 ${colour} ${shrink === "label" ? "" : "truncate"}`}>{children}</span>
    </span>
  );
}

/**
 * One fact group. Its header looks the same open or folded: the caret on the left (it only rotates), then the title as
 * a section label. Folded, the summary sits on the line under the title (it wraps in a narrow column); open, the
 * header carries the group's actions over the content.
 * `shortcut` is named in the toggle's tooltip.
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
  return (
    <section aria-label={title}>
      <header className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line">
        <button
          type="button"
          aria-expanded={open}
          title={`${open ? "Fold" : "Open"} ${title}${hint}`}
          onClick={onToggle}
          className="group grid min-h-7 w-full min-w-0 cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 py-1 text-left"
        >
          <CaretRightIcon size={16} weight="regular" aria-hidden className={`text-muted transition-transform duration-150 group-hover:text-fg motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
          <h2 className={`${labelClass} m-0 truncate group-hover:text-fg`}>{title}</h2>
          {!open && summary && <span className="col-start-2 min-w-0 text-meta text-muted">{summary}</span>}
        </button>
        {open && actions && <Toolbar>{actions}</Toolbar>}
      </header>
      <Collapse open={open} contentClassName="grid gap-2 pt-2 pb-4">{children}</Collapse>
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
