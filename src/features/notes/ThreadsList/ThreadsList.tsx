import { openThreads } from "../../../engines/notes/threads";
import { cx } from "../../../lib/cx";
import { Button, labelClass } from "../../../ui/index";
import { SCROLL_PANE } from "../../../ui/controlStyles";
import { openThreadsLabel } from "../useThreadCounts";
import "./ThreadsList.scss";

/** Open threads of the note shown in the panel, each with a Close button. */
export function ThreadsList({ body, onClose }: { body: string; onClose: (line: number, text: string) => void }) {
  const threads = openThreads(body);
  if (threads.length === 0) return null;
  return (
    <section aria-label={openThreadsLabel(threads.length)} className={cx("threads-list", SCROLL_PANE)}>
      <h3 className={labelClass}>
        Open threads <span className="threads-list__count">{threads.length}</span>
      </h3>
      <ul className="threads-list__items">
        {threads.map((t) => (
          <li key={t.line} className="threads-list__item">
            <span aria-hidden className="threads-list__dot" />
            <span className="threads-list__text">{t.text || "(empty)"}</span>
            <Button size="sm" aria-label={`Close thread: ${t.text}`} onClick={() => onClose(t.line, t.text)}>
              Close
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
