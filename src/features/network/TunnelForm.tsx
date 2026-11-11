import { useId, useState, type FormEvent } from "react";
import { parseScopeList } from "../../engines/parse/scope";
import type { Host } from "../../types/host";
import type { Tunnel, TunnelInput, TunnelKind, TunnelStatus } from "../../types/network";
import { Button, Dialog, Field, Input, Select, Toggle, fieldLabelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useTunnelMutations } from "../checklist/queries";

const KINDS: { value: TunnelKind; label: string }[] = [
  { value: "ligolo", label: "Ligolo" },
  { value: "chisel", label: "Chisel" },
  { value: "ssh", label: "SSH" },
  { value: "socks", label: "SOCKS" },
  { value: "other", label: "Other" },
];

/** The kind as the form names it ("Ligolo", "SSH"). */
export const tunnelKindLabel = (kind: TunnelKind) => KINDS.find((k) => k.value === kind)?.label ?? kind;

type Errors = Partial<Record<"subnets" | "callbackIp" | "viaHostId" | "form", string>>;

/** `initial` prefills a new tunnel (the Network nudge passes the pivot and the subnets it found). */
export function TunnelForm({ engagementId, hosts, tunnel, initial, onClose }: {
  engagementId: string;
  hosts: Host[];
  tunnel?: Tunnel;
  initial?: { viaHostId?: string; subnets?: string[] };
  onClose: () => void;
}) {
  const formId = useId();
  const { create, update, remove } = useTunnelMutations(engagementId);
  const [kind, setKind] = useState<TunnelKind>(tunnel?.kind ?? "ligolo");
  const [via, setVia] = useState(tunnel?.viaHostId ?? initial?.viaHostId ?? hosts[0]?.id ?? "");
  const [subnets, setSubnets] = useState((tunnel?.subnets ?? initial?.subnets ?? []).join(", "));
  const [callback, setCallback] = useState(tunnel?.callbackIp ?? "");
  const [status, setStatus] = useState<TunnelStatus>(tunnel?.status ?? "up");
  const [errors, setErrors] = useState<Errors>({});
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const list = parseScopeList(subnets);
    const next: Errors = {};
    if (via === "") next.viaHostId = "Pick the host the tunnel goes through";
    if (list.invalid.length > 0) next.subnets = `Not a valid subnet: ${list.invalid.join(", ")}`;
    const cb = callback.trim();
    if (cb !== "" && (cb.includes("/") || parseScopeList(cb).entries.length !== 1)) next.callbackIp = "Use a single IPv4 address";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const input: TunnelInput = { kind, viaHostId: via, subnets: list.entries, callbackIp: cb, status };
    const opts = {
      onSuccess: onClose,
      onError: (err: Error) => {
        const field = (err as { field?: string }).field;
        setErrors(field === "subnets" || field === "callbackIp" || field === "viaHostId" ? { [field]: err.message } : { form: err.message });
      },
    };
    if (tunnel) update.mutate({ id: tunnel.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tunnel ? "Edit tunnel" : "Add tunnel"}
      footer={
        <>
          {tunnel && (
            <Button variant="quiet-danger" className="mr-auto" onClick={() => { setDeleteError(undefined); setDeleting(true); }}>Delete tunnel</Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={pending}>
            {tunnel ? "Save" : "Add tunnel"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <Select options={KINDS} value={kind} onValueChange={(v) => setKind(v as TunnelKind)} />
          </Field>
          <Field label="Via host" error={errors.viaHostId}>
            <Select options={hosts.map((h) => ({ value: h.id, label: h.name }))} value={via} onValueChange={setVia} />
          </Field>
        </div>
        <Field label="Subnets" hint="Comma-separated, e.g. 10.20.0.0/24" error={errors.subnets}>
          <Input mono autoFocus value={subnets} onChange={(e) => setSubnets(e.target.value)} placeholder="10.20.0.0/24" />
        </Field>
        <Field label="Callback IP" hint="Kali's address as seen from the pivot" error={errors.callbackIp}>
          <Input mono value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="10.10.14.9" />
        </Field>
        <div className="grid grid-cols-[max-content_max-content] items-center justify-start gap-2">
          <span className={fieldLabelClass}>Status</span>
          <Toggle on={status === "up"} onChange={(on) => setStatus(on ? "up" : "down")}>{status === "up" ? "Up" : "Down"}</Toggle>
        </div>
        {errors.form && <p role="alert" className="m-0 text-meta text-warn">{errors.form}</p>}
      </form>
      {tunnel && deleting && (
        <ConfirmDelete
          title={`Delete the ${tunnelKindLabel(tunnel.kind)} tunnel via ${hosts.find((h) => h.id === tunnel.viaHostId)?.name ?? "?"}?`}
          label="Delete tunnel"
          error={deleteError}
          pending={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate(tunnel.id, { onSuccess: onClose, onError: (e) => setDeleteError(e.message) })}
        />
      )}
    </Dialog>
  );
}
