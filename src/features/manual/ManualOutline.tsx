import type { ReactNode } from "react";
import type { OutlineEntry } from "../../engines/manual";
import { parseInline, type Inline } from "../../engines/manual/markdown";
import { cx } from "../../lib/cx";

/** An entry's inline Markdown as the note shows it: code in mono, emphasis and link markers gone. */
function OutlineText({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((p, i) => {
    if ("text" in p) return p.text;
    if ("code" in p) return <code key={i} className="font-mono text-code">{p.code}</code>;
    if ("strong" in p) return <OutlineText key={i} parts={p.strong} />;
    if ("em" in p) return <OutlineText key={i} parts={p.em} />;
    return p.link.label;
  });
}

/**
 * "On this page": the note's headings and named tables, the current one marked in the accent. A table shows "Table N"
 * and its name as two parts. Clicking (or ↵ on) an entry scrolls the note to it.
 */
export function ManualOutline({ outline, current, onPick }: { outline: OutlineEntry[]; current: number; onPick: (index: number) => void }) {
  if (outline.length === 0) return <p className="m-0 px-2 text-meta text-muted">No sections</p>;
  return (
    <ul className="m-0 grid list-none gap-0 p-0">
      {outline.map((o, i) => {
        const on = i === current;
        return (
          <li key={o.id} className="grid">
            <button
              type="button" aria-current={on ? "location" : undefined} onClick={() => onPick(i)}
              className={cx(
                "grid min-h-7 w-full cursor-default items-start rounded-sm border-0 bg-transparent py-1 pr-2 text-left text-meta hover:bg-surface-hi",
                o.kind === "h2" ? "pl-2" : "pl-4",
                o.kind === "table" && "grid-cols-[max-content_minmax(0,1fr)] gap-2",
                on ? "text-accent" : "text-muted-2 hover:text-fg",
              )}
            >
              {o.kind === "table" ? (
                <>
                  <span className={on ? undefined : "text-muted"}>Table {o.number}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]"><OutlineText parts={parseInline(o.text)} /></span>
                </>
              ) : (
                <span className="min-w-0 [overflow-wrap:anywhere]"><OutlineText parts={parseInline(o.text)} /></span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
