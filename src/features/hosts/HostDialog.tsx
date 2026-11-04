import { useId, useState, type FormEvent } from "react";
import type { Host, HostAccess, HostInput, HostOs } from "../../types/host";
import { Button, Dialog, Field, Input, Select, Toggle } from "../../ui";
import { useHostMutations } from "./queries";

const OS_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux" },
  { value: "other", label: "Other" },
];
const ACCESS_OPTIONS = [
  { value: "none", label: "None" },
  { value: "user", label: "User" },
  { value: "root", label: "Root" },
];

export interface HostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engagementId: string;
  /** Edit this host; create when absent. */
  host?: Host;
}

export function HostDialog({ open, onOpenChange, engagementId, host }: HostDialogProps) {
  // Mounted only while open, so every open starts from a fresh draft.
  if (!open) return null;
  return <HostForm engagementId={engagementId} host={host} onClose={() => onOpenChange(false)} />;
}

function HostForm({ engagementId, host, onClose }: { engagementId: string; host?: Host; onClose: () => void }) {
  const formId = useId();
  const { create, update } = useHostMutations(engagementId);
  const [name, setName] = useState(host?.name ?? "");
  const [ip, setIp] = useState(host?.ip ?? "");
  const [os, setOs] = useState(host?.os ?? "unknown");
  const [access, setAccess] = useState<HostAccess>(host?.access ?? "none");
  const [dualHomed, setDualHomed] = useState(host?.dualHomed ?? false);
  const [errors, setErrors] = useState<Partial<Record<"name" | "ip" | "form", string>>>({});
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (name.trim() === "") {
      setErrors({ name: "Give it a name" });
      return;
    }
    setErrors({});
    const input: HostInput = {
      name: name.trim(),
      ip: ip.trim() === "" ? null : ip.trim(),
      os: os === "unknown" ? null : (os as HostOs),
      access,
      dualHomed,
    };
    const opts = {
      onSuccess: onClose,
      onError: (err: Error) => {
        const field = (err as { field?: string }).field;
        setErrors(field === "name" || field === "ip" ? { [field]: err.message } : { form: err.message });
      },
    };
    if (host) update.mutate({ id: host.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={host ? "Edit host" : "Add host"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {host ? "Save" : "Add host"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Field label="Name" error={errors.name}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="dc01" />
        </Field>
        <Field label="IP" error={errors.ip}>
          <Input mono value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.10.10.5" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="OS">
            <Select options={OS_OPTIONS} value={os} onValueChange={setOs} />
          </Field>
          <Field label="Access">
            <Select options={ACCESS_OPTIONS} value={access} onValueChange={(v) => setAccess(v as HostAccess)} />
          </Field>
        </div>
        <Toggle on={dualHomed} onChange={setDualHomed} className="self-start">
          Dual-homed (reaches another network)
        </Toggle>
        {errors.form && <p className="m-0 text-xs text-warn">{errors.form}</p>}
      </form>
    </Dialog>
  );
}
