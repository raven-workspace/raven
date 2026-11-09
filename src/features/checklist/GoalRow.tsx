import { useEffect, useRef, useState, type ReactNode } from "react";
import { DA_COVER_LABEL, isCoverMarked, type ChecklistGoal } from "../../engines/checklist";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import type { ChecklistStatus, ItemState } from "../../types/checklist";
import { ArrowSquareOut, CaretDown, CaretRight } from "@phosphor-icons/react";
import { Button, ChipSet, Disclosure, IconButton, Textarea, fieldLabelClass } from "../../ui";
import { ToggleGroup, ToggleGroupItem } from "../../ui/shadcn/toggle-group";
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
 * To do / Doing / Done / N/A for one step: a 28px segmented control (shadcn ToggleGroup), exactly one segment on,
 * the selected one in accent. Pressing the selected segment again keeps it.
 */
export function StatusToggles({ label, status, onStatus }: { label: string; status: ChecklistStatus; onStatus: (status: ChecklistStatus) => void }) {
  return (
    <ToggleGroup type="single" size="sm" aria-label={label} value={status} onValueChange={(v) => v && onStatus(v as ChecklistStatus)}>
      {STATUSES.map((s) => (
        <ToggleGroupItem key={s.value} value={s.value}>{s.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
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
  /** The short name of the host the commands are filled for, for "Copied for <host>". */
  hostName?: string;
  /** Changes each time the row is asked for: it expands and scrolls into view. */
  focus?: number;
  children?: ReactNode;
}

/** One button per distinct Arsenal card behind a step's commands, and a way into the rest of the Arsenal. */
function CardLinks({ commands }: { commands: FilledCommand[] }) {
  // Re-render after an import so card titles follow the vault.
  useLibraryVersion();
  const cards = getCards();
  const ids = [...new Set(commands.map((c) => c.cardId).filter((id): id is string => !!id))];
  if (ids.length === 0) return null;
  return (
    <ChipSet>
      {ids.map((id) => {
        const title = cards.find((c) => c.id === id)?.title ?? id;
        return (
          <Button key={id} size="sm" className="min-w-0 max-w-full" title={`From card ${title}`} onClick={() => useArsenalStore.getState().openCard(id)}>
            <span className="min-w-0 truncate">From card {title}</span>
            <ArrowSquareOut size={16} aria-hidden className="shrink-0" />
          </Button>
        );
      })}
      <Button size="sm" onClick={() => useArsenalStore.getState().openCard()}>More in Arsenal</Button>
    </ChipSet>
  );
}

/** "N new credentials since done" as a Disclosure with its count; the labels (never secrets) list one per line inside. */
function NewCredNotice({ labels }: { labels: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure label="New credentials since done" count={labels.length} open={open} onOpenChange={setOpen}>
      <ul className="m-0 grid min-w-0 list-none gap-1 px-1 py-1">
        {labels.map((l) => (
          <li key={l} title={l} className="min-w-0 truncate text-code text-fg-2">{l}</li>
        ))}
      </ul>
    </Disclosure>
  );
}

export function GoalRow({ goal, state, commands, evidence, emptyCommandsText, newCredLabels, onStatus, onNotes, onOpenEntry, hostName, focus, children }: GoalRowProps) {
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
  const cover = isCoverMarked(state);
  const Caret = open ? CaretDown : CaretRight;

  return (
    <li ref={root} data-goal-id={goal.id} data-status={status} className={`grid items-start gap-x-2 gap-y-3 border-b border-line py-3 ${cover ? "grid-cols-[28px_minmax(0,1fr)_auto_auto]" : "grid-cols-[28px_minmax(0,1fr)_auto]"}`}>
      <IconButton
        icon={Caret}
        label={`${open ? "Collapse" : "Expand"} ${goal.title}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <div data-testid="goal-title-col" className="grid min-w-0 gap-1">
        <span className={`min-w-0 py-1 text-body ${titleClass}`}>{goal.title}</span>
      </div>
      {cover && <span className="py-1 text-meta text-muted">{DA_COVER_LABEL}</span>}
      <div data-testid="goal-status">
        <StatusToggles label={`Status: ${goal.title}`} status={status} onStatus={(s) => onStatus(goal.id, s)} />
      </div>
      {status === "done" && newCredLabels && newCredLabels.length > 0 && (
        <div className="col-start-2 col-end-[-1] min-w-0"><NewCredNotice labels={newCredLabels} /></div>
      )}
      {open && (
        <div className="col-start-2 col-end-[-1] grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          {goal.why && <p className="m-0 text-meta text-muted">{goal.why}</p>}
          {commands.length > 0 ? (
            <>
              <FileChip commands={commands} />
              <PortChip commands={commands} />
              <CommandList commands={commands} hostName={hostName ?? null} />
              <CardLinks commands={commands} />
            </>
          ) : (
            emptyCommandsText && <p className="m-0 text-meta text-muted">{emptyCommandsText}</p>
          )}
          {children}
          <div className="grid gap-1">
            <span className={fieldLabelClass}>Notes</span>
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
