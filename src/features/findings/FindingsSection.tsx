import { PencilSimple, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { sortFindingsBySeverity } from "../../engines/findings";
import type { Finding } from "../../types/findings";
import { ActionCell, Button, Chip, EmptyState, IconButton, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { hostLabel } from "../credentials/AccessGrants";
import { useHosts } from "../hosts/queries";
import { sectionPath } from "../engagements/sections";
import { AttemptsList } from "./AttemptsList";
import { FindingSplit } from "./FindingSplit";
import { useFindingMutations, useFindings } from "./queries";

/** Critical and high use the warn colour; the rest stay neutral. */
export function SeverityChip({ severity }: { severity: Finding["severity"] }) {
  if (!severity) return <Chip>unrated</Chip>;
  return <Chip variant={severity === "critical" || severity === "high" ? "warn" : "default"}>{severity}</Chip>;
}

export function FindingsSection() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hostsQ = useHosts(id);
  const findingsQ = useFindings(id);
  const { remove } = useFindingMutations(id);
  const [editor, setEditor] = useState<{ edit?: Finding } | null>(null);
  const [deleting, setDeleting] = useState<Finding>();
  const sorted = useMemo(() => sortFindingsBySeverity(findingsQ.data ?? []), [findingsQ.data]);

  const failed = hostsQ.error ?? findingsQ.error;
  if (failed) return <p role="alert" className="py-3 text-meta text-warn">Couldn't load findings: {failed.message}</p>;
  if (!hostsQ.data || !findingsQ.data) return null;
  const hosts = hostsQ.data;
  if (editor) {
    // The same split as the host page: with one affected host its context shows; otherwise the switcher or the engagement's.
    const only = editor.edit?.hostIds.length === 1 ? editor.edit.hostIds[0]! : null;
    return (
      <div className="@container/host h-full min-h-0">
        <FindingSplit key={editor.edit?.id ?? "new"} eid={id} hostId={only} edit={editor.edit ?? "new"} onClose={() => setEditor(null)} />
      </div>
    );
  }
  const names = (f: Finding) => f.hostIds.map((hid) => hostLabel(hosts.find((h) => h.id === hid))).join(", ");

  return (
    <section aria-label="Findings" className="grid gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className={`m-0 ${labelClass}`}>Findings <span className="tabular-nums">{sorted.length}</span></h3>
        <Button variant="primary" onClick={() => setEditor({})}>Add finding</Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No findings yet" />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[max-content_minmax(0,1fr)_max-content_max-content_max-content] gap-x-3 p-0">
          {sorted.map((f) => (
            <li key={f.id} className="col-span-full grid grid-cols-subgrid items-start border-b border-line py-2">
              <span className="grid h-5 content-center justify-self-start"><SeverityChip severity={f.severity} /></span>
              <span className="grid min-w-0 gap-1">
                <span data-testid="finding-title" className="line-clamp-2 break-words text-body text-fg" title={f.title}>{f.title}</span>
                {f.hostIds.length > 0 && (
                  <span className="grid grid-cols-[minmax(0,max-content)_max-content] justify-start gap-2 text-meta text-muted" title={names(f)}>
                    <span className="truncate">{hostLabel(hosts.find((h) => h.id === f.hostIds[0]))}</span>
                    {f.hostIds.length > 1 && <span>{`+${f.hostIds.length - 1}`}</span>}
                  </span>
                )}
              </span>
              <span className="text-meta text-fg-2">{f.status}</span>
              <span className="min-w-[3ch] text-right font-mono text-code tabular-nums text-fg-2">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
              <ActionCell>
                <IconButton icon={PencilSimple} label={`Edit ${f.title}`} onClick={() => setEditor({ edit: f })} />
                <IconButton icon={Trash} tone="destructive" label={`Delete ${f.title}`} onClick={() => setDeleting(f)} />
              </ActionCell>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDelete
          title={`Delete ${deleting.title}?`}
          pending={remove.isPending}
          error={remove.error?.message}
          label="Delete finding"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
        />
      )}
      <AttemptsList eid={id} onOpenEntry={() => void navigate(sectionPath(id, "log"))} />
    </section>
  );
}
