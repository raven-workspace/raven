import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import type { Host } from "../../types/host";
import { Button, Chip, Dialog, Kbd } from "../../ui";
import { threadsLabel, useThreadCounts } from "../notes/useThreadCounts";
import { HostDialog } from "./HostDialog";
import { COLUMN_LABELS, OS_LABELS } from "./columns";
import { useHostMutations } from "./queries";

/** What a host delete takes with it (FK cascades) and what stays. */
const HOST_DELETE_DETAIL =
  "Its services, checklist items, credential test results, access grants on it, finding links, field notes, " +
  "ruled-out items, tunnels through it and hops to or from it go with it; " +
  "log entries, credentials and findings stay but lose this host.";

export function HostHeader({ host, onStuck }: { host: Host; onStuck?: () => void }) {
  const navigate = useNavigate();
  const { remove } = useHostMutations(host.engagementId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const threads = useThreadCounts(host.engagementId).byHost.get(host.id) ?? 0;
  // The AD set only means something in an exam sim (it counts as one target there).
  const engagement = useQuery({ queryKey: ["engagement", host.engagementId], queryFn: () => api.engagementGet(host.engagementId) });
  const examSim = engagement.data?.kind === "exam-sim";
  return (
    <section aria-label="Host" className="flex items-center gap-3 border-b border-line pb-3">
      <h1 className="m-0 text-lg font-semibold tracking-[-0.01em] text-fg">{host.name}</h1>
      {host.ip && <span className="font-mono text-[13px] text-fg-2">{host.ip}</span>}
      {host.os && <Chip>{OS_LABELS[host.os]}</Chip>}
      {host.access !== "none" && <Chip variant="accent">{host.access}</Chip>}
      <Chip>{COLUMN_LABELS[host.boardColumn]}</Chip>
      {examSim && host.adSetEffective && <Chip>AD set</Chip>}
      {threads > 0 && <Chip>{threadsLabel(threads)}</Chip>}
      <span className="flex-1" />
      {onStuck && (
        <Button size="sm" onClick={onStuck}>
          Stuck? <Kbd aria-hidden className="ml-1">H</Kbd>
        </Button>
      )}
      <Button size="sm" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
        Delete
      </Button>
      <HostDialog open={editing} onOpenChange={setEditing} engagementId={host.engagementId} host={host} />
      <Dialog
        open={deleting}
        onOpenChange={(o) => {
          setDeleting(o);
          if (!o) setError(undefined);
        }}
        title={`Delete ${host.name}?`}
        description={
          <>
            {HOST_DELETE_DETAIL}
            {error && <> <span role="alert" className="text-warn">{error}</span></>}
          </>
        }
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(host.id, {
                  onSuccess: () => void navigate(`/e/${host.engagementId}`),
                  onError: (e) => setError(e.message),
                })
              }
            >
              Delete host
            </Button>
          </>
        }
      />
    </section>
  );
}
