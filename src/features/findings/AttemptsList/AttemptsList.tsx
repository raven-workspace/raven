import { ArrowSquareOut, PencilSimple, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { FailedAttempt } from "../../../types/findings";
import { ActionCell, Button, Chip, IconButton, labelClass, queryState } from "../../../ui/index";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { useHosts } from "../../hosts/queries";
import { useLog } from "../../log/queries";
import { AttemptForm, REASON_LABELS } from "../AttemptForm/AttemptForm";
import { useFailedAttemptMutations, useFailedAttempts, useFindings } from "../queries";
import { hostLabel } from "../../../lib/hostName";
import "./AttemptsList.scss";

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
    <section aria-label="Attempts" className="attempts-list">
      <div className="attempts-list__header">
        <h3 className={labelClass}>Attempts <span className="attempts-list__count">{rows.length}</span></h3>
        <Button onClick={() => setEditor({})}>Add attempt</Button>
      </div>

      {rows.length === 0 ? (
        <p className="attempts-list__empty">Nothing failed yet. Note what was tried and why it didn't work.</p>
      ) : (
        <ul className={showHost ? "attempts-list__list attempts-list__list--hosts" : "attempts-list__list"}>
          {rows.map((a) => {
            const host = a.hostId && showHost ? hostLabel(hosts.find((h) => h.id === a.hostId)) : "";
            const reason = `${REASON_LABELS[a.reasonKind]}: ${a.reason}`;
            return (
              <li key={a.id} className="attempts-list__row">
                <span className="attempts-list__main">
                  <span className="attempts-list__title-line">
                    <button type="button" data-testid="attempt-title" title={a.title} onClick={() => setEditor({ edit: a })} className="attempts-list__title">{a.title}</button>
                    {a.private && <Chip>Private</Chip>}
                  </span>
                  {/* Why it failed is the point of an attempt: up to two lines, not one. */}
                  <span className="attempts-list__reason" title={reason}>{reason}</span>
                </span>
                {showHost && <span className="attempts-list__host"><span className="attempts-list__host-name" title={host}>{host}</span></span>}
                <span className="attempts-list__actions">
                  <ActionCell>
                  {a.logEntryId && entryIds.has(a.logEntryId) ? (
                    <IconButton icon={ArrowSquareOut} label={`Open log entry for ${a.title}`} onClick={() => onOpenEntry(a.logEntryId!)} />
                  ) : (
                    <span aria-hidden className="attempts-list__spacer" />
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
