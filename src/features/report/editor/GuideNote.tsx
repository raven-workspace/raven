import { X } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { definePlugin } from "prosekit/core";
import { Plugin } from "prosekit/pm/state";
import { Decoration, DecorationSet } from "prosekit/pm/view";
import { ALL_GUIDES, GUIDES, guideFor, guideHidden, type GuideId } from "../../../engines/report";
import { api } from "../../../lib/api";
import { reportError } from "../../../lib/lockSignal";
import type { SectionKind } from "../../../types/report";
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
        className="col-span-2 justify-self-start rounded-sm border-0 bg-transparent p-0 text-meta text-muted underline-offset-2 cursor-default hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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

/** A guide note outside the editor (a target's appendix page), shown unless Settings hides it. */
export function StandaloneGuide({ id }: { id: GuideId }) {
  const { hidden, hide, hideAll } = useGuideSettings();
  if (hidden === null || guideHidden(hidden, id)) return null;
  return <GuideNote id={id} onHide={() => hide(id)} onHideAll={hideAll} />;
}

/**
 * Where a page's guide notes go. The editor plugin places an empty element above each guided block (a widget
 * decoration: never in the document, so never saved, copied or exported) and registers it here; the page renders each
 * note into its element through a portal, so the note keeps the app's context.
 */
export class GuideSlots {
  /** Ids Settings hides; null until it loads. */
  hidden: readonly string[] | null = null;
  /** The page's kind; without one the page shows no notes. */
  sectionKind: SectionKind | undefined;
  /** The note for the page as a whole, at its top. */
  pageGuide: GuideId | null = null;
  private mounts = new Map<GuideId, HTMLElement>();
  private snapshot: [GuideId, HTMLElement][] = [];
  private listeners = new Set<() => void>();

  attach(id: GuideId, el: HTMLElement) {
    this.mounts.set(id, el);
    this.emit();
  }

  detach(id: GuideId, el: HTMLElement) {
    if (this.mounts.get(id) !== el) return;
    this.mounts.delete(id);
    this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = [...this.mounts];
    for (const l of this.listeners) l();
  }
}

/** The editor plugin: one widget above the first block of each guide on the page (a guide shows once per page). */
export function defineGuideNotes(slots: GuideSlots) {
  return definePlugin(
    new Plugin({
      props: {
        decorations: (state) => {
          const { hidden, sectionKind, pageGuide } = slots;
          if (hidden === null || sectionKind === undefined || hidden.includes(ALL_GUIDES)) return null;
          const decos: Decoration[] = [];
          const seen = new Set<GuideId>();
          const add = (id: GuideId | null, pos: number) => {
            if (id === null || seen.has(id) || guideHidden(hidden, id)) return;
            seen.add(id);
            decos.push(
              Decoration.widget(
                pos,
                () => {
                  const el = document.createElement("div");
                  el.className = "report-guide-slot";
                  el.contentEditable = "false";
                  slots.attach(id, el);
                  return el;
                },
                {
                  side: -1,
                  key: `guide-${id}`,
                  ignoreSelection: true,
                  // Clicks and keys in the note's buttons stay with them.
                  stopEvent: () => true,
                  destroy: (el) => slots.detach(id, el as HTMLElement),
                },
              ),
            );
          };
          add(pageGuide, 0);
          state.doc.descendants((node, pos) => {
            const name = node.type.name;
            add(guideFor({ type: name, attrs: node.attrs, text: name === "heading" ? node.textContent : undefined }, sectionKind), pos);
            // Guided blocks sit at the top level or in a container; a steps list's insides take none.
            return !node.isTextblock && !node.isAtom && name !== "steps";
          });
          return decos.length === 0 ? null : DecorationSet.create(state.doc, decos);
        },
      },
    }),
  );
}

/** Renders the page's guide notes into the elements the plugin placed. `onLeave` runs after a hide, so focus goes
 *  back to the page rather than to nothing. */
export function GuidePortals({ slots, onLeave }: { slots: GuideSlots; onLeave(): void }) {
  const mounts = useSyncExternalStore(slots.subscribe, slots.getSnapshot);
  const { hide, hideAll } = useGuideSettings();
  return mounts.map(([id, el]) =>
    createPortal(
      <GuideNote
        id={id}
        onHide={() => {
          hide(id);
          onLeave();
        }}
        onHideAll={() => {
          hideAll();
          onLeave();
        }}
      />,
      el,
      id,
    ),
  );
}
