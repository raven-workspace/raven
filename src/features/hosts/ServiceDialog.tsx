import { useId, useState, type FormEvent } from "react";
import type { Service, ServiceProtocol } from "../../types/service";
import { Button, Dialog, Field, Input, Select } from "../../ui";
import { useServiceMutations } from "../services/queries";
import "./ServiceDialog.scss";

const PROTOCOLS = [
  { value: "tcp", label: "tcp" },
  { value: "udp", label: "udp" },
];

export interface ServiceDialogProps {
  engagementId: string;
  hostId: string;
  /** Edit this service; without it the dialog adds one. */
  service?: Service;
  onClose: () => void;
}

/** Add a service by hand (nmap normally supplies them), or correct one: port, protocol, nmap guess. */
export function ServiceDialog({ engagementId, hostId, service, onClose }: ServiceDialogProps) {
  const formId = useId();
  const { create, update } = useServiceMutations(engagementId, hostId);
  const [port, setPort] = useState(service ? String(service.port) : "");
  const [protocol, setProtocol] = useState<ServiceProtocol>(service?.protocol ?? "tcp");
  const [name, setName] = useState(service?.nmapService ?? "");
  const [version, setVersion] = useState(service?.nmapVersion ?? "");
  const [error, setError] = useState<string>();
  const pending = create.isPending || update.isPending;
  const action = service ? "Save" : "Add service";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setError("Port is a number from 1 to 65535");
      return;
    }
    setError(undefined);
    const input = { port: n, protocol, nmapService: name.trim() || null, nmapVersion: version.trim() || null };
    const opts = { onSuccess: onClose, onError: (err: Error) => setError(err.message) };
    if (service) update.mutate({ id: service.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={service ? `Edit ${service.port}/${service.protocol}` : "Add service"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {action}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="service-dialog">
        <div className="service-dialog__pair">
          <Field label="Port">
            <Input autoFocus mono inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} placeholder="80" />
          </Field>
          <Field label="Protocol">
            <Select options={PROTOCOLS} value={protocol} onValueChange={(v) => setProtocol(v as ServiceProtocol)} />
          </Field>
        </div>
        <Field label="Service">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="http" />
        </Field>
        <Field label="Version">
          <Input mono value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Apache httpd 2.4.41" />
        </Field>
        {error && <p className="service-dialog__error">{error}</p>}
      </form>
    </Dialog>
  );
}
