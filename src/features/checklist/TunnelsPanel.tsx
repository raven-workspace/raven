import { useId, useState, type FormEvent } from "react";
import { parseScopeList } from "../../engines/parse/scope";
import type { Host } from "../../types/host";
import type { Tunnel, TunnelInput, TunnelKind, TunnelStatus } from "../../types/network";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { Button, Chip, ChipSet, Dialog, Field, IconButton, Input, Panel, Select, Toggle, fieldLabelClass } from "../../ui";
import { ConfirmDelete } from "./ConfirmDelete";
import { useTunnelMutations } from "./queries";

const KINDS: { value: TunnelKind; label: string }[] = [
  { value: "ligolo", label: "Ligolo" },
  { value: "chisel", label: "Chisel" },
  { value: "ssh", label: "SSH" },
  { value: "socks", label: "SOCKS" },
  { value: "other", label: "Other" },
];

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<TunnelKind, string>;

type Errors = Partial<Record<"subnets" | "callbackIp" | "viaHostId" | "form", string>>;

function TunnelForm({ engagementId, hosts, tunnel, onClose }: { engagementId: string; hosts: Host[]; tunnel?: Tunnel; onClose: () => void }) {
  const formId = useId();
  const { create, update } = useTunnelMutations(engagementId);
  const [kind, setKind] = useState<TunnelKind>(tunnel?.kind ?? "ligolo");
  const [via, setVia] = useState(tunnel?.viaHostId ?? hosts[0]?.id ?? "");
  const [subnets, setSubnets] = useState(tunnel?.subnets.join(", ") ?? "");
  const [callback, setCallback] = useState(tunnel?.callbackIp ?? "");
  const [status, setStatus] = useState<TunnelStatus>(tunnel?.status ?? "up");
  const [errors, setErrors] = useState<Errors>({});
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
    </Dialog>
  );
}

export function TunnelsPanel({ engagementId, hosts, tunnels }: { engagementId: string; hosts: Host[]; tunnels: Tunnel[] }) {
  const [editing, setEditing] = useState<Tunnel | "new" | null>(null);
  const { remove } = useTunnelMutations(engagementId);
  const [deleting, setDeleting] = useState<Tunnel | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const name = (id: string) => hosts.find((h) => h.id === id)?.name ?? "?";
  return (
    <Panel title="Tunnels" actions={<IconButton icon={Plus} label="Add tunnel" onClick={() => setEditing("new")} />}>
      {tunnels.length === 0 ? (
        <p className="m-0 text-meta text-muted">No tunnels yet.</p>
      ) : (
        <ul className="m-0 grid list-none p-0">
          {tunnels.map((t) => {
            const where = `${t.kind} tunnel via ${name(t.viaHostId)}`;
            return (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_56px_28px_28px] items-start gap-2 border-b border-line py-2 last:border-b-0">
                <div className="grid min-w-0 gap-1">
                  <span className="truncate py-1 text-body text-fg" title={`${KIND_LABEL[t.kind]} via ${name(t.viaHostId)}`}>
                    {KIND_LABEL[t.kind]} via <span className="font-mono text-code">{name(t.viaHostId)}</span>
                  </span>
                  <ChipSet>
                    {t.subnets.map((n) => (
                      <span key={n} className="text-code text-fg-2">{n}</span>
                    ))}
                  </ChipSet>
                </div>
                <div className="grid h-7 items-center justify-start">
                  <Chip variant={t.status === "up" ? "default" : "warn"}>{t.status}</Chip>
                </div>
                <IconButton icon={PencilSimple} label={`Edit ${where}`} onClick={() => setEditing(t)} />
                <IconButton icon={Trash} label={`Delete ${where}`} tone="destructive" onClick={() => { setDeleteError(undefined); setDeleting(t); }} />
              </li>
            );
          })}
        </ul>
      )}
      {deleting && (
        <ConfirmDelete
          title={`Delete the ${deleting.kind} tunnel via ${name(deleting.viaHostId)}?`}
          label="Delete tunnel"
          error={deleteError}
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: (e) => setDeleteError(e.message) })}
        />
      )}
      {editing && <TunnelForm engagementId={engagementId} hosts={hosts} tunnel={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}
