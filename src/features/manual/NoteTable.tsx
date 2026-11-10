import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ACTION_HEADER, CAUSE_HEADER, isKeyCell, plain } from "../../engines/manual/lookup";
import type { Inline } from "../../engines/manual/markdown";
import { labelClass } from "../../ui/Label";

// `group-data-stacked/nt:` classes apply only while the table is stacked (`data-stacked` on the table). Written out in
// full so Tailwind finds them.
const TD =
  "border-b border-line px-2 py-2 align-top text-fg-2 [overflow-wrap:break-word] group-data-stacked/nt:col-span-2 group-data-stacked/nt:grid " +
  "group-data-stacked/nt:grid-cols-subgrid group-data-stacked/nt:items-start " +
  "group-data-stacked/nt:border-0 group-data-stacked/nt:p-0";

/**
 * A note's table. Laid out as a table while every column fits at its widest unbreakable value (a status code, a flag,
 * a path: see `NoteView`'s code tokens, and `isKeyCell`: a short key cell is one unbreakable value as a whole);
 * when the pane is too narrow for that, each row stacks as "column name: value" lines (names in a left track) instead, so no column is squeezed
 * until its codes break mid-word and nothing scrolls sideways. The switch is a `data-stacked` attribute set before
 * paint, so the cells (and any search marks in them) are the same elements in both layouts. Roles are explicit because a
 * grid-laid-out table can lose its table semantics in WebKit; stacked, each cell starts with its column name as real
 * text, so it is read as "Code 0xC0000022".
 */
export function NoteTable({ head, rows, anchor, cell }: { head: Inline[][]; rows: Inline[][][]; anchor?: string; cell: (parts: Inline[], row?: number) => ReactNode }) {
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
  // Column policy: the action column keeps a floor width; the cause column is the first to go, only when the table needs
  // the room (`data-dropped` on the table, set by the fit above; `!` so it beats the stacked cells' `grid`).
  const kind = labels.map((l) => (ACTION_HEADER.test(l.trim()) ? "action" : CAUSE_HEADER.test(l.trim()) ? "cause" : ""));
  const colClass = (j: number) => (kind[j] === "action" ? " min-w-[32ch]" : kind[j] === "cause" ? " group-data-[dropped=low]/nt:hidden!" : "");
  const colAttr = (j: number) => (kind[j] === "cause" ? { "data-col": "low" } : {});
  return (
    <div ref={wrapRef} className="relative grid min-w-0">
      <table ref={tableRef} role="table" data-table={anchor} className="group/nt w-full border-collapse text-body/5.5 data-stacked:grid">
        <thead role="rowgroup" className="group-data-stacked/nt:hidden">
          <tr role="row">
            {head.map((c, i) => (
              <th key={i} role="columnheader" {...colAttr(i)} className={`border-b border-line-strong px-2 pt-1 pb-2 text-left align-bottom ${labelClass} [overflow-wrap:break-word]${colClass(i)}`}>
                {cell(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="group-data-stacked/nt:grid">
          {rows.map((r, i) => (
            <tr
              key={i} role="row" data-row={i}
              className="[&[data-current-row]>td]:bg-surface-hi [&[data-current-row]>td:first-child]:shadow-[inset_2px_0_0_var(--accent)] group-data-stacked/nt:[&[data-current-row]]:bg-surface-hi group-data-stacked/nt:[&[data-current-row]]:shadow-[inset_2px_0_0_var(--accent)] group-data-stacked/nt:[&[data-current-row]>td]:bg-transparent group-data-stacked/nt:[&[data-current-row]>td:first-child]:shadow-none group-data-stacked/nt:grid group-data-stacked/nt:grid-cols-[fit-content(12rem)_minmax(0,1fr)] group-data-stacked/nt:gap-x-3 group-data-stacked/nt:gap-y-1 group-data-stacked/nt:border-b group-data-stacked/nt:border-line group-data-stacked/nt:py-3"
            >
              {r.map((c, j) => {
                const key = j === 0 && isKeyCell(c);
                // A key cell never wraps as a table (the stacked check then sees its full width); stacked, it may again.
                const base = isKeyCell(c) ? `${TD} whitespace-nowrap group-data-stacked/nt:whitespace-normal` : TD;
                return (
                  <td key={j} role="cell" {...colAttr(j)} className={base + colClass(j)}>
                    {/* Its column name: shown (and read) only when stacked, as the table header is then hidden. A key cell is the row's heading line instead: the name stays for screen readers only. */}
                    <span data-column-label="" className={key ? "hidden group-data-stacked/nt:block group-data-stacked/nt:sr-only" : "hidden text-muted group-data-stacked/nt:block"}>{labels[j] ?? ""}</span>
                    {/* One grid item when stacked: text, code and links stay in one flow. */}
                    <span className={key ? "min-w-0 group-data-stacked/nt:col-span-2 group-data-stacked/nt:text-body group-data-stacked/nt:font-semibold group-data-stacked/nt:text-fg" : "min-w-0"}>{cell(c, i)}</span>
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
