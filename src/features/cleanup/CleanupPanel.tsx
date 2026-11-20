import { useMemo, useRef, useState } from "react";
import { suggestCleanup } from "../../engines/cleanup";
import { PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import type { CleanupItem, CleanupKind } from "../../types/cleanup";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { cx } from "../../lib/cx";
import { Button, Chip, ChipSet, IconButton, Panel, labelClass, queryState } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { shortDate } from "../engagements/format";
import { CleanupDialog, KIND_OPTIONS } from "./CleanupDialog";
import { useCleanup, useCleanupMutations } from "./queries";
import "./CleanupPanel.scss";

const EMPTY = "Nothing left on targets yet. Uploads, created accounts and services you log will be suggested here.";
const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label])) as Record<CleanupKind, string>;

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
  // Suggestion keys with a mutation in flight: hidden at once, and a second click on them does nothing.
  const flying = useRef(new Set<string>());
  const [flyingKeys, setFlyingKeys] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string>();
  const suggestions = useMemo(
    () => (items ? suggestCleanup(entries, hosts, domain ?? "", items) : []).filter((s) => !flyingKeys.has(s.key)),
    [entries, hosts, domain, items, flyingKeys],
  );
  const onErr = (e: Error) => setActionError(e.message);
  const act = (key: string, run: (settled: () => void) => void) => {
    if (flying.current.has(key)) return;
    setActionError(undefined);
    flying.current.add(key);
    setFlyingKeys(new Set(flying.current));
    run(() => {
      flying.current.delete(key);
      setFlyingKeys(new Set(flying.current));
    });
  };
  const hostName = (id: string | null) => (id === null ? null : (hosts.find((h) => h.id === id)?.name ?? null));

  const state = queryState([list], "the cleanup list");
  if (state || !items) return state;

  const open = items.filter((i) => i.status === "open");
  const removed = items.filter((i) => i.status === "removed");
  const yearOf = (ms: number) => new Date(ms).getFullYear() !== new Date().getFullYear();

  const itemRow = (i: CleanupItem) => {
    const removedRow = i.status === "removed";
    const host = hostName(i.hostId);
    return (
      <li key={i.id} className="cleanup-row">
        <div className="cleanup-row__kind"><Chip>{KIND_LABEL[i.kind]}</Chip></div>
        <div className="cleanup-row__body">
          <span className={cx("cleanup-row__target", removedRow && "cleanup-row__target--removed")} title={i.target}>{i.target}</span>
          {(host || i.notes || (removedRow && i.removedAt !== null)) && (
            <ChipSet>
              {host && <span className="cleanup-row__meta">{host}</span>}
              {i.notes && <span className="cleanup-row__meta cleanup-row__note" title={i.notes}>{i.notes}</span>}
              {removedRow && i.removedAt !== null && (
                <span className="cleanup-row__meta">Removed {shortDate(i.removedAt, yearOf(i.removedAt))}</span>
              )}
            </ChipSet>
          )}
        </div>
        <Button
          size="sm"
          className="cleanup-row__verb"
          aria-pressed={removedRow}
          aria-label={removedRow ? `Restore ${i.target}` : `Mark ${i.target} removed`}
          onClick={() => {
            setActionError(undefined);
            m.setRemoved.mutate({ id: i.id, removed: !removedRow }, { onError: onErr });
          }}
        >
          {removedRow ? "Restore" : "Mark removed"}
        </Button>
        {i.status === "open" ? <IconButton icon={PencilSimple} label={`Edit ${i.target}`} onClick={() => setEditing(i)} /> : <span aria-hidden />}
        <IconButton icon={Trash} label={`Delete ${i.target}`} tone="destructive" onClick={() => { setDeleteError(undefined); setDeleting(i); }} />
      </li>
    );
  };

  return (
    <Panel title="Cleanup" aria-label="Cleanup" actions={<IconButton icon={Plus} label="Add item" onClick={() => setEditing("new")} />}>
      {actionError && <p role="alert" className="cleanup-panel__error">{actionError}</p>}
      {suggestions.length > 0 && (
        <div className="cleanup-panel__group cleanup-panel__group--suggested">
          <h3 className={labelClass}>Suggested</h3>
          <ul className="cleanup-panel__list">
            {suggestions.map((s) => {
              const host = hostName(s.hostId);
              return (
                <li key={s.key} className="cleanup-row cleanup-row--suggestion">
                  <div className="cleanup-row__kind"><Chip>{KIND_LABEL[s.kind]}</Chip></div>
                  <div className="cleanup-row__body">
                    <span className="cleanup-row__target" title={s.target}>{s.target}</span>
                    {host && <span className="cleanup-row__meta">{host}</span>}
                    <span title={s.command} className="cleanup-row__command">{s.command}</span>
                  </div>
                  <IconButton
                    icon={Plus}
                    label={`Add ${s.target}`}
                    onClick={() =>
                      act(s.key, (settled) =>
                        m.create.mutate(
                          { suggestionKey: s.key, sourceEntryId: s.entryId, hostId: s.hostId, kind: s.kind, target: s.target },
                          { onError: onErr, onSettled: settled },
                        ),
                      )
                    }
                  />
                  <IconButton icon={X} label={`Dismiss ${s.target}`} onClick={() => act(s.key, (settled) => m.dismiss.mutate(s.key, { onError: onErr, onSettled: settled }))} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {open.length === 0 && removed.length === 0 && suggestions.length === 0 ? (
        <p className="cleanup-panel__empty">{EMPTY}</p>
      ) : (
        <>
          {open.length > 0 && (
            <div className="cleanup-panel__group">
              <h3 className={labelClass}>On target</h3>
              <ul className="cleanup-panel__list">{open.map(itemRow)}</ul>
            </div>
          )}
          {removed.length > 0 && (
            <div className="cleanup-panel__group cleanup-panel__group--removed">
              <h3 className={labelClass}>Removed</h3>
              <ul className="cleanup-panel__list">{removed.map(itemRow)}</ul>
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
