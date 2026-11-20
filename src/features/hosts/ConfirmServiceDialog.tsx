import { useId, useState, type FormEvent } from "react";
import type { LogEntry } from "../../types/log";
import type { Service } from "../../types/service";
import { Button, Dialog, Field, Input, Select } from "../../ui";
import { useServiceMutations } from "../services/queries";
import "./ConfirmServiceDialog.scss";

const NONE = "none";

export interface ConfirmServiceDialogProps {
  engagementId: string;
  service: Service;
  /** This host's log entries, offered as "Proved by". */
  entries: LogEntry[];
  onClose: () => void;
  /** Open the port / protocol / nmap guess editor instead. */
  onEdit: () => void;
  /** Ask to delete this service. */
  onDelete: () => void;
}

/** The only way a service identity gets confirmed: the user types it. */
export function ConfirmServiceDialog({ engagementId, service, entries, onClose, onEdit, onDelete }: ConfirmServiceDialogProps) {
  const formId = useId();
  const { confirm, unconfirm } = useServiceMutations(engagementId, service.hostId);
  const [product, setProduct] = useState(service.confirmedProduct ?? "");
  const [version, setVersion] = useState(service.confirmedVersion ?? "");
  const [entryId, setEntryId] = useState(service.confirmedEntryId ?? NONE);
  const [error, setError] = useState<string>();
  const confirmed = service.confirmedProduct !== null;
  const pending = confirm.isPending || unconfirm.isPending;
  const opts = { onSuccess: onClose, onError: (e: Error) => setError(e.message) };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (product.trim() === "") {
      setError("Name the product");
      return;
    }
    setError(undefined);
    confirm.mutate(
      {
        id: service.id,
        input: {
          product: product.trim(),
          version: version.trim() === "" ? null : version.trim(),
          entryId: entryId === NONE ? null : entryId,
        },
      },
      opts,
    );
  }

  const guess = [service.nmapService, service.nmapVersion].filter(Boolean).join(" ");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Confirm ${service.port}/${service.protocol}`}
      description={guess ? `nmap guessed: ${guess}` : undefined}
      footer={
        <>
          <Button disabled={pending} onClick={onEdit}>
            Edit
          </Button>
          <Button variant="quiet-danger" className="confirm-service__delete" disabled={pending} onClick={onDelete}>
            Delete
          </Button>
          {confirmed && (
            <Button variant="quiet-danger" disabled={pending} onClick={() => unconfirm.mutate(service.id, opts)}>
              Remove confirmation
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            Confirm
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="confirm-service">
        <Field label="Product">
          <Input autoFocus value={product} onChange={(e) => setProduct(e.target.value)} placeholder="OpenSSH" />
        </Field>
        <Field label="Version">
          <Input mono value={version} onChange={(e) => setVersion(e.target.value)} placeholder="8.2p1" />
        </Field>
        <Field label="Proved by">
          <Select
            aria-label="Proved by"
            value={entryId}
            onValueChange={setEntryId}
            options={[{ value: NONE, label: "Nothing yet" }, ...entries.map((e) => ({ value: e.id, label: e.title }))]}
          />
        </Field>
        {error && <p className="confirm-service__error">{error}</p>}
      </form>
    </Dialog>
  );
}
