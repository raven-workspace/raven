import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChecklistGoal } from "../../engines/checklist";
import type { ChecklistStatus, ItemState } from "../../types/checklist";
import { Textarea, Toggle, labelClass } from "../../ui";
import { CommandList, type FilledCommand } from "./CommandList";
import { EvidenceLinks, type EvidenceLink } from "./EvidenceLinks";

export type { FilledCommand, EvidenceLink };

const STATUSES: { value: ChecklistStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "Doing" },
  { value: "done", label: "Done" },
  { value: "na", label: "N/A" },
];

export interface GoalRowProps {
  goal: Pick<ChecklistGoal, "id" | "title" | "why">;
  state: ItemState | undefined;
  commands: FilledCommand[];
  evidence: EvidenceLink[];
  /** Shown instead of the command list when exam rules removed every command. */
  emptyCommandsText?: string;
  onStatus: (goalId: string, status: ChecklistStatus) => void;
  onNotes: (goalId: string, notes: string) => void;
  onOpenEntry?: (entryId: string) => void;
  /** Changes each time the row is asked for: it expands and scrolls into view. */
  focus?: number;
  children?: ReactNode;
}

export function GoalRow({ goal, state, commands, evidence, emptyCommandsText, onStatus, onNotes, onOpenEntry, focus, children }: GoalRowProps) {
  const status = state?.status ?? "todo";
  const [open, setOpen] = useState(focus !== undefined || status === "todo" || status === "in_progress");
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus !== undefined) setOpen(true);
  }
  const notes = state?.notes ?? "";
  const root = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focus === undefined) return;
    root.current?.scrollIntoView({ block: "start" });
  }, [focus]);
  const titleClass = status === "done" ? "text-muted line-through" : status === "na" ? "text-muted" : "text-fg";

  return (
    <li ref={root} data-goal-id={goal.id} className="border-b border-line py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${goal.title}`}
          onClick={() => setOpen((o) => !o)}
          className="w-4 shrink-0 cursor-default text-xs text-muted hover:text-fg"
        >
          {open ? "▾" : "▸"}
        </button>
        <span className={`min-w-0 flex-1 text-[13px] ${titleClass}`}>{goal.title}</span>
        <div role="group" aria-label={`Status: ${goal.title}`} className="inline-flex shrink-0 gap-0.5">
          {STATUSES.map((s) => (
            <Toggle key={s.value} on={status === s.value} onChange={() => onStatus(goal.id, s.value)}>
              {s.label}
            </Toggle>
          ))}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-3 pl-7">
          {goal.why && <p className="m-0 text-xs text-muted">{goal.why}</p>}
          {commands.length > 0 ? (
            <CommandList commands={commands} />
          ) : (
            emptyCommandsText && <p className="m-0 text-xs text-muted">{emptyCommandsText}</p>
          )}
          {children}
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Notes</span>
            <Textarea
              key={notes}
              rows={2}
              aria-label={`Notes: ${goal.title}`}
              defaultValue={notes}
              onBlur={(e) => {
                if (e.currentTarget.value !== notes) onNotes(goal.id, e.currentTarget.value);
              }}
            />
          </div>
          <EvidenceLinks evidence={evidence} onOpen={(id) => onOpenEntry?.(id)} />
        </div>
      )}
    </li>
  );
}
