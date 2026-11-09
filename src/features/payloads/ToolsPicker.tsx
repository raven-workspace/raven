import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { TOOL_LABEL } from "../../engines/payloads/fit";
import type { ToolId } from "../../engines/payloads/types";
import { cx } from "../../lib/cx";
import { PickerTrigger } from "../../ui";
import type { ChipPickerHandle } from "../arsenal/ChipPicker";

type Tick = "present" | "missing";
type State = "unknown" | Tick;
export type ToolTicks = Partial<Record<ToolId, Tick>>;

const TOOLS = Object.keys(TOOL_LABEL) as ToolId[];
const STATES: State[] = ["unknown", "present", "missing"];
const STATE_LABEL: Record<State, string> = { unknown: "unknown", present: "on box", missing: "missing" };

/** What a tool reads as: your tick, else the log's, else unknown. */
const stateOf = (t: ToolId, own: ToolTicks, log: ToolTicks): State => own[t] ?? log[t] ?? "unknown";

/** Your ticks with `t` set to `s`; "unknown" drops your tick, so the log's value (if any) shows again. */
function withState(own: ToolTicks, t: ToolId, s: State): ToolTicks {
  const next = { ...own };
  if (s === "unknown") delete next[t];
  else next[t] = s;
  return next;
}

/** "Tools: 2 set" or "Tools: not set": how many tools read on box or missing. */
export const toolsSummary = (own: ToolTicks, log: ToolTicks) => {
  const n = TOOLS.filter((t) => stateOf(t, own, log) !== "unknown").length;
  return n > 0 ? `${n} set` : "not set";
};

/**
 * Which tools the box has: a `PickerTrigger` ("Tools  2 set") and, open, one row per tool with a three-way choice
 * (unknown / on box / missing). Rows the log filled say "from your log"; your tick wins over it, and "unknown" hands the
 * row back to the log. Focus stays on the trigger like ChipPicker: ↑↓ move, ←→ or Space cycle, a click picks, Esc or ↵
 * closes with focus on the trigger, Tab moves on.
 */
export function ToolsPicker({ own, log, onChange, align = "start", ref }: {
  own: ToolTicks; log: ToolTicks; onChange: (tools: ToolTicks) => void; align?: "start" | "end"; ref?: Ref<ChipPickerHandle>;
}) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const openList = () => {
    buttonRef.current?.focus();
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: openList, focus: () => buttonRef.current?.focus() }));

  // Esc closes only the list; focus stays on the trigger. What keeps the drawer open is the drawer's own Esc handler, which
  // leaves Esc alone while the focused trigger is aria-expanded; preventDefault here also stops Radix's own dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  /** One step through unknown → on box → missing; skips a step that would not change what the row reads. */
  const cycle = (t: ToolId, dir: 1 | -1) => {
    const now = stateOf(t, own, log);
    let i = STATES.indexOf(own[t] ?? "unknown");
    for (let k = 0; k < STATES.length - 1; k++) {
      i = (i + dir + STATES.length) % STATES.length;
      const next = withState(own, t, STATES[i]!);
      if (stateOf(t, next, log) !== now) return onChange(next);
    }
  };

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
    const t = TOOLS[active]!;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") setActive((a) => Math.max(0, Math.min(TOOLS.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    else if (e.key === "Home" || e.key === "End") setActive(e.key === "Home" ? 0 : TOOLS.length - 1);
    else if (e.key === "ArrowRight" || e.key === " ") cycle(t, 1);
    else if (e.key === "ArrowLeft") cycle(t, -1);
    else if (e.key === "Enter") setOpen(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const summary = toolsSummary(own, log);
  return (
    // Radix positions the list in a portal (position: fixed), so a scrolling column or the drawer's edge never clips it:
    // it shifts to stay inside the window and flips above the chip near the bottom. Focus stays on the trigger.
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="grid min-w-0">
          <PickerTrigger
            ref={buttonRef} prefix="Tools" value={summary} aria-label={`Tools: ${summary}`} aria-haspopup="listbox" aria-expanded={open}
            {...(open ? { "aria-controls": listId, "aria-activedescendant": `${listId}-${active}` } : {})}
            title="Which tools the box has (pick to override your log for this host)"
            onClick={() => (open ? setOpen(false) : openList())}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={listId} role="listbox" aria-label="Tools" data-tools-picker=""
          side="bottom" align={align} sideOffset={4} collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
          // A press on the trigger toggles it itself; Radix would count it as outside and close first.
          onInteractOutside={(e) => { if (buttonRef.current?.contains(e.target as Node)) e.preventDefault(); }}
          // Keeps focus on the trigger so its keys keep working and blur does not close the list first.
          onMouseDown={(e) => e.preventDefault()}
          className="z-50 grid max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-md border border-line-2 bg-surface p-1 text-body shadow-lg"
        >
          {TOOLS.map((t, i) => {
            const state = stateOf(t, own, log);
            const fromLog = own[t] === undefined && log[t] !== undefined;
            return (
              <div
                key={t} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                aria-label={`${TOOL_LABEL[t]}: ${STATE_LABEL[state]}${fromLog ? ", from your log" : ""}`}
                onMouseMove={() => setActive(i)}
                className={cx(
                  "grid cursor-default grid-cols-[6.5rem_repeat(3,max-content)] items-center gap-2 rounded-sm px-2 py-1",
                  i === active ? "bg-accent/10 shadow-[inset_2px_0_0_var(--accent)]" : "",
                )}
              >
                {/* "from your log" sits under the name, so the list stays narrow. */}
                <span className="grid min-w-0">
                  <span className={cx("truncate", i === active ? "text-accent" : "text-fg-2")}>{TOOL_LABEL[t]}</span>
                  {fromLog && <span className="truncate text-meta text-muted">from your log</span>}
                </span>
                {STATES.map((s) => (
                  <span
                    key={s} aria-hidden onClick={() => onChange(withState(own, t, s))}
                    className={cx(
                      "rounded-sm px-1 text-meta ring-1 ring-inset",
                      s === state
                        ? s === "missing" ? "text-warn ring-warn" : s === "present" ? "text-accent ring-accent" : "text-fg-2 ring-line-2"
                        : "text-muted ring-transparent hover:text-fg-2",
                    )}
                  >
                    {STATE_LABEL[s]}
                  </span>
                ))}
              </div>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
