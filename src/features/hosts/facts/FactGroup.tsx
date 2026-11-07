import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { labelClass } from "../../../ui";

/**
 * One fact group. Folded, it is a single summary line that opens in place; open, a labelled header (which folds it
 * again) over the group's content. `shortcut` is named in the toggle's tooltip.
 */
export function FactGroup({ title, summary, open, onToggle, shortcut, actions, children }: {
  title: string;
  /** The folded line, e.g. "Services · 7 ✓ · entry IIS 80 · 2 ?". */
  summary: string;
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
          className="grid w-full cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-1.5 text-left text-[13px] text-fg-2 hover:text-fg"
        >
          <span className="truncate">{summary}</span>
          <CaretRight size={12} weight="light" aria-hidden />
        </button>
      </section>
    );
  }
  return (
    <section aria-label={title} className="flex flex-col gap-2 pb-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line pb-1">
        <button
          type="button"
          aria-expanded
          title={`Fold ${title}${hint}`}
          onClick={onToggle}
          className="flex min-w-0 cursor-default items-center gap-1.5 text-left hover:text-fg"
        >
          <CaretDown size={12} weight="light" aria-hidden className="shrink-0 text-muted" />
          <h2 className={`${labelClass} m-0 truncate`}>{title}</h2>
        </button>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
