import { useId, useState, type FormEvent } from "react";
import type { CleanupItem, CleanupKind } from "../../../types/cleanup";
import type { Host } from "../../../types/host";
import { Button, Dialog, Field, Input, Select, Textarea } from "../../../ui/index";
import { useCleanupMutations } from "../queries";
import "./CleanupDialog.scss";

export const KIND_OPTIONS: { value: CleanupKind; label: string }[] = [
  { value: "file", label: "File" },
  { value: "account", label: "Account" },
  { value: "service", label: "Service" },
  { value: "other", label: "Other" },
];
const NO_HOST = "none";

/** Add an item by hand, or edit one. The Rust message for a bad value shows inline and the dialog stays open. */
export function CleanupDialog({ engagementId, hosts, item, onClose }: {
  engagementId: string;
  hosts: Host[];
  item?: CleanupItem;
  onClose: () => void;
}) {
  const formId = useId();
  const { create, update } = useCleanupMutations(engagementId);
  const [kind, setKind] = useState<CleanupKind>(item?.kind ?? "file");
  const [target, setTarget] = useState(item?.target ?? "");
  const [hostId, setHostId] = useState(item?.hostId ?? NO_HOST);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string>();
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(undefined);
    const input = { kind, target, hostId: hostId === NO_HOST ? null : hostId, notes: notes.trim() === "" ? null : notes };
    const opts = { onSuccess: onClose, onError: (err: Error) => setError(err.message) };
    if (item) update.mutate({ id: item.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? "Edit item" : "Add item"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>{item ? "Save" : "Add item"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="cleanup-dialog__form">
        <div className="cleanup-dialog__pair">
          <Field label="Kind">
            <Select options={KIND_OPTIONS} value={kind} onValueChange={(v) => setKind(v as CleanupKind)} />
          </Field>
          <Field label="Host">
            <Select
              options={[{ value: NO_HOST, label: "No host" }, ...hosts.map((h) => ({ value: h.id, label: h.name }))]}
              value={hostId}
              onValueChange={setHostId}
            />
          </Field>
        </div>
        <Field label="Target">
          <Input autoFocus value={target} onChange={(e) => setTarget(e.target.value)} placeholder="path, account, service name…" className="cleanup-dialog__target" />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        {error && <p role="alert" className="cleanup-dialog__error">{error}</p>}
      </form>
    </Dialog>
  );
}
