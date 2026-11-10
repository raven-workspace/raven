import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Inline } from "../../engines/manual/markdown";

/** A cell's plain text, for its column name in the stacked layout. */
const plain = (parts: Inline[]): string =>
  parts.map((p) => ("text" in p ? p.text : "code" in p ? p.code : "strong" in p ? plain(p.strong) : "em" in p ? plain(p.em) : p.link.label)).join("");

// `group-data-stacked/nt:` classes apply only while the table is stacked (`data-stacked` on the table). Written out in
// full so Tailwind finds them.
const TD =
  "border-b border-line px-2 py-2 align-top text-fg-2 [overflow-wrap:break-word] group-data-stacked/nt:col-span-2 group-data-stacked/nt:grid " +
  "group-data-stacked/nt:grid-cols-subgrid group-data-stacked/nt:items-start " +
  "group-data-stacked/nt:border-0 group-data-stacked/nt:p-0";

/**
 * A note's table. Laid out as a table while every column fits at its widest unbreakable value (a status code, a flag,
 * a path: see `NoteView`'s code tokens);
 * when the pane is too narrow for that, each row stacks as "column name: value" lines (names in a left track) instead, so no column is squeezed
 * until its codes break mid-word and nothing scrolls sideways. The switch is a `data-stacked` attribute set before
 * paint, so the cells (and any search marks in them) are the same elements in both layouts. Roles are explicit because a
 * grid-laid-out table can lose its table semantics in WebKit; stacked, each cell starts with its column name as real
 * text, so it is read as "Code 0xC0000022".
 */
export function NoteTable({ head, rows, cell }: { head: Inline[][]; rows: Inline[][][]; cell: (parts: Inline[]) => ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;
    /** The table's width as a table, the last time it was too wide to fit. */
    let natural = Infinity;
    // New content: decide afresh from the table layout (a stale stacked state would never learn its new width).
    delete table.dataset.stacked;
    const fit = () => {
      const room = wrap.clientWidth;
      if (table.dataset.stacked === undefined) {
        if (table.offsetWidth <= room + 0.5) return;
        natural = table.offsetWidth;
        table.dataset.stacked = "";
      } else if (room >= natural) {
        delete table.dataset.stacked;
        fit();
      }
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(fit);
    obs.observe(wrap);
    obs.observe(table);
    return () => obs.disconnect();
  }, [head, rows]);

  const labels = head.map(plain);
  return (
    <div ref={wrapRef} className="grid min-w-0">
      <table ref={tableRef} role="table" className="group/nt w-full border-collapse text-meta data-stacked:grid">
        <thead role="rowgroup" className="group-data-stacked/nt:hidden">
          <tr role="row">
            {head.map((c, i) => (
              <th key={i} role="columnheader" className="border-b border-line-2 px-2 py-1 text-left align-bottom text-label text-muted [overflow-wrap:break-word]">
                {cell(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="group-data-stacked/nt:grid">
          {rows.map((r, i) => (
            <tr
              key={i} role="row"
              className="group-data-stacked/nt:grid group-data-stacked/nt:grid-cols-[fit-content(12rem)_minmax(0,1fr)] group-data-stacked/nt:gap-x-3 group-data-stacked/nt:gap-y-1 group-data-stacked/nt:border-b group-data-stacked/nt:border-line group-data-stacked/nt:py-3"
            >
              {r.map((c, j) => (
                <td key={j} role="cell" className={TD}>
                  {/* Its column name: shown (and read) only when stacked, as the table header is then hidden. */}
                  <span data-column-label="" className="hidden text-muted group-data-stacked/nt:block">{labels[j] ?? ""}</span>
                  {/* One grid item when stacked: text, code and links stay in one flow. */}
                  <span className="min-w-0">{cell(c)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
