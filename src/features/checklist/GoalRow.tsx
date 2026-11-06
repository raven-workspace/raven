import { useEffect, useRef, useState, type ReactNode } from "react";
import { DA_COVER_LABEL, isCoverMarked, type ChecklistGoal } from "../../engines/checklist";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import type { ChecklistStatus, ItemState } from "../../types/checklist";
import { cx } from "../../lib/cx";
import { Textarea, labelClass } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { CommandList, type FilledCommand } from "./CommandList";
import { FileChip } from "./FileChip";
import { PortChip } from "./PortChip";
import { EvidenceLinks, type EvidenceLink } from "./EvidenceLinks";

export type { FilledCommand, EvidenceLink };

const STATUSES: { value: ChecklistStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "Doing" },
  { value: "done", label: "Done" },
  { value: "na", label: "N/A" },
];

/**
 * To do / Doing / Done / N/A for one step, as one small button group: a rounded hairline pill with thin dividers,
 * the selected segment in accent. The checklist's status control, shared with the Now panel.
 */
export function StatusToggles({ label, status, onStatus }: { label: string; status: ChecklistStatus; onStatus: (status: ChecklistStatus) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 divide-x divide-line-2 overflow-hidden rounded-full border border-line-2">
      {STATUSES.map((s) => {
        const on = status === s.value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => onStatus(s.value)}
            className={cx(
              "inline-flex h-5 cursor-default items-center px-2 text-[11px] leading-none",
              on ? "bg-accent/10 text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export interface GoalRowProps {
  goal: Pick<ChecklistGoal, "id" | "title" | "why">;
  state: ItemState | undefined;
  commands: FilledCommand[];
  evidence: EvidenceLink[];
  /** Shown instead of the command list when exam rules removed every command. */
  emptyCommandsText?: string;
  /** Labels of domain credentials found since this goal was done. */
  newCredLabels?: string[];
  onStatus: (goalId: string, status: ChecklistStatus) => void;
  onNotes: (goalId: string, notes: string) => void;
  onOpenEntry?: (entryId: string) => void;
  /** Changes each time the row is asked for: it expands and scrolls into view. */
  focus?: number;
  children?: ReactNode;
}

/** One link per distinct Arsenal card behind a step's commands, and a way into the rest of the Arsenal. */
function CardLinks({ commands }: { commands: FilledCommand[] }) {
  // Re-render after an import so card titles follow the vault.
  useLibraryVersion();
  const cards = getCards();
  const ids = [...new Set(commands.map((c) => c.cardId).filter((id): id is string => !!id))];
  if (ids.length === 0) return null;
  const linkClass = "cursor-default text-fg-2 hover:text-fg";
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-muted">
      {ids.map((id) => (
        <button key={id} type="button" className={linkClass} onClick={() => useArsenalStore.getState().openCard(id)}>
          From card {cards.find((c) => c.id === id)?.title ?? id} ↗
        </button>
      ))}
      <span aria-hidden="true">·</span>
      <button type="button" className={linkClass} onClick={() => useArsenalStore.getState().openCard()}>more in Arsenal</button>
    </p>
  );
}

/** "N new credentials since this was done", collapsed; the labels (never secrets) list one per line when opened. */
function NewCredNotice({ labels }: { labels: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 text-xs text-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="cursor-default bg-transparent p-0 text-left text-xs text-fg-2 hover:text-fg">
        {labels.length} new credential{labels.length === 1 ? "" : "s"} since this was done {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul className="m-0 mt-1 flex min-w-0 list-none flex-col gap-0.5 p-0">
          {labels.map((l) => (
            <li key={l} className="min-w-0 break-words">{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GoalRow({ goal, state, commands, evidence, emptyCommandsText, newCredLabels, onStatus, onNotes, onOpenEntry, focus, children }: GoalRowProps) {
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
      <div data-testid="goal-head" className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${goal.title}`}
          onClick={() => setOpen((o) => !o)}
          className="w-4 shrink-0 cursor-default text-xs text-muted hover:text-fg"
        >
          {open ? "▾" : "▸"}
        </button>
        <div data-testid="goal-title-col" className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`min-w-0 text-[13px] ${titleClass}`}>{goal.title}</span>
          {status === "done" && newCredLabels && newCredLabels.length > 0 && <NewCredNotice labels={newCredLabels} />}
        </div>
        {isCoverMarked(state) && <span className="shrink-0 text-xs text-muted">{DA_COVER_LABEL}</span>}
        <StatusToggles label={`Status: ${goal.title}`} status={status} onStatus={(s) => onStatus(goal.id, s)} />
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 pl-7">
          {goal.why && <p className="m-0 text-xs text-muted">{goal.why}</p>}
          {commands.length > 0 ? (
            <>
              <FileChip commands={commands} />
              <PortChip commands={commands} />
              <CommandList commands={commands} />
              <CardLinks commands={commands} />
            </>
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
