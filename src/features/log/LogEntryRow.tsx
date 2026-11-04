import { useState } from "react";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { Button, Chip, Dialog, labelClass } from "../../ui";
import { EditEntryDialog } from "./EditEntryDialog";
import { LogEntryBody } from "./LogEntryBody";
import { useLogMutations } from "./queries";

const pad = (n: number) => String(n).padStart(2, "0");

export function LogEntryRow({ entry, hosts, defaultOpen = false }: { entry: LogEntry; hosts: Host[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { remove } = useLogMutations(entry.engagementId);
  const d = new Date(entry.at);
  const names = entry.hostIds.map((id) => hosts.find((h) => h.id === id)?.name).filter((n): n is string => !!n);

  return (
    <li className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-1 py-2 text-left cursor-default hover:bg-surface"
      >
        <time dateTime={d.toISOString()} title={d.toLocaleString()} className="w-11 shrink-0 font-mono text-xs text-muted">
          {`${pad(d.getHours())}:${pad(d.getMinutes())}`}
        </time>
        <span className={`${labelClass} w-[72px] shrink-0`}>{entry.kind}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{entry.title}</span>
        {names.map((n) => (
          <Chip key={n}>{n}</Chip>
        ))}
        {entry.private && <Chip>private</Chip>}
        {entry.returnedNothing && <span className="text-xs text-faint">returned nothing</span>}
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
        onOpenChange={setDeleting}
        title="Delete this entry? Its screenshot goes with it."
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(entry.id, { onSuccess: () => setDeleting(false) })}>
              Delete entry
            </Button>
          </>
        }
      />
    </li>
  );
}
