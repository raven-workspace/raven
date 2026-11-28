import { ArrowUpRightIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cx } from "../../../../lib/cx";
import { Collapse, Toolbar, labelClass } from "../../../../ui/index";
import "./FactGroup.scss";

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
  const value = cx("summary-cell__value", tone && `summary-cell__value--${tone}`);
  if (count !== undefined) {
    return (
      <span data-summary-cell={label} className="summary-cell">
        <span className={value}>{count}</span> <span className="summary-cell__label">{label}</span>
      </span>
    );
  }
  return (
    <span data-summary-cell={label} className={cx("summary-cell summary-cell--value", shrink === "label" && "summary-cell--shrink-label")}>
      <span className={cx("summary-cell__label", shrink === "label" && "summary-cell__label--shrink")}>{label}:</span>
      <span className={cx(value, shrink !== "label" && "summary-cell__value--truncate")}>{children}</span>
    </span>
  );
}

/**
 * One fact group. Its header looks the same open or folded: the caret on the left (it only rotates), then the title as
 * a section label. Folded, the summary sits on the line under the title (it wraps in a narrow column); open, the
 * header carries the group's actions over the content.
 * The toggle has no tooltip: its label is on screen (DESIGN.md). `shortcut` goes on the toggle as `aria-keyshortcuts`;
 * the page lists it in the Shortcuts popover.
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
  return (
    <section aria-label={title} className="fact-group">
      <header className="fact-group__header">
        <button
          type="button"
          aria-expanded={open}
          aria-keyshortcuts={shortcut}
          onClick={onToggle}
          className="fact-group__toggle"
        >
          <CaretRightIcon size={16} weight="regular" aria-hidden className={cx("fact-group__caret", open && "fact-group__caret--open")} />
          <h2 className={cx(labelClass, "fact-group__title")}>{title}</h2>
          {!open && summary && <span className="fact-group__summary">{summary}</span>}
        </button>
        {open && actions && <Toolbar>{actions}</Toolbar>}
      </header>
      <Collapse open={open} contentClassName="fact-group__body">{children}</Collapse>
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
      className={cx("entry-link", className)}
    >
      <ArrowUpRightIcon size={16} weight="regular" aria-hidden />
      <span className="entry-link__label">{label}</span>
    </button>
  );
}
