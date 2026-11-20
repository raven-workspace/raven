import { useEffect, useRef, useState, type ReactNode } from "react";
import { DA_COVER_LABEL, isCoverMarked, type ChecklistGoal } from "../../engines/checklist";
import { getCards, useLibraryVersion } from "../../engines/library/store";
import type { ChecklistStatus, ItemState } from "../../types/checklist";
import { ArrowSquareOut, CaretRightIcon } from "@phosphor-icons/react";
import { cx } from "../../lib/cx";
import { Button, CARET_TURN, ChipSet, Collapse, Disclosure, IconButton, Textarea, fieldLabelClass } from "../../ui";
import { ToggleGroup, ToggleGroupItem } from "../../ui/shadcn/toggle-group";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { CommandList, type FilledCommand } from "./CommandList";
import { FileChip } from "./FileChip";
import { PortChip } from "./PortChip";
import { EvidenceLinks, type EvidenceLink } from "./EvidenceLinks";
import "./GoalRow.scss";

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
    <ToggleGroup type="single" aria-label={label} value={status} onValueChange={(v) => v && onStatus(v as ChecklistStatus)}>
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
          <Button key={id} size="sm" className="goal-row__card-link" title={`From card ${title}`} onClick={() => useArsenalStore.getState().openCard(id)}>
            <span className="goal-row__card-label">From card {title}</span>
            <ArrowSquareOut size={16} aria-hidden className="goal-row__card-icon" />
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
      <ul className="goal-row__creds">
        {labels.map((l) => (
          <li key={l} title={l} className="goal-row__cred">{l}</li>
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
  const titleClass = status === "done" ? "goal-row__title--done" : status === "na" ? "goal-row__title--muted" : undefined;
  const cover = isCoverMarked(state);

  return (
    <li ref={root} data-goal-id={goal.id} data-status={status} className={cx("goal-row", cover && "goal-row--cover")}>
      <IconButton
        icon={CaretRightIcon}
        label={`${open ? "Collapse" : "Expand"} ${goal.title}`}
        aria-expanded={open}
        className={CARET_TURN}
        onClick={() => setOpen((o) => !o)}
      />
      <div data-testid="goal-title-col" className="goal-row__title-col">
        <span className={cx("goal-row__title", titleClass)}>{goal.title}</span>
      </div>
      {cover && <span className="goal-row__cover">{DA_COVER_LABEL}</span>}
      <div data-testid="goal-status">
        <StatusToggles label={`Status: ${goal.title}`} status={status} onStatus={(s) => onStatus(goal.id, s)} />
      </div>
      {status === "done" && newCredLabels && newCredLabels.length > 0 && (
        <div className="goal-row__wide"><NewCredNotice labels={newCredLabels} /></div>
      )}
      <Collapse open={open} className="goal-row__wide" contentClassName="goal-row__body">
          {goal.why && <p className="goal-row__text">{goal.why}</p>}
          {commands.length > 0 ? (
            <>
              <FileChip commands={commands} />
              <PortChip commands={commands} />
              <CommandList commands={commands} hostName={hostName ?? null} />
              <CardLinks commands={commands} />
            </>
          ) : (
            emptyCommandsText && <p className="goal-row__text">{emptyCommandsText}</p>
          )}
          {children}
          <div className="goal-row__notes">
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
      </Collapse>
    </li>
  );
}
