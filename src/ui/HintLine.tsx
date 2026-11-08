import * as Popover from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "./Kbd";

export interface Hint {
  keys: string;
  label: string;
  /** 1 = always shown; higher numbers drop out first. */
  priority: number;
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable || el.closest("[contenteditable='true'], [contenteditable='']") !== null;
}

function HintUnit({ hint }: { hint: Hint }) {
  return (
    <span data-hint className="inline-grid grid-flow-col items-center gap-[6px] whitespace-nowrap text-meta text-muted-2">
      {/* "⌥H ⌥C" is two caps side by side in one unit. */}
      <span className="inline-grid grid-flow-col items-center gap-1">
        {hint.keys.split(" ").map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
      <span>{hint.label}</span>
    </span>
  );
}

/**
 * Requirement: the HintLine must sit in a parent whose width does not depend on the
 * HintLine's own content (a block or grid parent, not an inline/auto-sized one). The line
 * fills that width (`w-full`) and the resize observer watches the parent, so drops never
 * feed back into the measurement.
 *
 * One-line key hints. Shows the top `max` by priority; lowest priority drop out when narrow.
 * A final `?` opens the full list. The `?` key does the same while focus is inside the
 * closest `[data-hint-surface]` ancestor and not in a text field.
 */
export function HintLine({ hints, max = 5, ariaLabel }: { hints: Hint[]; max?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dropped, setDropped] = useState(0);
  const [tick, setTick] = useState(0);

  // Top `max` by priority (stable), then drop order: lowest priority (largest number) first, later ties first.
  const { base, dropOrder } = useMemo(() => {
    const indexed = hints.map((h, i) => ({ h, i }));
    const top = [...indexed].sort((a, b) => a.h.priority - b.h.priority || a.i - b.i).slice(0, max);
    return {
      base: top.sort((a, b) => a.i - b.i),
      dropOrder: [...top].filter((x) => x.h.priority > 1).sort((a, b) => b.h.priority - a.h.priority || b.i - a.i).map((x) => x.i),
    };
  }, [hints, max]);

  const goneSet = new Set(dropOrder.slice(0, dropped));
  const shown = base.filter((x) => !goneSet.has(x.i));

  // New hints or max: start again from the full set (adjusting state during render).
  const [seen, setSeen] = useState({ hints, max });
  if (seen.hints !== hints || seen.max !== max) {
    setSeen({ hints, max });
    setDropped(0);
  }

  // Re-measure after every render: still overflowing means drop one more.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth && dropped < dropOrder.length) setDropped(dropped + 1);
  }, [dropped, dropOrder.length, tick, seen]);

  // On resize, start again from the full set and let the layout effect trim.
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDropped(0);
      setTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const surface = ref.current?.closest("[data-hint-surface]");
      const active = document.activeElement;
      // Innermost surface wins, so nested surfaces never open two lists.
      if (!surface || !active || active.closest("[data-hint-surface]") !== surface || isTyping(active)) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={ref}
      data-hint-line
      role="group"
      aria-label={ariaLabel}
      className="grid w-full min-w-0 grid-flow-col items-center justify-start gap-x-6 overflow-hidden"
    >
      {shown.map(({ h, i }) => (
        <HintUnit key={i} hint={h} />
      ))}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="All shortcuts"
            className="inline-grid place-items-center hover:opacity-80"
          >
            <Kbd>?</Kbd>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            className="z-50 grid gap-2 rounded-md border border-line-strong bg-surface p-3 shadow-lg"
          >
            {hints.map((h, i) => (
              <HintUnit key={i} hint={h} />
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
