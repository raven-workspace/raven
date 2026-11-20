import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ACTION_HEADER, CAUSE_HEADER, isKeyCell, MEANS_HEADER, plain } from "../../engines/manual/lookup";
import type { Inline } from "../../engines/manual/markdown";
import { labelClass } from "../../ui/Label";
import { cx } from "../../lib/cx";
import "./NoteTable.scss";


/**
 * A note's table. Laid out as a table while every column fits at its widest unbreakable value (a status code, a flag,
 * a path: see `NoteView`'s code tokens, and `isKeyCell`: a short key cell is one unbreakable value as a whole);
 * when the pane is too narrow for that, each row stacks as "column name: value" lines (names in a left track) instead, so no column is squeezed
 * until its codes break mid-word and nothing scrolls sideways. The switch is a `data-stacked` attribute set before
 * paint, so the cells (and any search marks in them) are the same elements in both layouts. Roles are explicit because a
 * grid-laid-out table can lose its table semantics in WebKit; stacked, each cell starts with its column name as real
 * text, so it is read as "Code 0xC0000022".
 */
export function NoteTable({ head, rows, anchor, cell }: { head: Inline[][]; rows: Inline[][][]; anchor?: string; cell: (parts: Inline[], row?: number, isKey?: boolean) => ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;
    const hasLow = table.querySelector("[data-col=low]") !== null;
    // Decided afresh each time from the table layout, in order: (1) every column at its widest unbreakable value
    // (the action column at its floor) fits: a table; (2) else the cause column (`data-col="low"`) is dropped and it
    // fits: a table without it (`data-dropped`); (3) else stacked rows, the cause line dropped too.
    const fit = () => {
      const room = wrap.clientWidth;
      delete table.dataset.stacked;
      delete table.dataset.dropped;
      if (table.offsetWidth <= room + 0.5) return;
      if (hasLow) {
        table.dataset.dropped = "low";
        if (table.offsetWidth <= room + 0.5) return;
      }
      table.dataset.stacked = "";
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(fit);
    obs.observe(wrap);
    obs.observe(table);
    return () => obs.disconnect();
  }, [head, rows]);

  const labels = head.map(plain);
  // Column policy: the action column keeps a floor width, and so does the means column (prose squeezed to a word or two
  // a line is unreadable); both floors count in the fit above, so a narrow pane drops the cause column, then stacks,
  // before either is squeezed. The cause column is the first to go, only when the table needs the room (`data-dropped`
  // on the table, set by the fit above; `!` so it beats the stacked cells' `grid`).
  const kind = labels.map((l) => (ACTION_HEADER.test(l.trim()) ? "action" : CAUSE_HEADER.test(l.trim()) ? "cause" : MEANS_HEADER.test(l.trim()) ? "means" : ""));
  const colClass = (j: number) =>
    kind[j] === "action" ? "note-table__col--action" : kind[j] === "means" ? "note-table__col--means" : undefined;
  const colAttr = (j: number) => (kind[j] === "cause" ? { "data-col": "low" } : {});
  return (
    <div ref={wrapRef} className="note-table-wrap">
      <table ref={tableRef} role="table" data-table={anchor} className="note-table">
        <thead role="rowgroup" className="note-table__head">
          <tr role="row">
            {head.map((c, i) => (
              <th key={i} role="columnheader" {...colAttr(i)} className={cx("note-table__th", labelClass, colClass(i))}>
                {cell(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="note-table__body">
          {rows.map((r, i) => (
            <tr
              key={i} role="row" data-row={i}
              className="note-table__row"
            >
              {r.map((c, j) => {
                const key = j === 0 && isKeyCell(c);
                // A key cell never wraps as a table (the stacked check then sees its full width); stacked, it may again.
                return (
                  <td key={j} role="cell" {...colAttr(j)} className={cx("note-table__cell", isKeyCell(c) && "note-table__cell--key", colClass(j))}>
                    {/* Its column name: shown (and read) only when stacked, as the table header is then hidden. A key cell is the row's heading line instead: the name stays for screen readers only. */}
                    <span data-column-label="" className={cx("note-table__label", key && "note-table__label--key")}>{labels[j] ?? ""}</span>
                    {/* One grid item when stacked: text, code and links stay in one flow. */}
                    <span className={cx("note-table__value", key && "note-table__value--key")}>{cell(c, i, key)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
