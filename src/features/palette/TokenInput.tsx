import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Input } from "../../ui";
import type { Suggestion } from "./suggest";

const LIST_MAX = 224;
const GAP = 4;

/**
 * Where the suggestion list goes so it stays inside what clips it: below the field, or above when the room below
 * (down to the hint line, which it must never cover) is smaller than the list and smaller than the room above.
 */
function placeList(field: HTMLElement, list: HTMLElement): { placement: "below" | "above"; maxHeight: number } {
  const bounds = field.closest("[data-popup-bounds]") ?? field.closest("aside,[role=dialog]");
  if (!bounds) return { placement: "below", maxHeight: LIST_MAX };
  const box = bounds.getBoundingClientRect();
  const f = field.getBoundingClientRect();
  const hint = bounds.querySelector("[data-hint-line]")?.getBoundingClientRect();
  const floor = hint && hint.top >= f.bottom ? Math.min(box.bottom, hint.top) : box.bottom;
  const below = floor - f.bottom - GAP;
  const above = f.top - box.top - GAP;
  const want = Math.min(LIST_MAX, list.scrollHeight);
  const placement = below >= want || below >= above ? "below" : "above";
  return { placement, maxHeight: Math.max(0, Math.min(LIST_MAX, placement === "below" ? below : above)) };
}

/**
 * A fill-value field with suggestions from what Raven knows. ↓/↑ move through them, ↵ picks one (and is kept from
 * the surrounding palette, which would copy), anything typed is still free text.
 */
export function TokenInput({ name, value, onChange, suggestions, placeholder, className, autoValue, ref }: {
  name: string; value: string; onChange: (value: string) => void; suggestions: Suggestion[];
  /** The value is an auto-fill, not something typed: offer every suggestion, and select it on focus so typing replaces it. */
  autoValue?: boolean;
  placeholder?: string; className?: string; ref?: Ref<HTMLInputElement>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = value.trim().toLowerCase();
  const shown = suggestions.filter((s) => s.value !== value && (autoValue || !typed || s.value.toLowerCase().includes(typed))).slice(0, 8);
  const expanded = open && shown.length > 0;

  // Esc with the list open closes only the list. Window capture runs before Radix's document-level Esc (which
  // dismisses the palette unless the event is already defaultPrevented); the drawer skips an expanded combobox.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded]);

  const fieldRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [place, setPlace] = useState<{ placement: "below" | "above"; maxHeight: number }>({ placement: "below", maxHeight: LIST_MAX });
  useLayoutEffect(() => {
    if (!expanded || !fieldRef.current || !listRef.current) return;
    setPlace(placeList(fieldRef.current, listRef.current));
  }, [expanded, shown.length]);

  const pick = (s: Suggestion) => {
    onChange(s.value);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!shown.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === "ArrowDown" ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)));
    } else if (e.key === "Enter" && expanded && shown[active] && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      pick(shown[active]);
    }
  };

  return (
    <span ref={fieldRef} className="relative inline-grid">
      <Input
        ref={ref}
        mono
        role="combobox"
        aria-label={`Value for ${name}`}
        aria-autocomplete="list"
        aria-expanded={expanded}
        {...(expanded ? { "aria-controls": listId } : {})}
        {...(expanded && shown[active] ? { "aria-activedescendant": `${listId}-${active}` } : {})}
        autoComplete="off"
        className={className}
        placeholder={placeholder}
        value={value}
        onFocus={(e) => {
          setOpen(true);
          if (autoValue) e.currentTarget.select();
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          data-placement={place.placement}
          style={{ maxHeight: place.maxHeight }}
          aria-label={`Suggestions for ${name}`}
          className={`absolute left-0 z-50 m-0 grid w-max min-w-full max-w-md ${place.placement === "above" ? "bottom-full mb-1" : "top-full mt-1"} list-none overflow-y-auto rounded-sm border border-line-2 bg-surface p-1 shadow-lg`}
        >
          {shown.map((s, i) => (
            <li
              key={s.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the field must keep focus.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              title={s.value}
              onMouseMove={() => setActive(i)}
              className={`grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 py-1 font-mono text-code whitespace-nowrap ${i === active ? "bg-surface-hi text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-fg-2"}`}
            >
              <span className="min-w-0 truncate">{s.value}</span>
              {(s.hint || s.role) && (
                <span className="grid grid-flow-col items-baseline gap-2 font-sans text-meta text-muted">
                  {s.hint && <span>{s.hint}</span>}
                  {s.role && <span className="text-faint">{s.role}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
