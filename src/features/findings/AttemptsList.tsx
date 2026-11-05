import { useState } from "react";
import type { FailedAttempt } from "../../types/findings";
import { Button, Chip, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { hostLabel } from "../credentials/AccessGrants";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { AttemptForm, REASON_LABELS } from "./AttemptForm";
import { useFailedAttemptMutations, useFailedAttempts, useFindings } from "./queries";

/** Things tried that failed. With `hostId`, only that host's attempts and new ones start on it. */
export function AttemptsList({ eid, hostId, onOpenEntry }: {
  eid: string;
  hostId?: string;
  onOpenEntry: (entryId: string) => void;
}) {
  const attemptsQ = useFailedAttempts(eid);
  const hostsQ = useHosts(eid);
  const findingsQ = useFindings(eid);
  const logQ = useLog(eid);
  const { remove } = useFailedAttemptMutations(eid);
  const [editor, setEditor] = useState<{ edit?: FailedAttempt } | null>(null);
  const [deleting, setDeleting] = useState<FailedAttempt>();

  const failed = attemptsQ.error ?? hostsQ.error ?? findingsQ.error ?? logQ.error;
  if (failed) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load attempts: {failed.message}</p>;
  if (!attemptsQ.data || !hostsQ.data || !findingsQ.data || !logQ.data) return null;
  const hosts = hostsQ.data;
  const entryIds = new Set(logQ.data.map((e) => e.id));
  const rows = attemptsQ.data.filter((a) => hostId === undefined || a.hostId === hostId).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section aria-label="Attempts" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className={`m-0 ${labelClass}`}>Attempts <span className="tabular-nums">{rows.length}</span></h3>
        <Button onClick={() => setEditor({})}>Add attempt</Button>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">Nothing failed yet. Note what was tried and why it didn't work.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-line py-2">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span data-testid="attempt-title" className="truncate text-[13px] text-fg">{a.title}</span>
                  {a.private && <Chip>Private</Chip>}
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {[a.reasonKind && REASON_LABELS[a.reasonKind], a.reason].filter(Boolean).join(": ")}
                  {a.hostId && hostId === undefined ? ` · ${hostLabel(hosts.find((h) => h.id === a.hostId))}` : ""}
                </span>
              </span>
              <span className="flex gap-1.5">
                {a.logEntryId && entryIds.has(a.logEntryId) && (
                  <Button size="sm" aria-label={`Open log entry for ${a.title}`} onClick={() => onOpenEntry(a.logEntryId!)}>Log</Button>
                )}
                <Button size="sm" aria-label={`Edit ${a.title}`} onClick={() => setEditor({ edit: a })}>Edit</Button>
                <Button size="sm" variant="danger" aria-label={`Delete ${a.title}`} onClick={() => setDeleting(a)}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <AttemptForm
          eid={eid}
          hosts={hosts}
          findings={findingsQ.data}
          log={logQ.data}
          edit={editor.edit}
          defaultHostId={hostId}
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          title={`Delete ${deleting.title}?`}
          pending={remove.isPending}
          error={remove.error?.message}
          label="Delete attempt"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
        />
      )}
    </section>
  );
}
