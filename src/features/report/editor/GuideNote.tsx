import { X } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ALL_GUIDES, GUIDES, type GuideId } from "../../../engines/report";
import { api } from "../../../lib/api";
import { reportError } from "../../../lib/lockSignal";
import type { Settings } from "../../../types/settings";
import { IconButton } from "../../../ui";

/**
 * One guide note (spec §10.5): editor chrome in the app's own dark style, so it never reads as report text. It is
 * fixed text from `GUIDES` and holds no wording for the report.
 */
export function GuideNote({ id, onHide, onHideAll }: { id: GuideId; onHide(): void; onHideAll(): void }) {
  const guide = GUIDES[id];
  return (
    <aside
      role="note"
      aria-label={guide.title}
      data-guide={id}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-md border border-line-strong bg-surface py-2 pr-1 pl-3 font-ui text-meta text-fg-2 select-none"
    >
      <p className="m-0 pt-1 font-semibold text-fg">{guide.title}</p>
      <IconButton icon={X} label="Hide this note" onClick={onHide} />
      <p className="col-span-2 m-0 pr-2">{guide.body}</p>
      <button
        type="button"
        onClick={onHideAll}
        className="col-span-2 min-h-6 justify-self-start rounded-sm border-0 bg-transparent p-0 text-meta text-muted underline-offset-2 cursor-default hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        Hide all guide notes
      </button>
    </aside>
  );
}

/** Which guide notes Settings hides (null until Settings loads, so no note flashes up and goes), and the saves that
 *  hide one or all. Hiding takes effect at once; a failed save brings the notes back. */
export function useGuideSettings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const hidden = settings.data ? (settings.data.reportGuidesHidden ?? []) : null;
  const save = useCallback(
    (next: (now: string[]) => string[]) => {
      const before = qc.getQueryData<Settings>(["settings"]);
      const list = next(before?.reportGuidesHidden ?? []);
      if (before) qc.setQueryData<Settings>(["settings"], { ...before, reportGuidesHidden: list });
      api
        .settingsUpdate({ reportGuidesHidden: list })
        .then((s) => qc.setQueryData(["settings"], s))
        .catch((e: unknown) => {
          qc.setQueryData<Settings>(["settings"], (now) => (now && before ? { ...now, reportGuidesHidden: before.reportGuidesHidden } : now));
          reportError(e);
        });
    },
    [qc],
  );
  const hide = useCallback((id: GuideId) => save((now) => (now.includes(id) ? now : [...now, id])), [save]);
  const hideAll = useCallback(() => save(() => [ALL_GUIDES]), [save]);
  return { hidden, hide, hideAll };
}
