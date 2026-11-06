import { useId, useState, type KeyboardEvent, type Ref } from "react";
import { Input } from "../../ui";
import type { Suggestion } from "./suggest";

/**
 * A fill-value field with suggestions from what Raven knows. ↓/↑ move through them, ↵ picks one (and is kept from
 * the surrounding palette, which would copy), anything typed is still free text.
 */
export function TokenInput({ name, value, onChange, suggestions, placeholder, className, ref }: {
  name: string; value: string; onChange: (value: string) => void; suggestions: Suggestion[];
  placeholder?: string; className?: string; ref?: Ref<HTMLInputElement>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = value.trim().toLowerCase();
  const shown = suggestions.filter((s) => s.value !== value && (!typed || s.value.toLowerCase().includes(typed))).slice(0, 8);
  const expanded = open && shown.length > 0;

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
    } else if (e.key === "Escape" && expanded) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <Input
        ref={ref}
        mono
        aria-label={`Value for ${name}`}
        aria-autocomplete="list"
        aria-controls={listId}
        {...(expanded && shown[active] ? { "aria-activedescendant": `${listId}-${active}` } : {})}
        autoComplete="off"
        className={className}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
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
          id={listId}
          role="listbox"
          aria-label={`Suggestions for ${name}`}
          className="absolute left-0 top-full z-50 mt-1 flex max-h-56 min-w-full list-none flex-col overflow-y-auto rounded-sm border border-line-2 bg-surface p-0.5 shadow-lg"
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
              onMouseMove={() => setActive(i)}
              className={`flex cursor-default items-center justify-between gap-3 rounded-sm px-2 py-0.5 font-mono text-[12px] whitespace-nowrap ${i === active ? "bg-surface-2 text-fg" : "text-fg-2"}`}
            >
              <span>{s.value}</span>
              {s.hint && <span className="font-sans text-[11px] text-muted">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
