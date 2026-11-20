import { PencilSimple, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { sortFindingsBySeverity } from "../../engines/findings";
import type { Finding } from "../../types/findings";
import { ActionCell, Button, Chip, EmptyState, IconButton, labelClass, queryState } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useHosts } from "../hosts/queries";
import { sectionPath } from "../engagements/sections";
import { AttemptsList } from "./AttemptsList";
import { FindingSplit } from "./FindingSplit";
import { useFindingMutations, useFindings } from "./queries";
import { hostLabel } from "../../lib/hostName";

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

  const state = queryState([hostsQ, findingsQ], "findings");
  if (state || !hostsQ.data || !findingsQ.data) return state;
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
        // One grid for the header and the rows, so every column lines up with its name.
        <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content_max-content_max-content] gap-x-3">
          <div aria-hidden className={`col-span-full grid grid-cols-subgrid border-b border-line px-2 pb-2 ${labelClass} text-faint`}>
            <span>Severity</span>
            <span>Finding</span>
            <span>Status</span>
            <span className="text-right">CVSS</span>
            <span />
          </div>
          <ul className="col-span-full m-0 grid list-none grid-cols-subgrid p-0">
            {sorted.map((f) => (
              <li key={f.id} className="col-span-full grid grid-cols-subgrid items-start border-b border-line p-2 hover:bg-surface has-[:focus-visible]:bg-surface">
                <span className="grid h-5 content-center justify-self-start"><SeverityChip severity={f.severity} /></span>
                <span className="grid min-w-0 gap-1">
                  {/* The title opens the finding: the whole name is the target, not only the pencil. */}
                  <button
                    type="button"
                    data-testid="finding-title"
                    title={f.title}
                    onClick={() => setEditor({ edit: f })}
                    className="-my-1 line-clamp-2 cursor-default break-words rounded-sm bg-transparent px-0 py-1 text-left text-body text-fg"
                  >
                    {f.title}
                  </button>
                  {f.hostIds.length > 0 && (
                    <span className="grid grid-cols-[minmax(0,max-content)_max-content] justify-start gap-2 text-meta text-muted-2" title={names(f)}>
                      <span className="truncate">{hostLabel(hosts.find((h) => h.id === f.hostIds[0]))}</span>
                      {f.hostIds.length > 1 && <span>{`+${f.hostIds.length - 1}`}</span>}
                    </span>
                  )}
                </span>
                {/* A draft is still unconfirmed, so it sits a step quieter than confirmed and reported. */}
                <span className={`grid h-5 content-center text-meta ${f.status === "draft" ? "text-muted-2" : "text-fg-2"}`}>{f.status}</span>
                <span className="min-w-[3ch] text-right font-mono text-code tabular-nums text-fg-2">{f.cvssScore !== null ? f.cvssScore.toFixed(1) : ""}</span>
                {/* 28px buttons centred on the 20px first line. */}
                <span className="-my-1">
                  <ActionCell>
                    <IconButton icon={PencilSimple} label={`Edit ${f.title}`} onClick={() => setEditor({ edit: f })} />
                    <IconButton icon={Trash} tone="destructive" label={`Delete ${f.title}`} onClick={() => setDeleting(f)} />
                  </ActionCell>
                </span>
              </li>
            ))}
          </ul>
        </div>
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
