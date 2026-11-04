import { openThreads } from "../../engines/notes/threads";
import { cx } from "../../lib/cx";
import { Button, labelClass } from "../../ui";
import { openThreadsLabel } from "./useThreadCounts";

/** Open threads of the note shown in the panel, each with a Close button. */
export function ThreadsList({ body, onClose }: { body: string; onClose: (line: number, text: string) => void }) {
  const threads = openThreads(body);
  if (threads.length === 0) return null;
  return (
    <section aria-label={openThreadsLabel(threads.length)} className="flex max-h-40 shrink-0 flex-col gap-1 overflow-y-auto">
      <h3 className={cx(labelClass, "m-0")}>Open threads · {threads.length}</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {threads.map((t) => (
          <li key={t.line} className="flex items-center gap-2 text-[13px] text-fg-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg-2" />
            <span className="min-w-0 flex-1 truncate">{t.text || "(empty)"}</span>
            <Button size="sm" aria-label={`Close thread: ${t.text}`} onClick={() => onClose(t.line, t.text)}>
              Close
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
