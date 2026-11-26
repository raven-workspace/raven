import { X } from "@phosphor-icons/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ALL_GUIDES, GUIDES, type GuideId } from "../../../../engines/report/index";
import { api } from "../../../../lib/api";
import { reportError } from "../../../../lib/lockSignal";
import { IconButton } from "../../../../ui/index";
import { cachedSettings, setCachedSettings, useSettings } from "../../../settings/queries";
import "./GuideNote.scss";

/**
 * One guide note (spec §10.5): editor chrome in the app's own dark style, so it never reads as report text. It is
 * fixed text from `GUIDES` and holds no wording for the report.
 */
export function GuideNote({ id, onHide }: { id: GuideId; onHide(): void }) {
  const guide = GUIDES[id];
  return (
    <aside
      role="note"
      aria-label={guide.title}
      data-guide={id}
      className="guide-note"
    >
      <p className="guide-note__title">{guide.title}</p>
      <IconButton icon={X} label="Hide this note" onClick={onHide} />
      <p className="guide-note__body">{guide.body}</p>
    </aside>
  );
}

/** No guide hidden: one list, so `hidden` keeps its identity while Settings has none. */
const NONE: readonly string[] = [];

/** Guide-note saves on their way, per query client: the queue's tail and how many changes wait on it. */
const queues = new WeakMap<QueryClient, { tail: Promise<void>; waiting: number }>();

/**
 * Which guide notes Settings hides (null until Settings loads, so no note flashes up and goes), and the saves that hide
 * one or all. Hiding takes effect at once. Saves go one at a time, each sending the list as it is when its turn comes,
 * so a slower reply never lands over a newer list; a reply reaches the cache only when no newer change waits. A failed
 * save takes back only its own change.
 */
export function useGuideSettings() {
  const qc = useQueryClient();
  const settings = useSettings();
  const hidden = settings.data ? (settings.data.reportGuidesHidden ?? NONE) : null;
  const save = useCallback(
    (key: string) => {
      const before = cachedSettings(qc);
      const was = before?.reportGuidesHidden ?? [];
      if (!before || was.includes(key)) return;
      setCachedSettings(qc, { ...before, reportGuidesHidden: key === ALL_GUIDES ? [ALL_GUIDES] : [...was, key] });
      const queue = queues.get(qc) ?? { tail: Promise.resolve(), waiting: 0 };
      queues.set(qc, queue);
      queue.waiting++;
      queue.tail = queue.tail.then(async () => {
        const list = cachedSettings(qc)?.reportGuidesHidden ?? [];
        try {
          const saved = await api.settingsUpdate({ reportGuidesHidden: list });
          if (queue.waiting === 1) setCachedSettings(qc, saved);
        } catch (e: unknown) {
          // Only this change goes back: hides that saved, or wait to, stay.
          setCachedSettings(qc, (now) => {
            if (!now) return now;
            const list = now.reportGuidesHidden ?? [];
            return { ...now, reportGuidesHidden: key === ALL_GUIDES ? was : list.filter((x) => x !== key) };
          });
          reportError(e);
        } finally {
          queue.waiting--;
        }
      });
    },
    [qc],
  );
  const hide = useCallback((id: GuideId) => save(id), [save]);
  const hideAll = useCallback(() => save(ALL_GUIDES), [save]);
  return { hidden, hide, hideAll };
}
