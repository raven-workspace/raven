import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useState } from "react";
import {
  guideHidden,
  guidesOf,
  type PageMeta,
  type ReportNode,
} from "../../engines/report";
import type { SectionKind } from "../../types/report";
import { GuideNote, useGuideSettings } from "./editor/GuideNote";

/** How many notes show before the rest fold behind a count, so the log column below stays in view. */
const SHOWN = 2;

/**
 * The open page's guide notes, above the log column in the right-hand column (spec §10.5). They sit beside the page,
 * never in the paper. Notes Settings hides are left out; a long list shows its first few and folds the rest.
 */
export function GuidePanel({
  kind,
  placement,
  doc,
}: {
  kind: SectionKind;
  placement?: PageMeta["placement"];
  doc: ReportNode;
}) {
  const { hidden, hide, hideAll } = useGuideSettings();
  const [all, setAll] = useState(false);
  if (hidden === null) return null;
  const ids = guidesOf(doc, kind, placement).filter(
    (id) => !guideHidden(hidden, id),
  );
  if (ids.length === 0) return null;
  const shown = all ? ids : ids.slice(0, SHOWN);
  const more = ids.length - SHOWN;
  return (
    <div className="mb-3 grid gap-2">
      <ul aria-label="Guide notes" className="m-0 grid list-none gap-2 p-0">
        {shown.map((id) => (
          <li key={id} className="grid">
            <GuideNote id={id} onHide={() => hide(id)} onHideAll={hideAll} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="grid min-h-6 grid-cols-[auto_auto] items-center justify-self-start gap-1 rounded-sm border-0 bg-transparent p-0 font-ui text-meta text-muted cursor-default hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {all ? (
            <CaretUp size={12} aria-hidden />
          ) : (
            <CaretDown size={12} aria-hidden />
          )}
          {all
            ? "Show fewer notes"
            : `Show ${more} more ${more === 1 ? "note" : "notes"}`}
        </button>
      )}
    </div>
  );
}
