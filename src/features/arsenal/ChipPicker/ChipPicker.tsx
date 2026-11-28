import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import { PickerTrigger } from "../../../ui/index";
import { useEscapeWhile } from "../../../lib/keys";
import { cx } from "../../../lib/cx";
import "./ChipPicker.scss";

export interface ChipPickerHandle { open(): void; focus(): void }
export interface ChipOption {
  /** null is the "none" row. */
  id: string | null;
  /** Typeahead matches the start of this. */
  name: string;
  /** Right-hand muted cell. */
  detail?: string;
  /** A second right-hand muted cell. */
  detail2?: string;
}

const FLASH_MS = 600;
const TYPEAHEAD_MS = 700;

/**
 * A context picker: a bordered `PickerTrigger` ("Host  dc01 v", amber "Pick one" while `shown` is unset) in the Tab
 * order, and its listbox. A click, Enter or `ref.open()` opens the list: arrows move, Enter picks, Esc closes and gives
 * focus back, typeahead works only inside the open list. A pick that changes `value` flashes the trigger once
 * (`data-flash`). In the open list the pointer moves the highlight like the arrow keys (a popup, not a pane). Until
 * the user moves it, the highlight follows `value`, so data that loads while the list is open lands on its row.
 */
export function ChipPicker({ options, value, onPick, onMousePick, repick, label, listLabel, title, align = "end", wide, prefix, shown, warn, ref }: {
  options: ChipOption[]; value: string | null; onPick: (id: string | null) => void;
  /** Picking the option already chosen still calls `onPick` (without the flash), for a pick that also acts. */
  repick?: boolean;
  /** After a click on an option (not a key): where focus goes next, so ↵ does not land on the chip and reopen it. */
  onMousePick?: (id: string | null) => void;
  /** The button's accessible name. */
  label: string; listLabel: string; title: string;
  /** Which edge of the chip the list lines up with. */
  align?: "start" | "end";
  /** A wider list (20rem), for options with two detail cells. */
  wide?: boolean;
  /** The trigger's small prefix ("Host"). */
  prefix: string;
  /** The value the trigger shows; unset shows an amber "Pick one". */
  shown?: string;
  /** The shown value reads amber (PickerTrigger's warn). */
  warn?: boolean;
  ref?: Ref<ChipPickerHandle>;
}) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  /** Where the user moved the highlight since the list opened (arrows, Home, End, typeahead, pointer); null follows `value`. */
  const [moved, setMoved] = useState<number | null>(null);
  const active = moved ?? Math.max(0, options.findIndex((o) => o.id === value));
  const [flash, setFlash] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  /** The side the open list lines up with: `align` unless that runs it past its pane's edge (a picker at the end of a wrapping run). */
  const [side, setSide] = useState(align);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const openList = () => {
    const prev = document.activeElement;
    before.current = prev && prev !== buttonRef.current ? prev : null;
    buttonRef.current?.focus();
    setMoved(null);
    setSide(align);
    setOpen(true);
  };

  // Before paint: a list that would run past its pane (the drawer, the page or a dialog) opens from the other side.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const pane = (buttonRef.current?.closest("aside, main, [role=dialog]") ?? document.documentElement).getBoundingClientRect();
    const r = list.getBoundingClientRect();
    if (side === "start" && r.right > pane.right) setSide("end");
    else if (side === "end" && r.left < pane.left) setSide("start");
  }, [open, side]);

  // Before paint: the row that follows `value` (on open, or when it changes) scrolls into view within the list only.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.children[active];
    if (!open || moved !== null || !list || !row) return;
    const r = row.getBoundingClientRect();
    const top = list.getBoundingClientRect().top + list.clientTop;
    if (r.top < top) list.scrollTop -= top - r.top;
    else if (r.bottom > top + list.clientHeight) list.scrollTop += r.bottom - top - list.clientHeight;
  }, [open, moved, active]);
  useImperativeHandle(ref, () => ({ open: openList, focus: () => buttonRef.current?.focus() }));

  const close = (restore: boolean) => {
    setOpen(false);
    typed.current = { text: "", at: 0 };
    const prev = before.current;
    before.current = null;
    if (restore && prev instanceof HTMLElement && prev.isConnected) prev.focus();
  };

  const pick = (i: number, mouse = false) => {
    const id = options[i]?.id ?? null;
    close(true);
    if (mouse) onMousePick?.(id);
    if (id === value) {
      if (repick) onPick(id);
      return;
    }
    onPick(id);
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
  };

  // Esc with the list open closes only the list. Window capture runs before the drawer's and Radix's Esc handlers.
  useEscapeWhile(open, () => close(true));

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
      setMoved(Math.max(0, Math.min(options.length - 1, active + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setMoved(e.key === "Home" ? 0 : options.length - 1);
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
      if (hit >= 0) setMoved(hit);
    }
    if (e.key !== "Tab") e.stopPropagation();
  };

  return (
    <div className="chip-picker">
      <PickerTrigger
        ref={buttonRef}
        prefix={prefix}
        {...(shown ? { value: shown } : {})}
        {...(warn ? { warn } : {})}
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
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className={cx("chip-picker__list", `chip-picker__list--${side}`, wide && "chip-picker__list--wide")}
        >
          {options.map((o, i) => (
            <li
              key={o.id ?? "none"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus on the chip so its keys keep working and blur does not close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i, true)}
              onMouseMove={() => setMoved(i)}
              className="chip-picker__option"
            >
              <span className="chip-picker__name">{o.name}</span>
              <span className="chip-picker__detail">{o.detail ?? ""}</span>
              <span className="chip-picker__detail">{o.detail2 ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
