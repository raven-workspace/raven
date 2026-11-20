import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Engagement, EngagementStatus } from "../../types/engagement";
import { Chip, ChipSet, IconButton } from "../../ui";
import { EngagementDialog } from "./EngagementDialog";
import { KIND_LABEL, scopeSummary } from "./format";
import { engagementKey, engagementsKey } from "./queries";
import "./EngagementHeader.scss";

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
    <header className="engagement-header">
      {/* The engagement's actions sit right after its name, not at the pane's far edge: "edit this", "archive this". */}
      <div className="engagement-header__title-row">
        <h1 title={e.name} className="engagement-header__name">
          {e.name}
        </h1>
        {archived && <span className="engagement-header__archived"><Chip>archived</Chip></span>}
        <IconButton icon={PencilSimple} label="Edit engagement" onClick={() => setEditing(true)} />
        <IconButton icon={ArchiveIcon} label={archived ? "Unarchive" : "Archive"} disabled={setStatus.isPending} onClick={toggleArchive} />
      </div>
      <ChipSet className="engagement-header__facts">
        <span>{KIND_LABEL[e.kind]}</span>
        {e.subLabel && <span>{e.subLabel}</span>}
        {e.client && <span>{e.client}</span>}
        {scope && (
          <ul aria-label="Scope" className="engagement-header__scope">
            {e.scopeCidrs.map((c) => (
              <li key={c} className="engagement-header__cidr">
                {c}
              </li>
            ))}
          </ul>
        )}
        {e.domain && (
          <span className="engagement-header__domain">
            <span className="engagement-header__domain-label">Domain</span>
            <span className="engagement-header__domain-value">{e.domain}</span>
          </span>
        )}
      </ChipSet>
      {error && <p className="engagement-header__error">{error}</p>}
      <EngagementDialog open={editing} onOpenChange={setEditing} engagement={e} />
    </header>
  );
}
