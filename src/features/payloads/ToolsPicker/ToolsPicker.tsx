import * as Popover from "@radix-ui/react-popover";
import { useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { TOOL_LABEL } from "../../../engines/payloads/fit";
import type { ToolId } from "../../../engines/payloads/types";
import { cx } from "../../../lib/cx";
import { PickerTrigger } from "../../../ui/index";
import type { ChipPickerHandle } from "../../arsenal/ChipPicker/ChipPicker";
import { useEscapeWhile } from "../../../lib/keys";
import "./ToolsPicker.scss";

type Tick = "present" | "missing";
type State = "unknown" | Tick;
/** A row's three choices: no tick of yours (the log's value, else unknown), on box, missing. */
type Choice = "auto" | Tick;
export type ToolTicks = Partial<Record<ToolId, Tick>>;

const TOOLS = Object.keys(TOOL_LABEL) as ToolId[];
const CHOICES: Choice[] = ["auto", "present", "missing"];
const STATE_LABEL: Record<State, string> = { unknown: "unknown", present: "on box", missing: "missing" };

/** What a tool reads as: your tick, else the log's, else unknown. */
const stateOf = (t: ToolId, own: ToolTicks, log: ToolTicks): State => own[t] ?? log[t] ?? "unknown";
/** The row's picked choice: your tick, else "auto". */
const choiceOf = (t: ToolId, own: ToolTicks): Choice => own[t] ?? "auto";
/** The "auto" choice's label: "from your log" where the log has a value, else "unknown". */
const autoLabel = (t: ToolId, log: ToolTicks) => (log[t] !== undefined ? "from your log" : "unknown");

/** Your ticks with `t` set to `c`; "auto" drops your tick, so the log's value (if any) reads again. */
function withChoice(own: ToolTicks, t: ToolId, c: Choice): ToolTicks {
  const next = { ...own };
  if (c === "auto") delete next[t];
  else next[t] = c;
  return next;
}

/** "Tools: 2 set" or "Tools: not set": how many tools read on box or missing. */
export const toolsSummary = (own: ToolTicks, log: ToolTicks) => {
  const n = TOOLS.filter((t) => stateOf(t, own, log) !== "unknown").length;
  return n > 0 ? `${n} set` : "not set";
};

/**
 * Which tools the box has: a `PickerTrigger` ("Tools  2 set") and, open, one row per tool with a three-way choice:
 * "from your log" (or "unknown" where the log says nothing) / on box / missing. A row the log filled shows what it says
 * under the tool's name; your tick wins over it, and "from your log" hands the row back to the log. Focus stays on the trigger like ChipPicker: ↑↓ move, ←→ or Space cycle, a click picks, Esc or ↵
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
  useEscapeWhile(open, () => setOpen(false));

  /** One step through from your log (or unknown) → on box → missing, round again. */
  const cycle = (t: ToolId, dir: 1 | -1) => {
    const i = CHOICES.indexOf(choiceOf(t, own));
    onChange(withChoice(own, t, CHOICES[(i + dir + CHOICES.length) % CHOICES.length]!));
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
        <div className="tools-picker">
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
          // One column grid shared by every row (subgrid), so the choices line up whether a row says "unknown" or "from your log".
          className="tools-picker__list"
        >
          {TOOLS.map((t, i) => {
            const state = stateOf(t, own, log);
            const choice = choiceOf(t, own);
            const said = log[t];
            const source = said === undefined ? "" : choice === "auto" ? ", from your log" : ", over your log";
            return (
              <div
                key={t} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                aria-label={`${TOOL_LABEL[t]}: ${STATE_LABEL[state]}${source}`}
                onMouseMove={() => setActive(i)}
                className="tools-picker__option"
              >
                {/* What the log says sits under the name, so the list stays narrow. */}
                <span className="tools-picker__tool">
                  <span className="tools-picker__name">{TOOL_LABEL[t]}</span>
                  {said !== undefined && <span className="tools-picker__log">log: {STATE_LABEL[said]}</span>}
                </span>
                {CHOICES.map((c) => (
                  <span
                    key={c} aria-hidden onClick={() => onChange(withChoice(own, t, c))}
                    className={cx("tools-picker__choice", c === choice ? `tools-picker__choice--${c}` : "tools-picker__choice--idle")}
                  >
                    {c === "auto" ? autoLabel(t, log) : STATE_LABEL[c]}
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
