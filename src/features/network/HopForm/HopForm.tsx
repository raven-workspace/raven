import { useId, useState, type FormEvent } from "react";
import type { Host } from "../../../types/host";
import type { Hop } from "../../../types/network";
import { Button, Dialog, Field, Input, Select } from "../../../ui/index";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { useHopMutations } from "../queries";
import { RavenError } from "../../../types/errors";
import "./HopForm.scss";

const KALI = "kali";

const hostName = (hosts: Host[], id: string | null) => (id === null ? "Kali" : (hosts.find((h) => h.id === id)?.name ?? "?"));

export function HopForm({ engagementId, hosts, hop, onClose }: { engagementId: string; hosts: Host[]; hop?: Hop; onClose: () => void }) {
  const formId = useId();
  const { create, update, remove } = useHopMutations(engagementId);
  const [from, setFrom] = useState(hop ? (hop.fromHostId ?? KALI) : KALI);
  const [to, setTo] = useState(hop?.toHostId ?? hosts[0]?.id ?? "");
  const [via, setVia] = useState(hop?.via ?? "");
  const [errors, setErrors] = useState<Partial<Record<"via" | "toHostId" | "form", string>>>({});
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
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
        const field = RavenError.from(err).field;
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
          {hop && (
            <Button variant="quiet-danger" className="hop-form__delete" onClick={() => { setDeleteError(undefined); setDeleting(true); }}>Delete hop</Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {hop ? "Save" : "Add hop"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="hop-form">
        <div className="hop-form__pair">
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
        {errors.form && <p role="alert" className="hop-form__error">{errors.form}</p>}
      </form>
      {hop && deleting && (
        <ConfirmDelete
          title={`Delete the hop to ${hostName(hosts, hop.toHostId)}?`}
          label="Delete hop"
          error={deleteError}
          pending={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate(hop.id, { onSuccess: onClose, onError: (e) => setDeleteError(e.message) })}
        />
      )}
    </Dialog>
  );
}
