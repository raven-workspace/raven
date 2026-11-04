import { useId, useState, type FormEvent } from "react";
import type { ServiceProtocol } from "../../types/service";
import { Button, Dialog, Field, Input, Select } from "../../ui";
import { useServiceMutations } from "../services/queries";

const PROTOCOLS = [
  { value: "tcp", label: "tcp" },
  { value: "udp", label: "udp" },
];

/** Add a service by hand (nmap normally supplies them). */
export function ServiceDialog({ hostId, onClose }: { hostId: string; onClose: () => void }) {
  const formId = useId();
  const { create } = useServiceMutations(hostId);
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState<ServiceProtocol>("tcp");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setError("Port is a number from 1 to 65535");
      return;
    }
    setError(undefined);
    create.mutate(
      { port: n, protocol, nmapService: name.trim() || null, nmapVersion: version.trim() || null },
      { onSuccess: onClose, onError: (err) => setError(err.message) },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add service"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={create.isPending}>
            Add service
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
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
        {error && <p className="m-0 text-xs text-warn">{error}</p>}
      </form>
    </Dialog>
  );
}
