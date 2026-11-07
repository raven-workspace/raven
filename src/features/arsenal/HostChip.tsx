import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";

export interface HostChipHandle { open(): void }

const FLASH_MS = 600;
const TYPEAHEAD_MS = 700;

/**
 * The host scope at the right edge of the search bar: a compact muted "for <host> ⌄" button with no Tab stop.
 * A click or ⌥H (see `isHostPickKey`, `ref.open()`) opens a listbox of "No host" plus each host with its IP:
 * arrows move, Enter picks, Esc closes and gives focus back, and typeahead works only inside the open list.
 * `engagementName` is shown when the engagement is not the route's (full-screen Arsenal).
 */
export function HostChip({ hosts, value, onChange, engagementName, align = "end", ref }: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void; engagementName?: string;
  /** Which edge of the chip the list lines up with; "end" for a chip at the right edge of a bar. */
  align?: "start" | "end"; ref?: Ref<HostChipHandle>;
}) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [flash, setFlash] = useState(false);

  const current = value ? hosts.find((h) => h.id === value) : undefined;
  const shortName = current ? shortHostName(current.name) : "no host";
  const options = [{ id: null as string | null, label: "No host", name: "No host", ip: "" }, ...hosts.map((h) => ({ id: h.id as string | null, label: h.ip ? `${h.name}  ${h.ip}` : h.name, name: h.name, ip: h.ip ?? "" }))];

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const openList = () => {
    const prev = document.activeElement;
    before.current = prev && prev !== buttonRef.current ? prev : null;
    buttonRef.current?.focus();
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: openList }));

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
    onChange(id);
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
    <div className="relative grid min-w-0 max-w-2/5 shrink">
      <button
        ref={buttonRef}
        type="button"
        tabIndex={-1}
        aria-label={`Fill for host: ${shortName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...(open ? { "aria-controls": listId, "aria-activedescendant": `${listId}-${active}` } : {})}
        title={engagementName ? `${engagementName} · fill for another host (⌥H)` : "Fill for another host (⌥H)"}
        {...(flash ? { "data-flash": "" } : {})}
        onClick={() => (open ? close(true) : openList())}
        onBlur={() => open && close(false)}
        onKeyDown={onKeyDown}
        className="grid min-w-0 cursor-default grid-flow-col items-center justify-start gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap text-muted hover:bg-surface-2 focus-visible:bg-surface-2"
      >
        {engagementName ? <span className="min-w-0 truncate">{engagementName} ·</span> : null}
        <span>for</span>
        <b className="max-w-36 truncate font-medium text-fg-2">{shortName}</b>
        <span aria-hidden="true" className="text-[10px] opacity-70">⌄</span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Fill for host"
          className={`absolute top-full z-30 ${align === "end" ? "right-0" : "left-0"} m-0 mt-1 grid max-h-60 min-w-48 list-none overflow-y-auto rounded-md border border-line-2 bg-surface p-1 text-xs shadow-lg`}
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
              onMouseMove={() => setActive(i)}
              className={`grid cursor-default grid-cols-[1fr_auto] gap-4 rounded-sm px-2 py-1 whitespace-pre ${i === active ? "bg-accent/10 text-accent" : "text-fg-2"}`}
            >
              <span className="truncate">{o.name}</span>
              <span className="text-muted">{o.ip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ⌥H: by key code, since macOS turns ⌥H into "˙". */
export const isHostPickKey = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean =>
  e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyH" || e.key.toLowerCase() === "h");
