import { ArrowSquareOut, PencilSimple, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { FailedAttempt } from "../../types/findings";
import { ActionCell, Button, Chip, IconButton, labelClass, queryState } from "../../ui";
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

  const state = queryState([attemptsQ, hostsQ, findingsQ, logQ], "attempts");
  if (state || !attemptsQ.data || !hostsQ.data || !findingsQ.data || !logQ.data) return state;
  const hosts = hostsQ.data;
  const entryIds = new Set(logQ.data.map((e) => e.id));
  const showHost = hostId === undefined;
  const rows = attemptsQ.data.filter((a) => hostId === undefined || a.hostId === hostId).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section aria-label="Attempts" className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className={`m-0 ${labelClass}`}>Attempts <span className="tabular-nums">{rows.length}</span></h3>
        <Button onClick={() => setEditor({})}>Add attempt</Button>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 text-meta text-muted">Nothing failed yet. Note what was tried and why it didn't work.</p>
      ) : (
        <ul className={`m-0 grid list-none gap-x-3 p-0 ${showHost ? "grid-cols-[minmax(0,1fr)_max-content_max-content]" : "grid-cols-[minmax(0,1fr)_max-content]"}`}>
          {rows.map((a) => {
            const host = a.hostId && showHost ? hostLabel(hosts.find((h) => h.id === a.hostId)) : "";
            const reason = `${REASON_LABELS[a.reasonKind]}: ${a.reason}`;
            return (
              <li key={a.id} className="col-span-full grid grid-cols-subgrid items-start border-b border-line p-2 hover:bg-surface has-[:focus-visible]:bg-surface">
                <span className="grid min-w-0 gap-1">
                  <span className="grid h-5 grid-cols-[minmax(0,max-content)_max-content] items-center justify-start gap-2">
                    <button type="button" data-testid="attempt-title" title={a.title} onClick={() => setEditor({ edit: a })} className="-my-1 cursor-default truncate rounded-sm bg-transparent px-0 py-1 text-left text-body text-fg">{a.title}</button>
                    {a.private && <Chip>Private</Chip>}
                  </span>
                  {/* Why it failed is the point of an attempt: up to two lines, not one. */}
                  <span className="line-clamp-2 break-words text-meta text-muted" title={reason}>{reason}</span>
                </span>
                {showHost && <span className="grid h-5 max-w-[24ch] min-w-0 content-center"><span className="truncate text-meta text-muted-2" title={host}>{host}</span></span>}
                <span className="-my-1">
                  <ActionCell>
                  {a.logEntryId && entryIds.has(a.logEntryId) ? (
                    <IconButton icon={ArrowSquareOut} label={`Open log entry for ${a.title}`} onClick={() => onOpenEntry(a.logEntryId!)} />
                  ) : (
                    <span aria-hidden className="size-7" />
                  )}
                  <IconButton icon={PencilSimple} label={`Edit ${a.title}`} onClick={() => setEditor({ edit: a })} />
                  <IconButton icon={Trash} tone="destructive" label={`Delete ${a.title}`} onClick={() => setDeleting(a)} />
                </ActionCell>
                </span>
              </li>
            );
          })}
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
