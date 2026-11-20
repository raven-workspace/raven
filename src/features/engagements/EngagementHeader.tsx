import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Engagement, EngagementStatus } from "../../types/engagement";
import { Chip, ChipSet, IconButton } from "../../ui";
import { EngagementDialog } from "./EngagementDialog";
import { KIND_LABEL, scopeSummary } from "./format";
import { engagementKey, engagementsKey } from "./queries";

export function EngagementHeader({ engagement: e }: { engagement: Engagement }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = scopeSummary(e.scopeCidrs);
  const archived = e.status === "archived";
  const toggleArchive = () => setStatus.mutate(archived ? "active" : "archived");

  const setStatus = useMutation({
    mutationFn: (status: EngagementStatus) => api.engagementSetStatus(e.id, status),
    onSuccess: (saved) => {
      setError(null);
      qc.setQueryData(engagementKey(saved.id), saved);
      void qc.invalidateQueries({ queryKey: engagementsKey });
    },
    onError: (err) => setError(err.message),
  });

  return (
    <header className="grid shrink-0 gap-y-1 border-b border-line px-6 pt-4 pb-3">
      {/* The engagement's actions sit right after its name, not at the pane's far edge: "edit this", "archive this". */}
      <div className="grid min-w-0 grid-flow-col grid-cols-[minmax(0,max-content)] auto-cols-max items-center justify-start gap-x-1">
        <h1 title={e.name} className="m-0 truncate text-title text-fg">
          {e.name}
        </h1>
        {archived && <span className="px-1"><Chip>archived</Chip></span>}
        <IconButton icon={PencilSimple} label="Edit engagement" onClick={() => setEditing(true)} />
        <IconButton icon={ArchiveIcon} label={archived ? "Unarchive" : "Archive"} disabled={setStatus.isPending} onClick={toggleArchive} />
      </div>
      <ChipSet className="items-center gap-x-4 gap-y-1 text-meta text-muted-2">
        <span>{KIND_LABEL[e.kind]}</span>
        {e.subLabel && <span>{e.subLabel}</span>}
        {e.client && <span>{e.client}</span>}
        {scope && (
          <ul aria-label="Scope" className="m-0 grid list-none auto-cols-max grid-flow-col gap-3 p-0">
            {e.scopeCidrs.map((c) => (
              <li key={c} className="font-mono text-code text-muted-2">
                {c}
              </li>
            ))}
          </ul>
        )}
        {e.domain && (
          <span className="grid grid-flow-col items-baseline gap-2">
            <span className="text-meta text-muted">Domain</span>
            <span className="font-mono text-code text-fg-2">{e.domain}</span>
          </span>
        )}
      </ChipSet>
      {error && <p className="m-0 text-meta text-warn">{error}</p>}
      <EngagementDialog open={editing} onOpenChange={setEditing} engagement={e} />
    </header>
  );
}
