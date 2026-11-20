import { X } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ALL_GUIDES, GUIDES, type GuideId } from "../../../engines/report";
import { api } from "../../../lib/api";
import { reportError } from "../../../lib/lockSignal";
import type { Settings } from "../../../types/settings";
import { IconButton } from "../../../ui";
import { settingsKey, useSettings } from "../../settings/queries";
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

/** Which guide notes Settings hides (null until Settings loads, so no note flashes up and goes), and the saves that
 *  hide one or all. Hiding takes effect at once; a failed save brings the notes back. */
export function useGuideSettings() {
  const qc = useQueryClient();
  const settings = useSettings();
  const hidden = settings.data ? (settings.data.reportGuidesHidden ?? []) : null;
  const save = useCallback(
    (next: (now: string[]) => string[]) => {
      const before = qc.getQueryData<Settings>(settingsKey);
      const list = next(before?.reportGuidesHidden ?? []);
      if (before) qc.setQueryData<Settings>(settingsKey, { ...before, reportGuidesHidden: list });
      api
        .settingsUpdate({ reportGuidesHidden: list })
        .then((s) => qc.setQueryData(settingsKey, s))
        .catch((e: unknown) => {
          qc.setQueryData<Settings>(settingsKey, (now) => (now && before ? { ...now, reportGuidesHidden: before.reportGuidesHidden } : now));
          reportError(e);
        });
    },
    [qc],
  );
  const hide = useCallback((id: GuideId) => save((now) => (now.includes(id) ? now : [...now, id])), [save]);
  const hideAll = useCallback(() => save(() => [ALL_GUIDES]), [save]);
  return { hidden, hide, hideAll };
}
