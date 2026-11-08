import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import { PickerTrigger } from "../../ui";

export interface ChipPickerHandle { open(): void; focus(): void }
export interface ChipOption {
  /** null is the "none" row. */
  id: string | null;
  /** Typeahead matches the start of this. */
  name: string;
  /** Right-hand muted cell. */
  detail?: string;
}

const FLASH_MS = 600;
const TYPEAHEAD_MS = 700;

/**
 * A context picker: a bordered `PickerTrigger` ("Host  dc01 v", amber "Pick one" while `shown` is unset) in the Tab
 * order, and its listbox. A click, Enter or `ref.open()` opens the list: arrows move, Enter picks, Esc closes and gives
 * focus back, typeahead works only inside the open list. A pick that changes `value` flashes the trigger once
 * (`data-flash`). The pointer never moves the list's highlight: hover tints a row, keys and clicks choose.
 */
export function ChipPicker({ options, value, onPick, label, listLabel, title, align = "end", wide, prefix, shown, ref }: {
  options: ChipOption[]; value: string | null; onPick: (id: string | null) => void;
  /** The button's accessible name. */
  label: string; listLabel: string; title: string;
  /** Which edge of the chip the list lines up with. */
  align?: "start" | "end";
  /** Allow the list to grow past min-w-48. */
  wide?: boolean;
  /** The trigger's small prefix ("Host"). */
  prefix: string;
  /** The value the trigger shows; unset shows an amber "Pick one". */
  shown?: string;
  ref?: Ref<ChipPickerHandle>;
}) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const openList = () => {
    const prev = document.activeElement;
    before.current = prev && prev !== buttonRef.current ? prev : null;
    buttonRef.current?.focus();
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: openList, focus: () => buttonRef.current?.focus() }));

  const close = (restore: boolean) => {
    setOpen(false);
    typed.current = { text: "", at: 0 };
    const prev = before.current;
    before.current = null;
    if (restore && prev instanceof HTMLElement && prev.isConnected) prev.focus();
  };

  const pick = (i: number) => {
    const id = options[i]?.id ?? null;
    close(true);
    if (id === value) return;
    onPick(id);
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
  };

  // Esc with the list open closes only the list. Window capture runs before the drawer's and Radix's Esc handlers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(options.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      pick(active);
    } else if (e.key.length === 1 && e.key !== " ") {
      e.preventDefault();
      const now = Date.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + e.key.toLowerCase();
      typed.current = { text, at: now };
      const hit = options.findIndex((o) => o.name.toLowerCase().startsWith(text));
      if (hit >= 0) setActive(hit);
    }
    if (e.key !== "Tab") e.stopPropagation();
  };

  return (
    <div className="relative grid min-w-0">
      <PickerTrigger
        ref={buttonRef}
        prefix={prefix}
        {...(shown ? { value: shown } : {})}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...(open ? { "aria-controls": listId, "aria-activedescendant": `${listId}-${active}` } : {})}
        title={title}
        {...(flash ? { "data-flash": "" } : {})}
        onClick={() => (open ? close(true) : openList())}
        onBlur={() => open && close(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className={`absolute top-full z-30 ${align === "end" ? "right-0" : "left-0"} m-0 mt-1 grid max-h-60 ${wide ? "min-w-80" : "min-w-48"} list-none overflow-y-auto rounded-md border border-line-2 bg-surface p-1 text-body shadow-lg`}
        >
          {options.map((o, i) => (
            <li
              key={o.id ?? "none"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus on the chip so its keys keep working and blur does not close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              className={`grid cursor-default grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-sm px-2 py-1 whitespace-pre ${i === active ? "bg-accent/10 text-accent" : "text-fg-2 hover:bg-surface-hi"}`}
            >
              <span className="truncate">{o.name}</span>
              <span className="text-meta text-muted">{o.detail ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
