import { useState } from "react";
import { useNavigate } from "react-router";
import type { Host } from "../../types/host";
import { Button, Chip, Dialog } from "../../ui";
import { HostDialog } from "./HostDialog";
import { COLUMN_LABELS, OS_LABELS } from "./columns";
import { useHostMutations } from "./queries";

export function HostHeader({ host }: { host: Host }) {
  const navigate = useNavigate();
  const { remove } = useHostMutations(host.engagementId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <section aria-label="Host" className="flex items-center gap-3 border-b border-line pb-3">
      <h1 className="m-0 text-lg font-semibold tracking-[-0.01em] text-fg">{host.name}</h1>
      {host.ip && <span className="font-mono text-[13px] text-fg-2">{host.ip}</span>}
      {host.os && <Chip>{OS_LABELS[host.os]}</Chip>}
      {host.access !== "none" && <Chip variant="accent">{host.access}</Chip>}
      <Chip>{COLUMN_LABELS[host.boardColumn]}</Chip>
      <span className="flex-1" />
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
        title={`Delete ${host.name}? Its services go with it; log entries stay but lose this host.`}
        description={error ? <span role="alert" className="text-warn">{error}</span> : undefined}
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
