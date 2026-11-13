import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { guideHidden, guidesOf, type PageMeta, type ReportNode } from "../../engines/report";
import type { SectionKind } from "../../types/report";
import { GuideNote, useGuideSettings } from "./editor/GuideNote";

/** How many notes show before the rest fold behind a count, so the log column below stays in view. */
const SHOWN = 2;

/**
 * The open page's guide notes, above the log column in the right-hand column (spec §10.5). They sit beside the page,
 * never in the paper. Notes Settings hides are left out; a long list shows its first few and folds the rest.
 * Mount it with a key per page so the fold starts closed on each.
 */
export function GuidePanel({ kind, placement, doc }: { kind: SectionKind; placement?: PageMeta["placement"]; doc: ReportNode }) {
  const { hidden, hide, hideAll } = useGuideSettings();
  const [all, setAll] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hid = useRef(false);
  const fallback = useRef<HTMLElement | null>(null);
  const ids = hidden === null ? [] : guidesOf(doc, kind, placement).filter((id) => !guideHidden(hidden, id));
  const count = ids.length;

  // The button that had focus goes with its note: remember where focus can land, then land it once the list redraws.
  const leave = () => {
    hid.current = true;
    const el = root.current;
    fallback.current = el?.closest<HTMLElement>("[tabindex='-1']") ?? el?.parentElement?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null;
  };
  useEffect(() => {
    if (!hid.current) return;
    hid.current = false;
    const el = root.current;
    if (el?.contains(document.activeElement)) return;
    const next = el?.querySelector<HTMLElement>('[role="note"] button') ?? el?.querySelector<HTMLElement>("[aria-expanded]");
    (next ?? fallback.current)?.focus();
  }, [count, hidden]);

  if (count === 0) return null;
  const shown = all ? ids : ids.slice(0, SHOWN);
  const more = count - SHOWN;
  return (
    <div ref={root} className="mb-3 grid gap-2">
      <ul role="list" aria-label="Guide notes" className="m-0 grid list-none gap-2 p-0">
        {shown.map((id) => (
          <li key={id} className="grid">
            <GuideNote
              id={id}
              onHide={() => {
                leave();
                hide(id);
              }}
            />
          </li>
        ))}
      </ul>
      {/* One footer under the list: the fold toggle (when some notes fold) at the start, Hide all at the end. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        {more > 0 ? (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
            className="grid min-h-6 grid-cols-[auto_auto] items-center justify-self-start gap-1 rounded-sm border-0 bg-transparent p-0 font-ui text-meta text-muted cursor-default hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {all ? <CaretUp size={12} aria-hidden /> : <CaretDown size={12} aria-hidden />}
            {all ? "Show fewer notes" : `Show ${more} more ${more === 1 ? "note" : "notes"}`}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => {
            leave();
            hideAll();
          }}
          className="min-h-6 rounded-sm border-0 bg-transparent p-0 font-ui text-meta text-muted underline-offset-2 cursor-default hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          Hide all guide notes
        </button>
      </div>
    </div>
  );
}
