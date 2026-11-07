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
}

export function LogEntryRow({ entry, hosts, defaultOpen = false, currentHostId }: LogEntryRowProps) {
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
  const hasExtras = names.length > 0 || entry.private || entry.returnedNothing;

  return (
    <li className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`grid w-full items-center gap-3 px-1 py-2 text-left cursor-default hover:bg-surface ${
          hasExtras ? "grid-cols-[2.75rem_6rem_minmax(0,1fr)_auto]" : "grid-cols-[2.75rem_6rem_minmax(0,1fr)]"
        }`}
      >
        <time dateTime={d.toISOString()} title={d.toLocaleString()} className="font-mono text-xs text-muted">
          {`${pad(d.getHours())}:${pad(d.getMinutes())}`}
        </time>
        <span className={`${labelClass} truncate`}>{KIND_LABELS[entry.kind]}</span>
        <span className="truncate text-[13px] text-fg">{entry.title}</span>
        {hasExtras && (
          <span className="flex items-center gap-2">
            {names.map((n) => (
              <Chip key={n} className="max-w-[16ch] truncate">
                <span className="truncate">{n}</span>
              </Chip>
            ))}
            {entry.private && <Chip>private</Chip>}
            {entry.returnedNothing && <span className="whitespace-nowrap text-xs text-faint">returned nothing</span>}
          </span>
        )}
      </button>
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
