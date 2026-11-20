import type { HTMLAttributes, Ref } from "react";
import { labelClass } from "../../../ui/index";
import { cx } from "../../../lib/cx";
import "./ResultList.scss";

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

/** A labelled group of rows; without a label (or a lead) the rows are listed plain. */
export interface ResultGroup<R extends ResultRow> {
  key: string;
  label?: string;
  /** Shown above the rows and names the group: a key in mono and a line under it. Never an option, never focusable. */
  lead?: { code: string; text: string };
  rows: R[];
}

/**
 * The Arsenal drawer's and ⌘K's results: `role=listbox` of `role=group`s (named by a plain heading, never an h3)
 * holding `role=option` rows. Rows are numbered across the groups in order; `selected` is the row number (aria-selected).
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
        className={cx("result-list__row", r.stack && "result-list__row--stack")}
      >
        <span className="result-list__title">{r.title}</span>
        {r.tag && <span className={cx("result-list__tag", r.mono && "result-list__tag--mono", r.stack && "result-list__tag--stack")}>{r.tag}</span>}
      </div>
    );
  };
  return (
    <div ref={listRef} id={id} role="listbox" aria-label={label} className="result-list" {...listProps}>
      {groups.map((g) => {
        if (g.label === undefined && g.lead === undefined) return g.rows.map(option);
        const headingId = `${id}-group-${g.key}`;
        return (
          <div
            key={g.key} role="group" className="result-list__group"
            // A lead names its group by key, then its line ("KRB_AP_ERR_SKEW The clocks…"), so the key is heard first.
            aria-labelledby={g.lead ? `${headingId}-code${g.lead.text ? ` ${headingId}-text` : ""}` : headingId}
          >
            {g.label !== undefined && <div id={g.lead ? undefined : headingId} className={cx(labelClass, "result-list__label")}>{g.label}</div>}
            {g.lead && (
              <div className="result-list__lead">
                <code id={`${headingId}-code`} className="result-list__lead-code">{g.lead.code}</code>
                {g.lead.text && <span id={`${headingId}-text`} className="result-list__lead-text">{g.lead.text}</span>}
              </div>
            )}
            {g.rows.map(option)}
          </div>
        );
      })}
    </div>
  );
}
