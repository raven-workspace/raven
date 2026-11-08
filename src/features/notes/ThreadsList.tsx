import { openThreads } from "../../engines/notes/threads";
import { cx } from "../../lib/cx";
import { Button, labelClass } from "../../ui";
import { SCROLL_PANE } from "../../ui/controlStyles";
import { openThreadsLabel } from "./useThreadCounts";

/** Open threads of the note shown in the panel, each with a Close button. */
export function ThreadsList({ body, onClose }: { body: string; onClose: (line: number, text: string) => void }) {
  const threads = openThreads(body);
  if (threads.length === 0) return null;
  return (
    <section aria-label={openThreadsLabel(threads.length)} className={cx("grid max-h-40 content-start gap-1", SCROLL_PANE)}>
      <h3 className={cx(labelClass, "m-0")}>
        Open threads <span className="tabular-nums">{threads.length}</span>
      </h3>
      <ul className="m-0 grid list-none gap-1 p-0">
        {threads.map((t) => (
          <li key={t.line} className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2 text-body text-fg-2">
            <span aria-hidden className="size-1.5 rounded-full bg-fg-2" />
            <span className="truncate">{t.text || "(empty)"}</span>
            <Button size="sm" aria-label={`Close thread: ${t.text}`} onClick={() => onClose(t.line, t.text)}>
              Close
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
