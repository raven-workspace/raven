import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Engagement, EngagementStatus } from "../../types/engagement";
import { useNarrow } from "../../lib/useNarrow";
import { Button, Chip, ChipSet, IconButton, Toolbar } from "../../ui";
import { EngagementDialog } from "./EngagementDialog";
import { KIND_LABEL, scopeSummary } from "./format";

export function EngagementHeader({ engagement: e }: { engagement: Engagement }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = scopeSummary(e.scopeCidrs);
  const archived = e.status === "archived";
  // Under 1000px the actions become icons before the title has to truncate (DESIGN.md Status strip and headers).
  const [headerRef, narrow] = useNarrow<HTMLElement>(1000);
  const toggleArchive = () => setStatus.mutate(archived ? "active" : "archived");

  const setStatus = useMutation({
    mutationFn: (status: EngagementStatus) => api.engagementSetStatus(e.id, status),
    onSuccess: (saved) => {
      setError(null);
      qc.setQueryData(["engagement", saved.id], saved);
      void qc.invalidateQueries({ queryKey: ["engagements"] });
    },
    onError: (err) => setError(err.message),
  });

  return (
    <header ref={headerRef} className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line px-6 pt-4 pb-3">
      <div className="grid min-w-0 grid-cols-[minmax(0,max-content)_auto] items-center justify-start gap-2.5">
        <h1 title={e.name} className="m-0 truncate text-title text-fg">
          {e.name}
        </h1>
        {archived && <Chip>archived</Chip>}
      </div>
      <Toolbar>
        {narrow ? (
          <>
            <IconButton icon={PencilSimple} label="Edit engagement" onClick={() => setEditing(true)} />
            <IconButton
              icon={Archive}
              label={archived ? "Unarchive" : "Archive"}
              disabled={setStatus.isPending}
              onClick={toggleArchive}
            />
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" disabled={setStatus.isPending} onClick={toggleArchive}>
              {archived ? "Unarchive" : "Archive"}
            </Button>
          </>
        )}
      </Toolbar>
      <ChipSet className="col-span-2 items-center gap-x-4 gap-y-1 text-meta text-muted-2">
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
          <span className="grid grid-flow-col items-baseline gap-1.5">
            <span className="text-meta text-muted">Domain</span>
            <span className="font-mono text-code text-fg-2">{e.domain}</span>
          </span>
        )}
      </ChipSet>
      {error && <p className="col-span-2 m-0 text-meta text-warn">{error}</p>}
      <EngagementDialog open={editing} onOpenChange={setEditing} engagement={e} />
    </header>
  );
}
