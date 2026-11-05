import { useMemo, useState } from "react";
import { suggestCleanup } from "../../engines/cleanup";
import { cx } from "../../lib/cx";
import type { CleanupItem, CleanupKind } from "../../types/cleanup";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { Button, Chip, Panel, Toggle } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { shortDate } from "../engagements/format";
import { CleanupDialog, KIND_OPTIONS } from "./CleanupDialog";
import { useCleanup, useCleanupMutations } from "./queries";

const EMPTY = "Nothing left on targets yet. Uploads, created accounts and services you log will be suggested here.";
const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label])) as Record<CleanupKind, string>;
const subhead = "m-0 text-[11px] font-semibold uppercase tracking-label text-muted";

export function CleanupPanel({ engagementId, hosts, entries, domain }: {
  engagementId: string;
  hosts: Host[];
  entries: LogEntry[];
  domain: string | null;
}) {
  const list = useCleanup(engagementId);
  const m = useCleanupMutations(engagementId);
  const [editing, setEditing] = useState<CleanupItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<CleanupItem | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const items = list.data;
  const suggestions = useMemo(
    () => (items ? suggestCleanup(entries, hosts, domain ?? "", items) : []),
    [entries, hosts, domain, items],
  );
  const hostName = (id: string | null) => (id === null ? null : (hosts.find((h) => h.id === id)?.name ?? null));

  if (list.error) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load the cleanup list: {list.error.message}</p>;
  if (!items) return null;

  const open = items.filter((i) => i.status === "open");
  const removed = items.filter((i) => i.status === "removed");
  const err = (m.create.error ?? m.dismiss.error ?? m.setRemoved.error) as Error | null;
  const yearOf = (ms: number) => new Date(ms).getFullYear() !== new Date().getFullYear();

  const itemRow = (i: CleanupItem) => (
    <li key={i.id} className={cx("flex items-center gap-2 border-b border-line py-1.5 last:border-b-0", i.status === "removed" && "opacity-50")}>
      <Chip>{KIND_LABEL[i.kind]}</Chip>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[12.5px] text-fg">{i.target}</span>
        {i.notes && <span className="truncate text-xs text-muted-2">{i.notes}</span>}
      </div>
      {hostName(i.hostId) && <span className="shrink-0 text-xs text-muted-2">{hostName(i.hostId)}</span>}
      {i.status === "removed" && i.removedAt !== null && (
        <span className="shrink-0 text-xs text-muted-2">Removed {shortDate(i.removedAt, yearOf(i.removedAt))}</span>
      )}
      <Toggle
        on={i.status === "removed"}
        aria-label={`Mark ${i.target} removed`}
        onChange={(on) => m.setRemoved.mutate({ id: i.id, removed: on })}
      >
        {i.status === "removed" ? "Removed" : "Mark removed"}
      </Toggle>
      {i.status === "open" && <Button size="sm" aria-label={`Edit ${i.target}`} onClick={() => setEditing(i)}>Edit</Button>}
      <Button size="sm" aria-label={`Delete ${i.target}`} onClick={() => { setDeleteError(undefined); setDeleting(i); }}>Delete</Button>
    </li>
  );

  return (
    <Panel title="Cleanup" aria-label="Cleanup" actions={<Button size="sm" onClick={() => setEditing("new")}>Add item</Button>}>
      {err && <p role="alert" className="mb-2 mt-0 text-xs text-warn">{err.message}</p>}
      {suggestions.length > 0 && (
        <div className="mb-3 flex flex-col gap-1">
          <h3 className={subhead}>Suggested</h3>
          <ul className="m-0 list-none p-0">
            {suggestions.map((s) => (
              <li key={s.key} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
                <Chip>{KIND_LABEL[s.kind]}</Chip>
                <span className="shrink-0 font-mono text-[12.5px] text-fg">{s.target}</span>
                {hostName(s.hostId) && <span className="shrink-0 text-xs text-muted-2">{hostName(s.hostId)}</span>}
                <span title={s.command} className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">{s.command}</span>
                <Button
                  size="sm"
                  aria-label={`Add ${s.target}`}
                  onClick={() => m.create.mutate({ suggestionKey: s.key, sourceEntryId: s.entryId, hostId: s.hostId, kind: s.kind, target: s.target })}
                >
                  Add
                </Button>
                <Button size="sm" aria-label={`Dismiss ${s.target}`} onClick={() => m.dismiss.mutate(s.key)}>Dismiss</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open.length === 0 && removed.length === 0 && suggestions.length === 0 ? (
        <p className="m-0 text-xs text-muted">{EMPTY}</p>
      ) : (
        <>
          {open.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className={subhead}>On target</h3>
              <ul className="m-0 list-none p-0">{open.map(itemRow)}</ul>
            </div>
          )}
          {removed.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              <h3 className={subhead}>Removed</h3>
              <ul className="m-0 list-none p-0">{removed.map(itemRow)}</ul>
            </div>
          )}
        </>
      )}
      {deleting && (
        <ConfirmDelete
          title={`Delete ${deleting.target} from the cleanup list?`}
          label="Delete item"
          error={deleteError}
          pending={m.remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => m.remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: (e) => setDeleteError(e.message) })}
        />
      )}
      {editing && (
        <CleanupDialog engagementId={engagementId} hosts={hosts} item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </Panel>
  );
}
