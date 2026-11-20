import { CaretRightIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { HOST_IP } from "../../engines/attribution";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { Button, CARET_TURN, Chip, Collapse, Dialog, IconButton, Toolbar } from "../../ui";
import { cx } from "../../lib/cx";
import { EditEntryDialog } from "./EditEntryDialog";
import { KIND_LABELS } from "./kindLabels";
import { LogEntryBody } from "./LogEntryBody";
import { useLogMutations } from "./queries";
import { clockTime } from "../engagements/format";


/**
 * The IP a command targets when it is no known host's: titles never name the target, so without this a row about a box
 * not yet on the board has no hint of where it ran. Read from the stored command, like the old titles did.
 */
function unknownTarget(entry: LogEntry, hosts: Host[]): string | null {
  if (entry.content.kind !== "command") return null;
  const line = entry.content.blocks[0]?.command.split("\n").find((l) => l.trim()) ?? "";
  const ip = line.match(HOST_IP)?.[0];
  if (!ip || hosts.some((h) => h.ip === ip) || entry.title.includes(ip)) return null;
  return ip;
}

/** Host names shown on a row; the rest fold into one "+N" so a many-host entry never squeezes its title. */
const MAX_HOSTS = 2;

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
  const target = unknownTarget(entry, hosts);
  const hasExtras = target !== null || names.length > 0 || entry.private || entry.returnedNothing || picking;
  // In the finding split's narrow pane the title keeps priority: at least 7rem, the kind label only from 30rem of
  // pane (the `ctx` container), and the extras shrink and clip instead of squeezing the title out.
  const cols = picking
    ? "grid-cols-[2.75rem_minmax(7rem,1fr)_minmax(0,auto)] @min-[30rem]/ctx:grid-cols-[2.75rem_6rem_minmax(7rem,1fr)_minmax(0,auto)]"
    : hasExtras
      ? "grid-cols-[2.75rem_6rem_minmax(0,1fr)_auto]"
      : "grid-cols-[2.75rem_6rem_minmax(0,1fr)]";

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
      className={`grid w-full items-center gap-3 px-1 py-2 text-left cursor-default ${cols}`}
    >
      <time dateTime={d.toISOString()} title={d.toLocaleString()} className="text-code text-muted">
        {clockTime(entry.at)}
      </time>
      <span className={`truncate text-meta text-muted ${picking ? "hidden @min-[30rem]/ctx:block" : ""}`}>{KIND_LABELS[entry.kind]}</span>
      <span data-testid="entry-title" className="truncate text-body text-fg">{entry.title}</span>
      {hasExtras && (
        <span className={`grid grid-flow-col auto-cols-max items-center gap-2 ${picking ? "min-w-0 justify-end overflow-hidden" : ""}`}>
          {target && <span className="whitespace-nowrap font-mono text-code text-muted">{target}</span>}
          {/* Host names are metadata, so plain text; chips are for state, like "private" (DESIGN.md Chips). */}
          {names.slice(0, MAX_HOSTS).map((n) => (
            <span key={n} title={n} className={cx("truncate text-meta text-muted-2", picking ? "max-w-[10ch]" : "max-w-[16ch]")}>
              {n}
            </span>
          ))}
          {names.length > MAX_HOSTS && (
            <span title={names.slice(MAX_HOSTS).join(", ")} className="relative whitespace-nowrap text-meta text-muted">
              +{names.length - MAX_HOSTS}
              <span className="sr-only">, also {names.slice(MAX_HOSTS).join(", ")}</span>
            </span>
          )}
          {entry.private && <Chip>private</Chip>}
          {entry.returnedNothing &&
            (picking ? (
              <span title="Returned nothing" className="text-code text-faint">∅</span>
            ) : (
              <span className="whitespace-nowrap text-meta text-faint">returned nothing</span>
            ))}
          {picking &&
            (stepNumber ? (
              <span className="whitespace-nowrap text-code text-accent">step {stepNumber}</span>
            ) : (
              <span className="whitespace-nowrap text-meta text-muted">+ step</span>
            ))}
        </span>
      )}
    </button>
  );

  return (
    <li className="border-b border-line">
      {/* An open entry's Edit and Delete end its own row, beside the title, however long the entry below runs. */}
      {/* The highlight is the whole row's, so it runs under an open entry's Edit and Delete too. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center hover:bg-surface has-[:focus-visible]:bg-surface">
        {picking ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center">
            <IconButton
              icon={CaretRightIcon}
              label={open ? "Hide the entry" : "Show the entry"}
              aria-label={open ? `Hide ${entry.title}` : `Show ${entry.title}`}
              aria-expanded={open}
              className={CARET_TURN}
              onClick={() => setOpen((o) => !o)}
            />
            {row}
          </div>
        ) : (
          row
        )}
        {open && (
          <Toolbar className="pl-2">
            <IconButton icon={PencilSimpleIcon} label="Edit" onClick={() => setEditing(true)} />
            <IconButton icon={TrashIcon} label="Delete" tone="destructive" onClick={() => setDeleting(true)} />
          </Toolbar>
        )}
      </div>
      <Collapse open={open} contentClassName="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 px-1 pb-3">
        <div className="col-start-2 grid min-w-0 gap-3">
          <LogEntryBody entry={entry} />
        </div>
      </Collapse>
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
