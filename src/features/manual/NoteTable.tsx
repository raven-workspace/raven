import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Inline } from "../../engines/manual/markdown";
import { labelClass } from "../../ui/Label";

/** A cell's plain text, for its column name in the stacked layout. */
const plain = (parts: Inline[]): string =>
  parts.map((p) => ("text" in p ? p.text : "code" in p ? p.code : "strong" in p ? plain(p.strong) : "em" in p ? plain(p.em) : p.link.label)).join("");

/** A key cell (a flag, an error code, a port, a privilege, a path) up to this many characters keeps to one line. */
const KEY_MAX = 32;

/**
 * A short "key" cell: nothing but inline code (with only commas or slashes between spans, as in "`-u`, `-p`") or a
 * single word, at most `KEY_MAX` characters. Its column then sizes to its widest key instead of being squeezed until
 * `-p PROGRAM` breaks at its space. Bold or italic around the code counts as the code.
 */
function isKeyCell(parts: Inline[]): boolean {
  const flat: Inline[] = parts.flatMap((p) => ("strong" in p ? p.strong : "em" in p ? p.em : [p]));
  if (flat.some((p) => "strong" in p || "em" in p || "link" in p)) return false;
  const text = plain(flat).trim();
  if (!text || text.length > KEY_MAX) return false;
  const codes = flat.filter((p) => "code" in p).length;
  if (codes === 0) return flat.length === 1 && !/\s/.test(text);
  return flat.every((p) => "code" in p || ("text" in p && /^[\s,/|]*$/.test(p.text)));
}

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
      <table ref={tableRef} role="table" className="group/nt w-full border-collapse text-body/5.5 data-stacked:grid">
        <thead role="rowgroup" className="group-data-stacked/nt:hidden">
          <tr role="row">
            {head.map((c, i) => (
              <th key={i} role="columnheader" className={`border-b border-line-strong px-2 pt-1 pb-2 text-left align-bottom ${labelClass} [overflow-wrap:break-word]`}>
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
                // A key cell never wraps as a table (the stacked check then sees its full width); stacked, it may again.
                <td key={j} role="cell" className={isKeyCell(c) ? `${TD} whitespace-nowrap group-data-stacked/nt:whitespace-normal` : TD}>
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
