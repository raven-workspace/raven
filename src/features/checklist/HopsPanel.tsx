import { useId, useState, type FormEvent } from "react";
import type { Host } from "../../types/host";
import type { Hop } from "../../types/network";
import { Button, Dialog, Field, Input, Panel, Select } from "../../ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { useHopMutations } from "./queries";

const KALI = "kali";

const hostName = (hosts: Host[], id: string | null) => (id === null ? "Kali" : (hosts.find((h) => h.id === id)?.name ?? "?"));

function HopForm({ engagementId, hosts, hop, onClose }: { engagementId: string; hosts: Host[]; hop?: Hop; onClose: () => void }) {
  const formId = useId();
  const { create, update } = useHopMutations(engagementId);
  const [from, setFrom] = useState(hop ? (hop.fromHostId ?? KALI) : KALI);
  const [to, setTo] = useState(hop?.toHostId ?? hosts[0]?.id ?? "");
  const [via, setVia] = useState(hop?.via ?? "");
  const [errors, setErrors] = useState<Partial<Record<"via" | "toHostId" | "form", string>>>({});
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (to === "") return setErrors({ toHostId: "Pick the host" });
    if (from === to) return setErrors({ toHostId: "A hop needs two different hosts" });
    if (via.trim() === "") return setErrors({ via: "Say how (creds, exploit, share…)" });
    setErrors({});
    const input = { fromHostId: from === KALI ? null : from, toHostId: to, via: via.trim() };
    const opts = {
      onSuccess: onClose,
      onError: (err: Error) => {
        const field = (err as { field?: string }).field;
        setErrors(field === "via" || field === "toHostId" ? { [field]: err.message } : { form: err.message });
      },
    };
    if (hop) update.mutate({ id: hop.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={hop ? "Edit hop" : "Add hop"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {hop ? "Save" : "Add hop"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Select options={[{ value: KALI, label: "Kali" }, ...hosts.map((h) => ({ value: h.id, label: h.name }))]} value={from} onValueChange={setFrom} />
          </Field>
          <Field label="To" error={errors.toHostId}>
            <Select options={hosts.map((h) => ({ value: h.id, label: h.name }))} value={to} onValueChange={setTo} />
          </Field>
        </div>
        <Field label="Via" error={errors.via}>
          <Input autoFocus value={via} onChange={(e) => setVia(e.target.value)} placeholder="creds, exploit, share…" />
        </Field>
        {errors.form && <p role="alert" className="m-0 text-xs text-warn">{errors.form}</p>}
      </form>
    </Dialog>
  );
}

export function HopsPanel({ engagementId, hosts, hops }: { engagementId: string; hosts: Host[]; hops: Hop[] }) {
  const [editing, setEditing] = useState<Hop | "new" | null>(null);
  const { remove } = useHopMutations(engagementId);
  const [deleting, setDeleting] = useState<Hop | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  return (
    <Panel title="Hops" actions={<Button size="sm" onClick={() => setEditing("new")}>Add hop</Button>}>
      {hops.length === 0 ? (
        <p className="m-0 text-xs text-muted">No hops yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {hops.map((h) => (
            <li key={h.id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
              <span className="min-w-0 flex-1 text-[13px] text-fg">
                {hostName(hosts, h.fromHostId)} → {hostName(hosts, h.toHostId)} via {h.via}
              </span>
              <Button size="sm" aria-label={`Edit hop to ${hostName(hosts, h.toHostId)}`} onClick={() => setEditing(h)}>Edit</Button>
              <Button size="sm" aria-label={`Delete hop to ${hostName(hosts, h.toHostId)}`} onClick={() => { setDeleteError(undefined); setDeleting(h); }}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDelete
          title={`Delete the hop to ${hostName(hosts, deleting.toHostId)}?`}
          label="Delete hop"
          error={deleteError}
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: (e) => setDeleteError(e.message) })}
        />
      )}
      {editing && <HopForm engagementId={engagementId} hosts={hosts} hop={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}
