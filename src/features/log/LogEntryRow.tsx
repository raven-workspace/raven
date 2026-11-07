import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { Button, Chip, Dialog, labelClass } from "../../ui";
import { EditEntryDialog } from "./EditEntryDialog";
import { KIND_LABELS } from "./kindLabels";
import { LogEntryBody } from "./LogEntryBody";
import { useLogMutations } from "./queries";

const pad = (n: number) => String(n).padStart(2, "0");

interface LogEntryRowProps {
  entry: LogEntry;
  hosts: Host[];
  defaultOpen?: boolean;
  /** The host whose page this row is on; it gets no chip, since every row there is about it. */
  currentHostId?: string;
  /**
   * Pick mode (the finding split): a click or Enter adds the entry as a reproduction step, and a caret
   * button beside it opens the body instead.
   */
  onPick?: (entryId: string) => void;
  /** In pick mode, the entry's place in the steps (1-based), once it is one. */
  stepNumber?: number;
}

export function LogEntryRow({ entry, hosts, defaultOpen = false, currentHostId, onPick, stepNumber }: LogEntryRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const { remove } = useLogMutations(entry.engagementId);
  const d = new Date(entry.at);
  const names = entry.hostIds
    .filter((id) => id !== currentHostId)
    .map((id) => hosts.find((h) => h.id === id)?.name)
    .filter((n): n is string => !!n)
    .map(shortHostName);
  const picking = onPick !== undefined;
  const hasExtras = names.length > 0 || entry.private || entry.returnedNothing || picking;
  // In the finding split's narrow pane the title keeps priority: at least 7rem, the kind label only from 30rem of
  // pane (the `ctx` container), and the extras shrink and clip instead of squeezing the title out.
  const cols = picking
    ? "grid-cols-[2.75rem_minmax(7rem,1fr)_minmax(0,auto)] @min-[30rem]/ctx:grid-cols-[2.75rem_6rem_minmax(7rem,1fr)_minmax(0,auto)]"
    : hasExtras
      ? "grid-cols-[2.75rem_6rem_minmax(0,1fr)_auto]"
      : "grid-cols-[2.75rem_6rem_minmax(0,1fr)]";
  const Caret = open ? CaretDown : CaretRight;

  const row = (
    <button
      type="button"
      aria-expanded={picking ? undefined : open}
      aria-label={picking ? (stepNumber ? `${entry.title}, step ${stepNumber}` : `Add ${entry.title} as a step`) : undefined}
      title={picking ? (stepNumber ? `Step ${stepNumber}` : "Add as a step (Enter)") : undefined}
      onClick={() => {
        if (!picking) setOpen((o) => !o);
        else if (!stepNumber) onPick(entry.id);
      }}
      className={`grid w-full items-center gap-3 px-1 py-2 text-left cursor-default hover:bg-surface focus-visible:bg-surface ${cols}`}
    >
      <time dateTime={d.toISOString()} title={d.toLocaleString()} className="font-mono text-xs text-muted">
        {`${pad(d.getHours())}:${pad(d.getMinutes())}`}
      </time>
      <span className={`${labelClass} truncate ${picking ? "hidden @min-[30rem]/ctx:block" : ""}`}>{KIND_LABELS[entry.kind]}</span>
      <span data-testid="entry-title" className="truncate text-[13px] text-fg">{entry.title}</span>
      {hasExtras && (
        <span className={`flex items-center gap-2 ${picking ? "min-w-0 justify-end overflow-hidden" : ""}`}>
          {names.map((n) => (
            <Chip key={n} className={`${picking ? "max-w-[10ch]" : "max-w-[16ch]"} truncate`}>
              <span className="truncate">{n}</span>
            </Chip>
          ))}
          {entry.private && <Chip>private</Chip>}
          {entry.returnedNothing &&
            (picking ? (
              <span title="Returned nothing" className="font-mono text-xs text-faint">∅</span>
            ) : (
              <span className="whitespace-nowrap text-xs text-faint">returned nothing</span>
            ))}
          {picking &&
            (stepNumber ? (
              <span className="whitespace-nowrap font-mono text-xs text-accent">step {stepNumber}</span>
            ) : (
              <span className="whitespace-nowrap text-xs text-muted">+ step</span>
            ))}
        </span>
      )}
    </button>
  );

  return (
    <li className="border-b border-line">
      {picking ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? `Hide ${entry.title}` : `Show ${entry.title}`}
            title={open ? "Hide the entry" : "Show the entry"}
            onClick={() => setOpen((o) => !o)}
            className="grid h-7 w-6 cursor-default place-items-center text-muted hover:text-fg"
          >
            <Caret size={12} weight="light" aria-hidden />
          </button>
          {row}
        </div>
      ) : (
        row
      )}
      {open && (
        <div className="flex flex-col gap-3 pb-3 pl-[60px] pr-1">
          <LogEntryBody entry={entry} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </div>
        </div>
      )}
      {editing && <EditEntryDialog entry={entry} hosts={hosts} onClose={() => setEditing(false)} />}
      <Dialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          if (!o) setDeleteError(undefined);
        }}
        title="Delete this entry? Its screenshot goes with it."
        description={deleteError ? <span role="alert" className="text-warn">{deleteError}</span> : undefined}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(entry.id, { onSuccess: () => setDeleting(false), onError: (e) => setDeleteError(e.message) })}>
              Delete entry
            </Button>
          </>
        }
      />
    </li>
  );
}
