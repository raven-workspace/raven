import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";

const CLOSE_MS = 5000;
const SIDEBAR = '[data-slot="sidebar-gap"]';

/** 16px right of the sidebar's current edge (0 with no sidebar); follows its expand and collapse. */
function useSidebarLeft(): number {
  const read = () => (document.querySelector(SIDEBAR)?.getBoundingClientRect().right ?? 0) + 16;
  const [left, setLeft] = useState(read);
  useEffect(() => {
    const el = document.querySelector(SIDEBAR);
    const update = () => setLeft(read());
    update();
    const ro = typeof ResizeObserver === "undefined" || !el ? null : new ResizeObserver(update);
    if (el) ro?.observe(el);
    el?.addEventListener("transitionend", update);
    return () => {
      ro?.disconnect();
      el?.removeEventListener("transitionend", update);
    };
  }, []);
  return left;
}

/**
 * A bottom-left notice, portaled to the body and 16px clear of the sidebar, that closes itself after 5s; the timer waits while it is hovered or focused. Close sits top
 * right with the optional action (Undo) under it, beside the content rather than below it, so the notice stays short.
 * `timerKey` restarts the timer when the notice's subject changes.
 */
export function TimedNotice({
  children,
  onClose,
  closeLabel = "Close",
  action,
  timerKey,
}: {
  children: ReactNode;
  onClose(): void;
  closeLabel?: string;
  action?: ReactNode;
  timerKey?: unknown;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = hover || focus;
  const left = useSidebarLeft();

  useEffect(() => {
    if (held) return;
    const t = setTimeout(onClose, CLOSE_MS);
    return () => clearTimeout(t);
  }, [timerKey, held, onClose]);

  return createPortal(
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{ left }}
      className="fixed bottom-4 z-50 grid w-[min(400px,calc(100vw-2rem))] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-md border border-line-2 bg-surface px-3 py-3 text-meta shadow-lg"
    >
      <div className={action ? "row-span-2 grid min-w-0" : "grid min-w-0"}>{children}</div>
      <IconButton icon={XIcon} label={closeLabel} onClick={onClose} className="justify-self-end" />
      {action && <div className="grid justify-self-end">{action}</div>}
    </div>,
    document.body,
  );
}
