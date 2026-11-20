import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { Host, HostAccess, HostInput, HostOs } from "../../types/host";
import { Button, ChipSet, Dialog, Field, Input, Select, Toggle } from "../../ui";
import { useHostMutations } from "./queries";
import { useEngagement } from "../engagements/queries";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { RavenError } from "../../types/errors";
import { OS_LABELS } from "./columns";

/** What a host delete takes with it (FK cascades) and what stays. */
const HOST_DELETE_DETAIL =
  "Its services, checklist items, credential test results, access grants on it, finding links, field notes, " +
  "ruled-out items, tunnels through it and hops to or from it go with it; " +
  "log entries, credentials and findings stay but lose this host.";

const OS_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  ...(Object.keys(OS_LABELS) as HostOs[]).map((value) => ({ value, label: OS_LABELS[value] })),
];
type AdChoice = "auto" | "on" | "off";
const AD_CHOICES: { value: AdChoice; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];
const AD_VALUE: Record<AdChoice, boolean | null> = { auto: null, on: true, off: false };

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
  const engagement = useEngagement(engagementId);
  const examSim = engagement.data?.kind === "exam-sim";
  const [adChoice, setAdChoice] = useState<AdChoice>(host?.adSet == null ? "auto" : host.adSet ? "on" : "off");
  const [errors, setErrors] = useState<Partial<Record<"name" | "ip" | "form", string>>>({});
  const [deleting, setDeleting] = useState(false);
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
      // Only exam sims have the AD set; elsewhere the stored value stays untouched.
      ...(examSim ? { adSet: AD_VALUE[adChoice] } : {}),
    };
    const opts = {
      onSuccess: onClose,
      onError: (err: Error) => {
        const field = RavenError.from(err).field;
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
          {host && (
            <Button variant="quiet-danger" className="mr-auto" onClick={() => setDeleting(true)}>
              Delete host
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {host ? "Save" : "Add host"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4">
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
        <Toggle on={dualHomed} onChange={setDualHomed} className="justify-self-start">
          Dual-homed (reaches another network)
        </Toggle>
        {examSim && (
          <div role="radiogroup" aria-label="Part of the AD set" className="grid gap-2">
            <span className="block text-meta text-muted-2">Part of the AD set</span>
            <ChipSet className="items-center">
              {AD_CHOICES.map((c) => (
                <Toggle
                  key={c.value}
                  role="radio"
                  aria-checked={adChoice === c.value}
                  aria-pressed={undefined}
                  on={adChoice === c.value}
                  onChange={() => setAdChoice(c.value)}
                >
                  {c.label}
                </Toggle>
              ))}
              {adChoice === "auto" && (
                <span className="text-meta text-muted">{host?.adSet == null && host?.adSetEffective ? "(auto: DC detected)" : "(auto)"}</span>
              )}
            </ChipSet>
          </div>
        )}
        {errors.form && <p className="m-0 text-meta text-warn">{errors.form}</p>}
      </form>
      {host && deleting && <DeleteHostDialog host={host} onClose={() => setDeleting(false)} />}
    </Dialog>
  );
}

function DeleteHostDialog({ host, onClose }: { host: Host; onClose: () => void }) {
  const navigate = useNavigate();
  const { remove } = useHostMutations(host.engagementId);
  return (
    <ConfirmDelete
      title={`Delete ${host.name}?`}
      detail={HOST_DELETE_DETAIL}
      error={remove.error?.message}
      pending={remove.isPending}
      label="Delete host"
      onCancel={onClose}
      onConfirm={() => remove.mutate(host.id, { onSuccess: () => void navigate(`/e/${host.engagementId}`) })}
    />
  );
}
