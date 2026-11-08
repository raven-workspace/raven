import type { HTMLAttributes, Ref } from "react";
import { ON } from "./styles";

/** What a result row shows: a title and a small tag at its right (a count, a card/tool, an engagement item's kind). */
export interface ResultRow {
  id: string;
  title: string;
  tag: string;
  /** The tag is a tool name. */
  mono?: boolean;
  /** The tag goes on its own line under the title, so a narrow list keeps the whole title. */
  stack?: boolean;
}

/** A labelled group of rows; without a label the rows are listed plain. */
export interface ResultGroup<R extends ResultRow> {
  key: string;
  label?: string;
  rows: R[];
}

/**
 * The Arsenal drawer's and ⌘K's results: `role=listbox` of `role=group`s (named by a plain heading, never an h3)
 * holding `role=option` rows. Rows are numbered across the groups in order; `selected` is the row number on `ON`.
 * Hover only tints a row: selection is set by click or keys, never by the pointer. Focus stays in the search field, which points at the row with `aria-activedescendant`.
 */
export function ResultList<R extends ResultRow>({ id, label, groups, selected, onActivate, listRef, listProps }: {
  /** For a list that takes focus itself (browse's middle pane): its ref and tabindex, key and `aria-activedescendant` props. */
  listRef?: Ref<HTMLDivElement>; listProps?: HTMLAttributes<HTMLDivElement>;
  id: string; label: string; groups: ResultGroup<R>[]; selected: number;
  onActivate: (row: R, index: number) => void;
}) {
  let next = 0;
  const option = (r: R) => {
    const i = next++;
    return (
      <div
        key={r.id}
        id={r.id}
        role="option"
        aria-selected={i === selected}
        onClick={() => onActivate(r, i)}
        title={r.title}
        className={`grid cursor-default ${r.stack ? "grid-cols-[minmax(0,1fr)] gap-0" : "grid-cols-[minmax(0,1fr)_auto] items-center gap-2"} rounded-sm px-2 py-1 text-left text-[13px] ${i === selected ? ON : "text-fg-2 hover:bg-surface-hi"}`}
      >
        <span className="min-w-0 truncate">{r.title}</span>
        {r.tag && <span className={`min-w-0 truncate text-[11px] text-muted ${r.mono ? "font-mono" : ""} ${r.stack ? "" : "max-w-40"}`}>{r.tag}</span>}
      </div>
    );
  };
  return (
    <div ref={listRef} id={id} role="listbox" aria-label={label} className="grid grid-cols-[minmax(0,1fr)] gap-2 outline-none" {...listProps}>
      {groups.map((g) => {
        if (g.label === undefined) return g.rows.map(option);
        const headingId = `${id}-group-${g.key}`;
        return (
          <div key={g.key} role="group" aria-labelledby={headingId} className="grid grid-cols-[minmax(0,1fr)] border-t border-line pt-1.5 first:border-t-0 first:pt-0">
            <div id={headingId} className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-label text-muted">{g.label}</div>
            {g.rows.map(option)}
          </div>
        );
      })}
    </div>
  );
}
