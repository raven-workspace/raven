import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { shortTitle, type ManualNote } from "../../engines/manual";
import { cx } from "../../lib/cx";
import { Input, labelClass } from "../../ui";
import { MANUAL_GROUPS } from "./useManualNotes";
import "./ManualRail.scss";

export const MANUAL_FILTER_ID = "manual-filter";

const items = (list: HTMLElement | null) => [...(list?.querySelectorAll<HTMLButtonElement>("button[data-note]") ?? [])];

/**
 * The Manual's left rail: a title filter (`/` focuses it) over the notes in three groups. ↓ from the filter moves into
 * the list, ↑↓ move along it, ↵ (or a click) opens a note; ↵ in the filter opens the first match and moves on to the note.
 */
export function ManualRail({ notes, currentId, filter, onFilter, filterRef, onOpen }: {
  notes: ManualNote[];
  currentId: string | null;
  filter: string;
  onFilter: (q: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
  /** `read`: focus moves on to the note (↵ in the filter). */
  onOpen: (id: string, read?: boolean) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();
  const shown = q ? notes.filter((n) => n.title.toLowerCase().includes(q)) : notes;
  // One tab stop in the list: the open note, else the first shown.
  const tabStop = shown.some((n) => n.id === currentId) ? currentId : (shown[0]?.id ?? null);

  // The open note stays in view in the rail.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest" });
  }, [currentId]);

  const onFilterKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items(listRef.current)[0]?.focus();
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing && shown[0]) {
      e.preventDefault();
      onOpen(shown[0].id, true);
    }
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const all = items(listRef.current);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowUp" && at <= 0) return void filterRef.current?.focus();
    all[Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))]?.focus();
  };

  return (
    <nav aria-label="Manual notes" className="manual-rail">
      <Input
        id={MANUAL_FILTER_ID} ref={filterRef} type="search" aria-label="Filter the Manual" placeholder="Filter the Manual"
        value={filter} onChange={(e) => onFilter(e.target.value)} onKeyDown={onFilterKey}
      />
      <div ref={listRef} onKeyDown={onListKey} className="manual-rail__list">
        {shown.length === 0 && <p className="manual-rail__empty">No note matches</p>}
        {MANUAL_GROUPS.map(({ folder, label }) => {
          const group = shown.filter((n) => n.folder === folder);
          if (group.length === 0) return null;
          return (
            <div key={folder} role="group" aria-label={label} className="manual-rail__group">
              <span aria-hidden="true" className={cx(labelClass, "manual-rail__group-label")}>{label}</span>
              {group.map((n) => {
                const on = n.id === currentId;
                return (
                  <button
                    key={n.id} type="button" data-note={n.id} title={n.title} aria-current={on ? "page" : undefined}
                    tabIndex={n.id === tabStop ? 0 : -1} onClick={() => onOpen(n.id)}
                    className="manual-rail__note"
                  >
                    <span className="manual-rail__title">{shortTitle(n.title)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
